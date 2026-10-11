/** Opt-in, authenticated smoke test. Never run by Vitest or CI. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { readConfig } from '../src/config.js';
import {
  announcementSchema,
  assignmentSchema,
  authSchema,
  courseSchema,
  fileSchema,
} from '../src/domain/models.js';

const summarySchema = assignmentSchema
  .omit({ description: true, description_html: true, attachments: true })
  .extend({ description_summary: z.string().nullable() });
const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number(), next_offset: z.number().nullable() });
const envelope = z.object({
  ok: z.boolean(),
  data: z.unknown(),
  complete: z.boolean(),
  warnings: z.array(z.object({ code: z.string() })),
  error: z.object({ code: z.string() }).nullable(),
});
class VerificationError extends Error {}
const emit = (event: string, data: Record<string, unknown>) =>
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
const config = readConfig();
const maxDownloadMiB = Math.min(8, config.maxDownloadBytes / 1024 / 1024);
const downloadDir = join(
  config.downloadDir,
  `verification-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('dist/index.js')],
  cwd: resolve('.'),
  stderr: 'pipe',
  env: {
    THU_LEARN_SESSION_DIR: config.sessionDir,
    THU_LEARN_DOWNLOAD_DIR: downloadDir,
    THU_LEARN_CACHE_TTL_MS: '300000',
    THU_LEARN_TIMEOUT_MS: String(config.requestTimeoutMs),
    THU_LEARN_RETRIES: String(config.retries),
    THU_LEARN_INTERVAL_MS: String(config.requestIntervalMs),
    THU_LEARN_MAX_DOWNLOAD_MB: String(maxDownloadMiB),
  },
});
const client = new Client({ name: 'thu-learn-live-verification', version: '0.1.0' });
// Drain stderr without persisting potentially private third-party diagnostics.
let stderrBytes = 0;
transport.stderr?.on('data', (chunk: Buffer) => {
  stderrBytes += chunk.length;
});
async function call<T extends z.ZodType>(
  name: string,
  args: Record<string, unknown>,
  schema: T,
): Promise<z.output<T>> {
  const response = await client.callTool({ name, arguments: args }, { timeout: 300_000 });
  const result = envelope.parse(response.structuredContent);
  if (!result.ok || response.isError)
    throw new VerificationError(`${name}: ${result.error?.code ?? 'PROTOCOL_ERROR'}`);
  if (!result.complete)
    throw new VerificationError(
      `${name}: incomplete (${result.warnings.map((w) => w.code).join(', ')})`,
    );
  return schema.parse(result.data);
}
async function collect<T extends z.ZodType>(
  name: string,
  args: Record<string, unknown>,
  schema: T,
): Promise<z.output<T>[]> {
  const items: z.output<T>[] = [];
  let offset: number | null = 0;
  do {
    const page: { items: z.output<T>[]; total: number; next_offset: number | null } = await call(
      name,
      { ...args, offset, limit: 100 },
      pageSchema(schema),
    );
    items.push(...page.items);
    if (page.next_offset !== null && page.next_offset <= offset)
      throw new VerificationError(`${name}: non-advancing pagination`);
    offset = page.next_offset;
    if (items.length > 10_000) throw new VerificationError(`${name}: verification limit exceeded`);
  } while (offset !== null);
  return items;
}

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 8);
  emit('tools/list', { count: tools.length });
  const auth = await call('auth_status', {}, authSchema);
  if (!auth.authenticated)
    throw new VerificationError(`auth_status: ${auth.state}; run pnpm auth login`);
  emit('auth_status', { state: auth.state, cross_process_session_reuse: true });
  const courses = await collect('list_courses', {}, courseSchema);
  emit('list_courses', {
    count: courses.length,
    semesters: [...new Set(courses.map((c) => c.semester_id))],
  });
  const assignments = await collect('list_assignments', {}, summarySchema);
  emit('list_assignments', {
    count: assignments.length,
    courses_with_assignments: new Set(assignments.map((a) => a.course_id)).size,
    states: Object.fromEntries(
      ['submitted', 'unsubmitted', 'unknown'].map((state) => [
        state,
        assignments.filter((a) => a.submission_status === state).length,
      ]),
    ),
  });
  const selectedAssignment = assignments.find((a) => a.description_summary) ?? assignments[0];
  if (selectedAssignment) {
    const detail = await call(
      'get_assignment',
      { course_id: selectedAssignment.course_id, assignment_id: selectedAssignment.assignment_id },
      assignmentSchema,
    );
    assert.equal(detail.assignment_id, selectedAssignment.assignment_id);
    assert.equal(detail.title, selectedAssignment.title);
    emit('get_assignment', {
      description_characters: detail.description?.length ?? 0,
      html_characters: detail.description_html?.length ?? 0,
      attachments: detail.attachments.length,
    });
  } else emit('get_assignment', { skipped: 'No assignments in this semester.' });
  const announcementCourse =
    courses.find((c) => c.course_id === selectedAssignment?.course_id) ?? courses[0];
  if (announcementCourse) {
    const announcements = await collect(
      'list_announcements',
      { course_id: announcementCourse.course_id },
      announcementSchema,
    );
    const times = announcements.flatMap((a) =>
      a.published_at ? [Date.parse(a.published_at)] : [],
    );
    assert.deepEqual(
      times,
      [...times].sort((a, b) => b - a),
    );
    emit('list_announcements', { count: announcements.length, sampled_courses: 1 });
  }
  const deadlines = await call(
    'get_upcoming_deadlines',
    { days: 7, overdue_days: 7, include_submitted: true, limit: 100 },
    z.object({
      items: z.array(
        z.object({
          assignment_id: z.string(),
          deadline: z.string(),
          submission_status: z.enum(['submitted', 'unsubmitted', 'unknown']),
        }),
      ),
      total: z.number(),
      time_zone: z.literal('Asia/Shanghai'),
      window_start: z.string(),
      window_end: z.string(),
      unknown_deadline_count: z.number(),
    }),
  );
  const expected = assignments.filter(
    (a) =>
      a.deadline &&
      Date.parse(a.deadline) >= Date.parse(deadlines.window_start) &&
      Date.parse(a.deadline) <= Date.parse(deadlines.window_end),
  );
  assert.equal(deadlines.total, expected.length);
  assert.ok(deadlines.items.every((a) => a.deadline.endsWith('+08:00')));
  const times = deadlines.items.map((a) => Date.parse(a.deadline));
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
  );
  emit('get_upcoming_deadlines', {
    count: deadlines.total,
    time_zone: deadlines.time_zone,
    unknown_deadline_count: deadlines.unknown_deadline_count,
    matches_assignments: true,
  });
  let candidate: z.output<typeof fileSchema> | undefined;
  let sampledCourses = 0;
  let fileCount = 0;
  for (const course of courses) {
    const files = await collect('list_course_files', { course_id: course.course_id }, fileSchema);
    sampledCourses++;
    fileCount += files.length;
    candidate = files.find(
      (file) =>
        file.extension?.replace(/^\./, '').toLowerCase() === 'pdf' &&
        (file.size_bytes === null || file.size_bytes <= maxDownloadMiB * 1024 * 1024),
    );
    if (candidate) break;
  }
  emit('list_course_files', {
    sampled_courses: sampledCourses,
    count: fileCount,
    suitable_pdf_found: Boolean(candidate),
  });
  if (candidate) {
    const saved = await call(
      'download_course_file',
      { course_id: candidate.course_id, file_id: candidate.file_id },
      z.object({
        filename: z.string(),
        local_path: z.string(),
        size_bytes: z.number(),
        sha256: z.string(),
      }),
    );
    assert.equal(resolve(saved.local_path), join(downloadDir, basename(saved.local_path)));
    assert.equal(saved.filename, basename(saved.local_path));
    const bytes = await readFile(saved.local_path);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await stat(saved.local_path)).size, saved.size_bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), saved.sha256);
    assert.match(saved.filename, /\.pdf$/i);
    emit('download_course_file', { ...saved, pdf_header_verified: true });
  } else
    emit('download_course_file', {
      skipped: `No PDF within the ${maxDownloadMiB} MiB verification limit was found. No file downloaded.`,
    });
  emit('complete', { stderr_bytes: stderrBytes, downloaded: Boolean(candidate) });
} catch (error) {
  emit('failed', {
    reason:
      error instanceof VerificationError
        ? error.message
        : 'Protocol, schema, or local file assertion failed. No private diagnostic data was printed.',
  });
  process.exitCode = 1;
} finally {
  await client.close();
}

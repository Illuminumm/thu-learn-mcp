import type { Assignment, Batch, Course, LearnApi, Warning } from '../domain/models.js';
import { AppError, classify, isAuthError } from '../domain/errors.js';
import { shanghaiDate, TIME_ZONE } from '../domain/time.js';
import { DownloadStore } from '../infra/download.js';

export interface PageOptions {
  offset: number;
  limit: number;
}
export interface Scope {
  semester_id?: string | undefined;
  course_id?: string | undefined;
}
function page<T>(items: T[], options: PageOptions) {
  const selected = items.slice(options.offset, options.offset + options.limit);
  return {
    items: selected,
    total: items.length,
    offset: options.offset,
    limit: options.limit,
    next_offset:
      options.offset + selected.length < items.length ? options.offset + selected.length : null,
  };
}
export function result<T>(data: T, warnings: Warning[] = []) {
  return { ok: true as const, data, warnings, complete: warnings.length === 0 };
}
export class LearnService {
  constructor(
    private readonly api: LearnApi,
    private readonly downloads: DownloadStore,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async authStatus() {
    return result(await this.api.authStatus());
  }
  private async scope(options: Scope): Promise<Batch<Course>> {
    const semester = options.semester_id || (await this.api.currentSemester());
    const batch = await this.api.courses(semester);
    if (!options.course_id) return batch;
    const course = batch.items.find((c) => c.course_id === options.course_id);
    if (!course) throw new AppError('NOT_FOUND');
    return { items: [course], warnings: batch.warnings };
  }
  async listCourses(options: Scope & PageOptions) {
    const batch = await this.scope(options);
    return result(page(batch.items, options), batch.warnings);
  }
  private async assignments(options: Scope) {
    const courses = await this.scope(options);
    const items: Assignment[] = [];
    const warnings = [...courses.warnings];
    for (const course of courses.items) {
      try {
        const batch = await this.api.assignments(course.course_id);
        items.push(...batch.items);
        warnings.push(...batch.warnings);
      } catch (error) {
        const e = classify(error);
        if (options.course_id || isAuthError(e) || e.code === 'RATE_LIMITED') throw e;
        warnings.push({ code: e.code, course_id: course.course_id, message: e.message });
      }
    }
    return { items, warnings };
  }
  async listAssignments(
    options: Scope &
      PageOptions & { submission_status?: Assignment['submission_status'] | undefined },
  ) {
    const batch = await this.assignments(options);
    let items = batch.items;
    if (options.submission_status)
      items = items.filter((a) => a.submission_status === options.submission_status);
    items = [...items].sort(
      (a, b) =>
        (a.deadline || 'z').localeCompare(b.deadline || 'z') ||
        a.assignment_id.localeCompare(b.assignment_id),
    );
    const summaries = items.map((item) => {
      const { description, description_html, attachments, ...rest } = item;
      void attachments;
      void description_html;
      return { ...rest, description_summary: description?.slice(0, 500) ?? null };
    });
    return result(page(summaries, options), batch.warnings);
  }
  async getAssignment(options: Scope & { course_id: string; assignment_id: string }) {
    const batch = await this.assignments(options);
    const assignment = batch.items.find((a) => a.assignment_id === options.assignment_id);
    if (!assignment) throw new AppError('NOT_FOUND');
    return result(assignment, batch.warnings);
  }
  async listAnnouncements(
    options: Scope & PageOptions & { course_id: string; order: 'asc' | 'desc' },
  ) {
    await this.scope(options);
    const batch = await this.api.announcements(options.course_id);
    const items = [...batch.items].sort((a, b) => {
      if (!a.published_at) return b.published_at ? 1 : 0;
      if (!b.published_at) return -1;
      return a.published_at.localeCompare(b.published_at) * (options.order === 'asc' ? 1 : -1);
    });
    return result(page(items, options), batch.warnings);
  }
  async listFiles(
    options: Scope &
      PageOptions & {
        course_id: string;
        query?: string | undefined;
        extension?: string | undefined;
        category_id?: string | undefined;
      },
  ) {
    await this.scope(options);
    const batch = await this.api.files(options.course_id);
    const items = batch.items.filter(
      (f) =>
        (!options.query ||
          `${f.name} ${f.description ?? ''}`.toLowerCase().includes(options.query.toLowerCase())) &&
        (!options.extension ||
          f.extension?.replace(/^\./, '').toLowerCase() ===
            options.extension.replace(/^\./, '').toLowerCase()) &&
        (!options.category_id || f.category_id === options.category_id),
    );
    return result(page(items, options), batch.warnings);
  }
  async downloadFile(options: Scope & { course_id: string; file_id: string }) {
    await this.scope(options);
    const batch = await this.api.files(options.course_id);
    const file = batch.items.find((f) => f.file_id === options.file_id);
    if (!file) throw new AppError('NOT_FOUND');
    return result(
      await this.downloads.save(await this.api.download(options.course_id, options.file_id), file),
    );
  }
  async deadlines(
    options: Scope &
      PageOptions & { days: number; overdue_days: number; include_submitted: boolean },
  ) {
    const batch = await this.assignments(options);
    const now = this.now().getTime();
    const end = now + options.days * 86_400_000;
    const start = now - options.overdue_days * 86_400_000;
    const unknown = batch.items.filter((a) => a.deadline === null).length;
    const warnings = [...batch.warnings];
    if (unknown)
      warnings.push({
        code: 'UNKNOWN_DEADLINE',
        course_id: options.course_id ?? null,
        message: `${unknown} assignment(s) have no parseable deadline and are excluded from the time window.`,
      });
    const items = batch.items
      .filter(
        (a) =>
          a.deadline &&
          Date.parse(a.deadline) >= start &&
          Date.parse(a.deadline) <= end &&
          (options.include_submitted || a.submission_status !== 'submitted'),
      )
      .map((a) => ({
        course_id: a.course_id,
        assignment_id: a.assignment_id,
        title: a.title,
        deadline: a.deadline!,
        source_url: a.source_url,
        submission_status: a.submission_status,
        deadline_status:
          Date.parse(a.deadline!) < now ? ('overdue' as const) : ('upcoming' as const),
        status:
          a.submission_status === 'submitted'
            ? ('submitted' as const)
            : a.submission_status === 'unknown'
              ? ('unknown' as const)
              : Date.parse(a.deadline!) < now
                ? ('overdue' as const)
                : ('unsubmitted' as const),
      }))
      .sort(
        (a, b) =>
          a.deadline.localeCompare(b.deadline) || a.assignment_id.localeCompare(b.assignment_id),
      );
    return result(
      {
        ...page(items, options),
        time_zone: TIME_ZONE,
        as_of: shanghaiDate(new Date(now))!,
        window_start: shanghaiDate(new Date(start))!,
        window_end: shanghaiDate(new Date(end))!,
        unknown_deadline_count: unknown,
      },
      warnings,
    );
  }
}

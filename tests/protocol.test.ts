import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let directory: string;
const clients: Client[] = [];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'thu-mcp-protocol-'));
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await rm(directory, { recursive: true, force: true });
});
async function connect(production = false) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: production
      ? [resolve('dist/index.js')]
      : ['--import', 'tsx', resolve('tests/fixture-server.ts')],
    cwd: resolve('.'),
    env: {
      TEST_OUTPUT_DIR: directory,
      THU_LEARN_SESSION_DIR: join(directory, 'session'),
      TZ: 'America/New_York',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'protocol-test', version: '1.0.0' });
  clients.push(client);
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  await client.connect(transport);
  return { client, stderr: () => stderr };
}
describe('MCP stdio with an actual SDK v2 client and server subprocess', () => {
  it('discovers eight tools, validates schemas, executes query and download tools with structured output', async () => {
    const { client, stderr } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'auth_status',
      'list_courses',
      'list_assignments',
      'get_assignment',
      'list_announcements',
      'list_course_files',
      'download_course_file',
      'get_upcoming_deadlines',
    ]);
    expect(tools.every((t) => t.inputSchema && t.outputSchema)).toBe(true);
    expect(tools.find((t) => t.name === 'download_course_file')?.annotations?.readOnlyHint).toBe(
      false,
    );
    const calls: [string, Record<string, unknown>][] = [
      ['auth_status', {}],
      ['list_courses', {}],
      ['list_assignments', {}],
      ['get_assignment', { course_id: 'c1', assignment_id: 'a1' }],
      ['list_announcements', { course_id: 'c1' }],
      ['list_course_files', { course_id: 'c1' }],
      ['get_upcoming_deadlines', { days: 3 }],
      ['download_course_file', { course_id: 'c1', file_id: 'f1' }],
    ];
    for (const [name, args] of calls) {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, name).not.toBe(true);
      expect(response.structuredContent).toMatchObject({ ok: true, complete: true, error: null });
      const content = response.content;
      expect(Array.isArray(content)).toBe(true);
      expect(JSON.stringify(response)).not.toMatch(/test-only-cookie|test-only-csrf/);
    }
    const exists = await client.callTool({
      name: 'download_course_file',
      arguments: { course_id: 'c1', file_id: 'f1' },
    });
    expect(exists.isError).toBe(true);
    expect(exists.structuredContent).toMatchObject({ error: { code: 'FILE_EXISTS' } });
    const bad = await client.callTool({ name: 'list_courses', arguments: { limit: 0 } });
    expect(bad.isError).toBe(true);
    const invalid = await client.callTool({
      name: 'download_course_file',
      arguments: { course_id: 'c1', file_id: '../../etc' },
    });
    expect(invalid.isError).toBe(true);
    const missing = await client.callTool({
      name: 'get_assignment',
      arguments: { course_id: 'c1', assignment_id: 'missing' },
    });
    expect(missing.structuredContent).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(stderr()).toBe('');
  });
  it('starts the built production server with no credentials and returns actionable auth status', async () => {
    const { client, stderr } = await connect(true);
    expect((await client.listTools()).tools).toHaveLength(8);
    expect(
      (await client.callTool({ name: 'auth_status', arguments: {} })).structuredContent,
    ).toMatchObject({
      data: { authenticated: false, state: 'missing', needs_reauthentication: true },
    });
    const denied = await client.callTool({ name: 'list_courses', arguments: {} });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    expect(stderr()).toBe('');
  });
});

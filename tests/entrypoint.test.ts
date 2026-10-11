import { describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);
describe('process boundaries', () => {
  it.each(['UTC', 'America/New_York'])(
    'normalizes upstream naive dates when the parent timezone is %s',
    async (timezone) => {
      const { stdout } = await exec(
        process.execPath,
        ['--import', 'tsx', resolve('tests/timezone-probe.ts')],
        { env: { ...process.env, TZ: timezone } },
      );
      expect(JSON.parse(stdout)).toBe('2026-10-12T00:00:00.000+08:00');
    },
  );
  it('writes only JSON-RPC to production stdout and exits on stdin EOF', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'thu-wire-'));
    const child = spawn(process.execPath, [resolve('dist/index.js')], {
      env: { ...process.env, THU_LEARN_SESSION_DIR: directory },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      let output = '';
      let errors = '';
      child.stderr.on('data', (chunk: Buffer) => {
        errors += chunk.toString();
      });
      const response = new Promise<void>((resolveResponse, reject) => {
        const timeout = setTimeout(() => reject(new Error('Initialization timed out')), 5000);
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes('\n')) {
            clearTimeout(timeout);
            resolveResponse();
          }
        });
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'wire-test', version: '1' } } })}\n`,
      );
      await response;
      const exited = new Promise<number | null>((resolveExit, reject) => {
        const timeout = setTimeout(() => reject(new Error('EOF shutdown timed out')), 5000);
        child.once('exit', (code) => {
          clearTimeout(timeout);
          resolveExit(code);
        });
      });
      child.stdin.end();
      expect(await exited).toBe(0);
      expect(errors).toBe('');
      for (const line of output.trim().split('\n'))
        expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0', id: 1 });
    } finally {
      child.kill();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

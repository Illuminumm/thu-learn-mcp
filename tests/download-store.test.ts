import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, symlink, mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DownloadStore, downloadName, safeFilename } from '../src/infra/download.js';
import { FileSessionStore } from '../src/auth/store.js';
import { file, sessionStore } from './fixtures.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'thu-learn-test-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe('safe local downloads', () => {
  it.each([
    '../a.pdf',
    '..\\a.pdf',
    '/tmp/a',
    'C:\\a.pdf',
    'CON.pdf',
    'NUL',
    'x:ads.pdf',
    'a/b',
    'bad\u0000.pdf',
    'x.',
    '..',
  ])('rejects unsafe filename %s', (name) => {
    expect(() => safeFilename(name)).toThrow();
  });
  it('preserves Unicode filename and extension, creates exclusively and never overwrites', async () => {
    const store = new DownloadStore(root, 100);
    const response = () =>
      new Response('test-pdf', {
        headers: { 'content-disposition': "attachment; filename*=UTF-8''%E8%AE%B2%E4%B9%89.pdf" },
      });
    const saved = await store.save(response(), file);
    expect(saved.filename).toBe('讲义.pdf');
    expect(saved.sha256).toHaveLength(64);
    expect(await readFile(saved.local_path, 'utf8')).toBe('test-pdf');
    await expect(store.save(response(), file)).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    expect(await readFile(saved.local_path, 'utf8')).toBe('test-pdf');
    expect(downloadName(null, file)).toBe('讲义.pdf');
    expect(downloadName(null, { ...file, name: '讲义.pdf' })).toBe('讲义.pdf');
    expect(downloadName(null, { ...file, name: '讲义 1.2' })).toBe('讲义 1.2.pdf');
  });
  it('rejects hostile Content-Disposition, oversized streams and HTML error pages without leftovers', async () => {
    const store = new DownloadStore(root, 2);
    await expect(
      store.save(
        new Response('a', {
          headers: { 'content-disposition': 'attachment; filename="../escape.pdf"' },
        }),
        file,
      ),
    ).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(store.save(new Response('large'), file)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
    await expect(
      store.save(
        new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }),
        file,
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    await expect(store.save(Response.json({ result: 'error' }), file)).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    expect(await readdir(root)).toEqual([]);
  });
  it('rejects a symlink/junction download directory', async () => {
    const target = join(root, 'real');
    const link = join(root, 'link');
    await mkdir(target);
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(new DownloadStore(link, 100).save(new Response('ok'), file)).rejects.toMatchObject(
      { code: 'UNSAFE_PATH' },
    );
    expect(await readdir(target)).toEqual([]);
  });
});
describe('private session store', () => {
  it('roundtrips with platform protection, never prints or stores plaintext secrets on Windows', async () => {
    const store = new FileSessionStore(join(root, 'private'));
    expect(await store.load()).toBeNull();
    const value = (await sessionStore()).value!;
    await store.save(value);
    const raw = await readFile(store.path, 'utf8');
    if (process.platform === 'win32') expect(raw).not.toContain('test-only-cookie');
    else expect((await stat(store.path)).mode & 0o077).toBe(0);
    expect((await store.load())?.cookies.cookies[0]?.value).toBe('test-only-cookie');
    await store.clear();
    expect(await store.load()).toBeNull();
  });
  it('rejects malformed files without exposing contents', async () => {
    const store = new FileSessionStore(root);
    await writeFile(store.path, 'secret malformed session');
    await expect(store.load()).rejects.toMatchObject({ code: 'SESSION_INVALID' });
  });
  it('refuses to change permissions in an unrelated session directory', async () => {
    await writeFile(join(root, 'unrelated.txt'), 'keep');
    const store = new FileSessionStore(root);
    await expect(store.save((await sessionStore()).value!)).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    });
    expect(await readFile(join(root, 'unrelated.txt'), 'utf8')).toBe('keep');
  });
});

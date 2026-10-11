import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SerializedCookieJar } from 'tough-cookie';
import { CookieJar } from 'tough-cookie';
import { AppError, systemCode } from '../domain/errors.js';

export interface Session {
  version: 1;
  updated_at: string;
  cookies: SerializedCookieJar;
}
export interface SessionStore {
  load(): Promise<Session | null>;
  save(session: Session): Promise<void>;
  clear(): Promise<void>;
}
const exec = promisify(execFile);

export async function rejectSymlinkComponents(path: string): Promise<void> {
  const full = resolve(path);
  let part = parse(full).root;
  for (const segment of full.slice(part.length).split(/[\\/]/).filter(Boolean)) {
    part = join(part, segment);
    try {
      if ((await lstat(part)).isSymbolicLink()) throw new AppError('UNSAFE_PATH');
    } catch (error) {
      if (systemCode(error) !== 'ENOENT') throw error;
    }
  }
}
export async function privateDirectory(path: string): Promise<void> {
  await rejectSymlinkComponents(path);
  if (resolve(path) === parse(resolve(path)).root) throw new AppError('STORAGE_ERROR');
  // Never tighten permissions on an unrelated existing directory chosen by mistake.
  const existing = await readdir(path).catch((error: unknown) => {
    if (systemCode(error) === 'ENOENT') return [];
    throw error;
  });
  if (existing.some((name) => !/^auth\.session(?:\.[0-9a-f-]+)?$/.test(name)))
    throw new AppError('STORAGE_ERROR');
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const { stdout } = await exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
      ],
      { windowsHide: true, timeout: 10_000 },
    );
    const sid = stdout.trim();
    if (!/^S-1-[\d-]+$/.test(sid)) throw new AppError('STORAGE_ERROR');
    await exec('icacls.exe', [path, '/reset'], { windowsHide: true, timeout: 10_000 });
    await exec('icacls.exe', [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], {
      windowsHide: true,
      timeout: 10_000,
    });
  } else {
    await chmod(path, 0o700);
  }
}
async function dpapi(value: string, decrypt: boolean): Promise<string> {
  // Sensitive bytes travel over stdin, never command arguments or environment variables.
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $r=[System.Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return await new Promise<string>((resolveResult, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new AppError('STORAGE_ERROR'));
    }, 15_000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.resume();
    child.on('error', () => {
      clearTimeout(timer);
      reject(new AppError('STORAGE_ERROR'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolveResult(output);
      else reject(new AppError('STORAGE_ERROR'));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(value);
  });
}
export class FileSessionStore implements SessionStore {
  readonly path: string;
  constructor(directory: string) {
    this.path = join(directory, 'auth.session');
  }
  async load(): Promise<Session | null> {
    try {
      await rejectSymlinkComponents(this.path);
      const stat = await lstat(this.path);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new AppError('SESSION_INVALID');
      if (
        process.platform !== 'win32' &&
        ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
      )
        throw new AppError('SESSION_INVALID');
      const saved: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (
        typeof saved !== 'object' ||
        saved === null ||
        !('format' in saved) ||
        !('data' in saved) ||
        typeof saved.data !== 'string'
      )
        throw new AppError('SESSION_INVALID');
      const plaintext =
        saved.format === 'dpapi-v1' && process.platform === 'win32'
          ? Buffer.from(await dpapi(saved.data, true), 'base64').toString('utf8')
          : saved.format === 'posix-v1' && process.platform !== 'win32'
            ? saved.data
            : null;
      if (plaintext === null) throw new AppError('SESSION_INVALID');
      const value: unknown = JSON.parse(plaintext);
      if (
        typeof value !== 'object' ||
        value === null ||
        !('version' in value) ||
        value.version !== 1 ||
        !('updated_at' in value) ||
        typeof value.updated_at !== 'string' ||
        !('cookies' in value)
      )
        throw new AppError('SESSION_INVALID');
      const jar = await CookieJar.deserialize(value.cookies as SerializedCookieJar);
      return { version: 1, updated_at: value.updated_at, cookies: await jar.serialize() };
    } catch (error) {
      if (systemCode(error) === 'ENOENT') return null;
      throw new AppError('SESSION_INVALID');
    }
  }
  async save(session: Session): Promise<void> {
    let temporary: string | undefined;
    try {
      await privateDirectory(dirname(this.path));
      await rejectSymlinkComponents(this.path);
      const plaintext = JSON.stringify(session);
      const data =
        process.platform === 'win32'
          ? await dpapi(Buffer.from(plaintext).toString('base64'), false)
          : plaintext;
      temporary = `${this.path}.${randomUUID()}`;
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(
          JSON.stringify({ format: process.platform === 'win32' ? 'dpapi-v1' : 'posix-v1', data }),
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.path);
    } catch {
      throw new AppError('STORAGE_ERROR');
    } finally {
      if (temporary) await unlink(temporary).catch(() => undefined);
    }
  }
  async clear(): Promise<void> {
    await rejectSymlinkComponents(this.path);
    await unlink(this.path).catch((error: unknown) => {
      if (systemCode(error) !== 'ENOENT') throw new AppError('STORAGE_ERROR');
    });
  }
}

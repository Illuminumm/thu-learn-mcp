import { open, unlink, realpath, mkdir } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { AppError, systemCode } from '../domain/errors.js';
import type { CourseFile } from '../domain/models.js';
import { rejectSymlinkComponents } from '../auth/store.js';
import { boundedBody } from './http.js';

export function safeFilename(value: string): string {
  const hasControl = [...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
  if (
    !value ||
    hasControl ||
    value !== value.trim() ||
    value === '.' ||
    value === '..' ||
    value.length > 180 ||
    /[\\/<>:"|?*]/u.test(value) ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value) ||
    isAbsolute(value) ||
    basename(value) !== value
  )
    throw new AppError('UNSAFE_PATH');
  return value;
}
export function downloadName(header: string | null, file: CourseFile): string {
  let name: string | undefined;
  const encoded = header?.match(/filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i)?.[1];
  if (encoded) {
    try {
      name = decodeURIComponent(encoded.trim());
    } catch {
      throw new AppError('UNSAFE_PATH');
    }
  }
  if (!name)
    name =
      header?.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ||
      header?.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim();
  if (!name) {
    name = file.name;
    const extension = file.extension?.replace(/^\./, '');
    if (
      extension &&
      /^[a-zA-Z0-9]{1,12}$/.test(extension) &&
      !name.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
    )
      name += `.${extension}`;
  }
  return safeFilename(name);
}
export class DownloadStore {
  constructor(
    private readonly directory: string,
    private readonly maxBytes: number,
  ) {}
  async save(response: Response, file: CourseFile) {
    let path: string | undefined;
    let created = false;
    try {
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError('UPSTREAM_ERROR');
      }
      const contentType = response.headers.get('content-type') || '';
      if (/text\/html/i.test(contentType) && !/html?$/i.test(file.extension || '')) {
        await response.body?.cancel();
        throw new AppError('UPSTREAM_ERROR');
      }
      if (/application\/json/i.test(contentType) && !/^\.?json$/i.test(file.extension || '')) {
        await response.body?.cancel();
        throw new AppError('UPSTREAM_ERROR');
      }
      const name = downloadName(response.headers.get('content-disposition'), file);
      await rejectSymlinkComponents(this.directory);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const root = await realpath(this.directory);
      path = resolve(root, name);
      if (path !== join(root, name)) throw new AppError('UNSAFE_PATH');
      const handle = await open(path, 'wx', 0o600);
      created = true;
      try {
        const bytes = await boundedBody(response, this.maxBytes);
        await handle.writeFile(bytes);
        await handle.sync();
        return {
          course_id: file.course_id,
          file_id: file.file_id,
          filename: name,
          local_path: path,
          size_bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          source_url: file.source_url,
        };
      } finally {
        await handle.close();
      }
    } catch (error) {
      await response.body?.cancel().catch(() => undefined);
      if (created && path) await unlink(path).catch(() => undefined);
      if (error instanceof AppError) throw error;
      if (systemCode(error) === 'EEXIST') throw new AppError('FILE_EXISTS');
      throw new AppError('STORAGE_ERROR');
    }
  }
}

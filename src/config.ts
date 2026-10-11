import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { AppError } from './domain/errors.js';

export interface Config {
  sessionDir: string;
  downloadDir: string;
  requestTimeoutMs: number;
  retries: number;
  requestIntervalMs: number;
  cacheTtlMs: number;
  maxDownloadBytes: number;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = z
    .object({
      THU_LEARN_SESSION_DIR: z.string().optional(),
      THU_LEARN_DOWNLOAD_DIR: z.string().optional(),
      THU_LEARN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
      THU_LEARN_RETRIES: z.coerce.number().int().min(0).max(2).default(2),
      THU_LEARN_INTERVAL_MS: z.coerce.number().int().min(100).max(10_000).default(200),
      THU_LEARN_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(60_000),
      THU_LEARN_MAX_DOWNLOAD_MB: z.coerce.number().int().min(1).max(256).default(64),
    })
    .safeParse(env);
  if (!parsed.success) throw new AppError('INVALID_INPUT');
  const v = parsed.data;
  for (const path of [v.THU_LEARN_SESSION_DIR, v.THU_LEARN_DOWNLOAD_DIR])
    if (path && !isAbsolute(path)) throw new AppError('INVALID_INPUT');
  const base =
    process.platform === 'win32'
      ? env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
      : env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return {
    sessionDir: resolve(v.THU_LEARN_SESSION_DIR || join(base, 'thu-learn-mcp')),
    downloadDir: resolve(v.THU_LEARN_DOWNLOAD_DIR || join(homedir(), 'Downloads', 'thu-learn-mcp')),
    requestTimeoutMs: v.THU_LEARN_TIMEOUT_MS,
    retries: v.THU_LEARN_RETRIES,
    requestIntervalMs: v.THU_LEARN_INTERVAL_MS,
    cacheTtlMs: v.THU_LEARN_CACHE_TTL_MS,
    maxDownloadBytes: v.THU_LEARN_MAX_DOWNLOAD_MB * 1024 * 1024,
  };
}

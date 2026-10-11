import { CookieJar } from 'tough-cookie';
import { setTimeout as delay } from 'node:timers/promises';
import type { Config } from '../config.js';
import { AppError, classify } from '../domain/errors.js';
import { Mutex } from './mutex.js';

export const LEARN_ORIGIN = 'https://learn.tsinghua.edu.cn';
export function safeSchoolUrl(input: string | URL): URL {
  const url = new URL(input);
  if (url.origin !== LEARN_ORIGIN || url.username || url.password)
    throw new AppError('UNSAFE_PATH');
  return url;
}
export async function boundedBody(
  response: Response,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new AppError('FILE_TOO_LARGE');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > limit) throw new AppError('FILE_TOO_LARGE');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const all = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    all.set(chunk, position);
    position += chunk.length;
  }
  return all;
}
export class SchoolHttp {
  readonly fetch: typeof globalThis.fetch;
  lastError: AppError | undefined;
  private readonly gate = new Mutex();
  private lastRequest = 0;
  private blockedError: AppError | undefined;
  constructor(
    private readonly jar: CookieJar,
    private readonly config: Config,
    private readonly network: typeof globalThis.fetch = globalThis.fetch,
    private readonly lifetime?: AbortSignal,
  ) {
    this.fetch = (input, init) => this.gate.run(() => this.request(input, init));
  }
  private async request(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    if (this.blockedError) throw this.blockedError;
    if (this.lifetime?.aborted) throw new AppError('TIMEOUT');
    const source = input instanceof Request ? input.url : input.toString();
    const url = safeSchoolUrl(source);
    // All uses are fixed read endpoints in thu-learn-lib, including read-only POST queries.
    for (let attempt = 0; ; attempt++) {
      const wait = this.config.requestIntervalMs - (Date.now() - this.lastRequest);
      if (wait > 0) await delay(wait, undefined, this.lifetime ? { signal: this.lifetime } : {});
      this.lastRequest = Date.now();
      try {
        return await this.once(url, init);
      } catch (error) {
        const mapped =
          error instanceof AppError
            ? error
            : error instanceof TypeError
              ? new AppError('NETWORK_ERROR')
              : classify(error);
        if (
          this.lifetime?.aborted ||
          attempt >= this.config.retries ||
          !['NETWORK_ERROR', 'TIMEOUT', 'UPSTREAM_ERROR'].includes(mapped.code)
        ) {
          this.lastError = mapped;
          this.blockedError = mapped;
          throw mapped;
        }
        await delay(500 * 2 ** attempt, undefined, this.lifetime ? { signal: this.lifetime } : {});
      }
    }
  }
  private async once(start: URL, init?: RequestInit): Promise<Response> {
    let url = start;
    let method = init?.method || 'GET';
    let body = init?.body;
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs);
    const signals = [
      timeout,
      ...(init?.signal ? [init.signal] : []),
      ...(this.lifetime ? [this.lifetime] : []),
    ];
    const signal = AbortSignal.any(signals);
    for (let redirect = 0; redirect <= 5; redirect++) {
      const headers = new Headers(init?.headers);
      headers.delete('authorization');
      headers.set('cookie', await this.jar.getCookieString(url.href));
      const response = await this.network(url, {
        ...init,
        method,
        body: body ?? null,
        headers,
        redirect: 'manual',
        signal,
      });
      for (const cookie of response.headers.getSetCookie())
        await this.jar.setCookie(cookie, url.href);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new AppError('UPSTREAM_ERROR');
        const target = new URL(location, url);
        if (
          target.hostname === 'id.tsinghua.edu.cn' ||
          /login|login_timeout/i.test(target.pathname)
        )
          throw new AppError('AUTH_REQUIRED');
        url = safeSchoolUrl(target);
        if (
          response.status === 303 ||
          ([301, 302].includes(response.status) && method === 'POST')
        ) {
          method = 'GET';
          body = undefined;
        }
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) throw new AppError('AUTH_REQUIRED');
        if (response.status === 429) throw new AppError('RATE_LIMITED');
        if (response.status === 404) throw new AppError('NOT_FOUND');
        throw new AppError(response.status >= 500 ? 'UPSTREAM_ERROR' : 'INVALID_INPUT');
      }
      const download = /\/downloadFile(?:\/|$)/.test(url.pathname);
      const bytes = await boundedBody(
        response,
        download ? this.config.maxDownloadBytes : 16 * 1024 * 1024,
      );
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        const prefix = new TextDecoder().decode(bytes.subarray(0, 65536));
        if (/name=["']i_pass["']|login_timeout|\/do\/off\/ui\/auth\/login\//i.test(prefix))
          throw new AppError('AUTH_REQUIRED');
      }
      // Buffering keeps timeout/size enforcement active through body consumption by the upstream parser.
      const result = new Response(bytes, { status: response.status, headers: response.headers });
      Object.defineProperty(result, 'url', { value: url.href });
      return result;
    }
    throw new AppError('UPSTREAM_ERROR');
  }
}

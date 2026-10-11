import { addCSRFTokenToUrl, Learn2018Helper } from 'thu-learn-lib';
import { CookieJar } from 'tough-cookie';
import type { Config } from '../config.js';
import { AppError, classify, isAuthError } from '../domain/errors.js';
import type { AuthStatus } from '../domain/models.js';
import { nowShanghai } from '../domain/time.js';
import { SchoolHttp } from '../infra/http.js';
import { Mutex } from '../infra/mutex.js';
import type { SessionStore } from './store.js';
import { upstreamError } from '../adapter/errors.js';

export type LearnReader = Pick<
  Learn2018Helper,
  | 'login'
  | 'getCurrentSemester'
  | 'getCourseList'
  | 'getHomeworkList'
  | 'getNotificationList'
  | 'getFileList'
  | 'getCSRFToken'
>;
export interface Authentication {
  run<T>(operation: (reader: LearnReader) => Promise<T>): Promise<T>;
  status(): Promise<AuthStatus>;
  fetchWithSession(url: URL): Promise<Response>;
}
export async function verifySession(reader: LearnReader): Promise<void> {
  const semester = await reader.getCurrentSemester();
  if (typeof semester.id !== 'string' || !semester.id.trim()) throw new AppError('UPSTREAM_ERROR');
}
export class AuthenticationManager implements Authentication {
  private readonly mutex = new Mutex();
  private readonly lifetime = new AbortController();
  private current:
    { fingerprint: string; reader: LearnReader; jar: CookieJar; http: SchoolHttp } | undefined;
  constructor(
    private readonly store: SessionStore,
    private readonly config: Config,
    private readonly network: typeof globalThis.fetch = globalThis.fetch,
  ) {}
  async run<T>(operation: (reader: LearnReader) => Promise<T>): Promise<T> {
    return this.mutex.run(async () => {
      const saved = await this.store.load();
      if (!saved) {
        this.current = undefined;
        throw new AppError('AUTH_REQUIRED');
      }
      const fingerprint = JSON.stringify(saved);
      if (!this.current || this.current.fingerprint !== fingerprint) {
        const jar = await CookieJar.deserialize(saved.cookies);
        const http = new SchoolHttp(jar, this.config, this.network, this.lifetime.signal);
        const reader = new Learn2018Helper({ fetch: http.fetch });
        this.current = { fingerprint, reader, jar, http };
        try {
          await reader.login();
        } catch (error) {
          this.current = undefined;
          throw http.lastError || upstreamError(error);
        }
      }
      const context = this.current;
      if (!context) throw new AppError('AUTH_REQUIRED');
      context.http.lastError = undefined;
      try {
        const result = await operation(context.reader);
        // The upstream library suppresses errors in optional subqueries; never hide auth/rate failures.
        if (context.http.lastError) throw context.http.lastError;
        const cookies = await context.jar.serialize();
        // Read calls can rotate session cookies. Only persist when the jar actually changed.
        const stableCookies = (value: typeof cookies) =>
          JSON.stringify(value, (key, entry: unknown) =>
            key === 'lastAccessed' ? undefined : entry,
          );
        if (stableCookies(cookies) !== stableCookies(saved.cookies)) {
          const refreshed = { version: 1 as const, updated_at: new Date().toISOString(), cookies };
          await this.store.save(refreshed);
          context.fingerprint = JSON.stringify(refreshed);
        }
        return result;
      } catch (error) {
        const mapped = context.http.lastError || upstreamError(error);
        this.current = undefined;
        throw mapped;
      }
    });
  }
  close(): void {
    this.lifetime.abort();
    this.current = undefined;
  }
  fetchWithSession(url: URL): Promise<Response> {
    return this.run((reader) => {
      if (!this.current) throw new AppError('AUTH_REQUIRED');
      return this.current.http.fetch(addCSRFTokenToUrl(url.href, reader.getCSRFToken()));
    });
  }
  async status(): Promise<AuthStatus> {
    try {
      const saved = await this.store.load();
      if (!saved)
        return {
          authenticated: false,
          needs_reauthentication: true,
          state: 'missing',
          checked_at: nowShanghai(),
          guidance: new AppError('AUTH_REQUIRED').message,
          error_code: 'AUTH_REQUIRED',
        };
      await this.run(verifySession);
      return {
        authenticated: true,
        needs_reauthentication: false,
        state: 'authenticated',
        checked_at: nowShanghai(),
        guidance: null,
        error_code: null,
      };
    } catch (error) {
      const e = classify(error);
      return {
        authenticated: false,
        needs_reauthentication: isAuthError(e),
        state:
          e.code === 'SESSION_INVALID' ? 'invalid' : isAuthError(e) ? 'expired' : 'unavailable',
        checked_at: nowShanghai(),
        guidance: e.message,
        error_code: e.code,
      };
    }
  }
}

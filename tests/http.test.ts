import { describe, expect, it, vi } from 'vitest';
import { CookieJar } from 'tough-cookie';
import { SchoolHttp } from '../src/infra/http.js';
import { config } from './fixtures.js';

describe('restricted school transport', () => {
  it('retries transient errors finitely and serializes concurrent calls', async () => {
    let active = 0;
    let peak = 0;
    let count = 0;
    const network: typeof fetch = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      count++;
      return new Response('ok', { status: count === 1 ? 503 : 200 });
    };
    const http = new SchoolHttp(new CookieJar(), { ...config, retries: 1 }, network);
    await Promise.all([
      http.fetch('https://learn.tsinghua.edu.cn/read1'),
      http.fetch('https://learn.tsinghua.edu.cn/read2'),
    ]);
    expect(peak).toBe(1);
    expect(count).toBe(3);
    expect(http.lastError).toBeUndefined();
  });
  it('stops on 429 without retrying queued requests', async () => {
    const network = vi.fn(async () => new Response(null, { status: 429 }));
    const http = new SchoolHttp(new CookieJar(), { ...config, retries: 2 }, network);
    const results = await Promise.allSettled([
      http.fetch('https://learn.tsinghua.edu.cn/a'),
      http.fetch('https://learn.tsinghua.edu.cn/b'),
    ]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(network).toHaveBeenCalledTimes(1);
    expect(http.lastError?.code).toBe('RATE_LIMITED');
  });
  it('blocks off-origin redirects, login redirects and insecure URLs without sending cookies', async () => {
    for (const [target, code] of [
      ['https://evil.example/file', 'UNSAFE_PATH'],
      ['https://id.tsinghua.edu.cn/login', 'AUTH_REQUIRED'],
      ['http://learn.tsinghua.edu.cn/file', 'UNSAFE_PATH'],
    ]) {
      const network = vi.fn(
        async () => new Response(null, { status: 302, headers: { location: target! } }),
      );
      await expect(
        new SchoolHttp(new CookieJar(), config, network).fetch('https://learn.tsinghua.edu.cn/a'),
      ).rejects.toMatchObject({ code });
      expect(network).toHaveBeenCalledTimes(1);
    }
  });
  it('times out slow responses', async () => {
    const network: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            reject(init.signal?.reason);
          },
          { once: true },
        );
      });
    await expect(
      new SchoolHttp(new CookieJar(), { ...config, requestTimeoutMs: 20 }, network).fetch(
        'https://learn.tsinghua.edu.cn/a',
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  it('cancels in-flight and queued HTTP requests when the server closes', async () => {
    const lifetime = new AbortController();
    const network = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const http = new SchoolHttp(
      new CookieJar(),
      { ...config, retries: 2 },
      network,
      lifetime.signal,
    );
    const pending = Promise.allSettled([
      http.fetch('https://learn.tsinghua.edu.cn/a'),
      http.fetch('https://learn.tsinghua.edu.cn/b'),
    ]);
    await new Promise((r) => setTimeout(r, 10));
    lifetime.abort();
    expect((await pending).every((r) => r.status === 'rejected')).toBe(true);
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('enforces byte limits, retains equals signs in cookies and detects HTML login responses', async () => {
    const jar = new CookieJar();
    const network = vi.fn(
      async () =>
        new Response('abc', { headers: { 'set-cookie': 'session=a=b=c; Path=/; Secure' } }),
    );
    await new SchoolHttp(jar, config, network).fetch('https://learn.tsinghua.edu.cn/a');
    expect(await jar.getCookieString('https://learn.tsinghua.edu.cn')).toBe('session=a=b=c');
    const large = new SchoolHttp(jar, { ...config, maxDownloadBytes: 2 }, network);
    await expect(large.fetch('https://learn.tsinghua.edu.cn/downloadFile')).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
    const login = new SchoolHttp(
      jar,
      config,
      async () =>
        new Response('<input name="i_pass">', { headers: { 'content-type': 'text/html' } }),
    );
    await expect(login.fetch('https://learn.tsinghua.edu.cn/a')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });
});

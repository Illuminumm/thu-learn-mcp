import { describe, expect, it, vi } from 'vitest';
import { AuthenticationManager } from '../src/auth/manager.js';
import { importBrowserCookies } from '../src/auth/browser.js';
import { ThuLearnAdapter, sourceUrl, descriptionHtml } from '../src/adapter/thu-learn.js';
import { config, MemoryStore, schoolNetwork, sessionStore } from './fixtures.js';

describe('installed thu-learn-lib integration with synthetic HTTP', () => {
  it('reuses imported browser cookies through the real helper, fetches CSRF and restores across managers', async () => {
    const jar = await importBrowserCookies([
      {
        name: 'JSESSIONID',
        value: 'test-only-cookie',
        domain: '.tsinghua.edu.cn',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
      {
        name: 'unrelated',
        value: 'secret',
        domain: 'id.tsinghua.edu.cn',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    const store = new MemoryStore({
      version: 1,
      updated_at: 'test',
      cookies: await jar.serialize(),
    });
    expect((await jar.getCookies('https://learn.tsinghua.edu.cn')).map((c) => c.key)).toEqual([
      'JSESSIONID',
    ]);
    expect(await jar.getCookies('https://id.tsinghua.edu.cn')).toEqual([]);
    for (let i = 0; i < 2; i++)
      expect(
        (await new AuthenticationManager(store, config, schoolNetwork()).status()).authenticated,
      ).toBe(true);
  });
  it('maps courses, complete assignments with attachments, announcements and files using actual library code', async () => {
    const api = new ThuLearnAdapter(
      new AuthenticationManager(await sessionStore(), config, schoolNetwork()),
    );
    expect(await api.currentSemester()).toBe('2026-2027-1');
    expect((await api.courses('2026-2027-1')).items[0]).toMatchObject({
      course_id: 'c1',
      teacher: '测试教师',
    });
    const a = (await api.assignments('c1')).items[0];
    expect(a).toMatchObject({
      assignment_id: 'a1',
      description: '完整题目\n第二段',
      published_at: null,
      deadline: '2026-10-12T00:00:00.000+08:00',
      submission_status: 'unsubmitted',
    });
    expect(a?.attachments[0]).toMatchObject({
      file_id: 'att1',
      name: '题目.pdf',
      kind: 'assignment',
    });
    expect((await api.announcements('c1')).items[0]).toMatchObject({
      content: '下周上课',
      published_at: '2026-10-11T12:00:00.000+08:00',
    });
    expect((await api.files('c1')).items[0]).toMatchObject({
      file_id: 'f1',
      entry_id: 'entry1',
      size_bytes: 8,
    });
    expect(await (await api.download('c1', 'f1')).text()).toBe('test-pdf');
    expect(JSON.stringify(a)).not.toMatch(/test-only-cookie|test-only-csrf/);
  });
  it('caches lists but reloads on session replacement and never caches auth status', async () => {
    const calls: string[] = [];
    const store = await sessionStore();
    const api = new ThuLearnAdapter(new AuthenticationManager(store, config, schoolNetwork(calls)));
    await api.courses('s1');
    await api.courses('s1');
    expect(calls.filter((p) => p.includes('loadCourseBySemesterId'))).toHaveLength(1);
    await store.clear();
    await expect(api.courses('s1')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
  it('reports missing, expired, malformed upstream and network failure separately without raw data', async () => {
    expect((await new AuthenticationManager(new MemoryStore(), config).status()).state).toBe(
      'missing',
    );
    const forbidden = new AuthenticationManager(
      await sessionStore(),
      config,
      async () => new Response(null, { status: 403 }),
    );
    expect(await forbidden.status()).toMatchObject({
      state: 'expired',
      needs_reauthentication: true,
    });
    const offline = new AuthenticationManager(await sessionStore(), config, async () => {
      throw new TypeError('secret request URL');
    });
    expect(await offline.status()).toMatchObject({
      state: 'unavailable',
      error_code: 'NETWORK_ERROR',
      needs_reauthentication: false,
    });
    const base = schoolNetwork();
    const bad = new AuthenticationManager(await sessionStore(), config, async (input, init) =>
      input.toString().includes('getCurrentAndNextSemester')
        ? Response.json({ message: 'failure', secret: 'never disclose' })
        : base(input, init),
    );
    const status = await bad.status();
    expect(status.error_code).toBe('UPSTREAM_ERROR');
    expect(JSON.stringify(status)).not.toContain('never disclose');
  });
  it('does not repeatedly persist unchanged cookie access timestamps', async () => {
    const store = await sessionStore();
    const save = vi.spyOn(store, 'save');
    const auth = new AuthenticationManager(store, config, schoolNetwork());
    await auth.status();
    await auth.status();
    expect(save).not.toHaveBeenCalled();
  });
  it('strips secret URL parameters and refuses off-site links', () => {
    expect(sourceUrl('https://learn.tsinghua.edu.cn/x?id=1&_csrf=secret&token=secret')).toBe(
      'https://learn.tsinghua.edu.cn/x?id=1',
    );
    expect(sourceUrl('https://evil.example/file')).toBeNull();
  });
  it('preserves cookie paths and expiry while rejecting unrelated and expired cookies', async () => {
    const cookie = {
      name: 'path_session',
      value: 'v',
      domain: 'learn.tsinghua.edu.cn',
      path: '/f',
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict' as const,
    };
    const jar = await importBrowserCookies([
      cookie,
      { ...cookie, name: 'expired', expires: 1 },
      { ...cookie, name: 'other', domain: 'attacker.example' },
    ]);
    expect(await jar.getCookieString('https://learn.tsinghua.edu.cn/f/x')).toBe('path_session=v');
    expect(await jar.getCookieString('https://learn.tsinghua.edu.cn/b/x')).toBe('');
    expect(await jar.getCookieString('http://learn.tsinghua.edu.cn/f/x')).toBe('');
  });
  it('classifies malformed assignment HTML as upstream error instead of claiming an empty result', async () => {
    const base = schoolNetwork();
    const auth = new AuthenticationManager(await sessionStore(), config, (input, init) =>
      input.toString().includes('/viewCj')
        ? Promise.resolve(new Response('<html>changed layout</html>'))
        : base(input, init),
    );
    await expect(new ThuLearnAdapter(auth).assignments('c1')).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
  });
  it('preserves image/table/math content while removing active HTML and authentication URL parameters', () => {
    const html = descriptionHtml(
      '<p onclick="bad()">题目</p><table><tr><td>数据</td></tr></table><img src="/image?id=1&_csrf=secret" onerror="bad()"><script>secret-script</script><script type="math/tex">x^2</script><a href="javascript:bad()">link</a>',
    );
    expect(html).toContain('<table>');
    expect(html).toContain('src="https://learn.tsinghua.edu.cn/image?id=1"');
    expect(html).toContain('<code>x^2</code>');
    expect(html).not.toMatch(/onerror|onclick|secret|javascript|<script/);
  });
});

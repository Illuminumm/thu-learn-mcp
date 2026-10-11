import { chromium, type Cookie as BrowserCookie } from 'playwright';
import { Cookie, CookieJar } from 'tough-cookie';
import { Learn2018Helper } from 'thu-learn-lib';
import type { Config } from '../config.js';
import { AppError } from '../domain/errors.js';
import { upstreamError } from '../adapter/errors.js';
import { LEARN_ORIGIN, SchoolHttp } from '../infra/http.js';
import type { SessionStore } from './store.js';
import { verifySession } from './manager.js';

export async function importBrowserCookies(cookies: BrowserCookie[]): Promise<CookieJar> {
  const jar = new CookieJar();
  for (const c of cookies) {
    const domain = c.domain.replace(/^\./, '');
    // Narrow parent-domain cookies to Learn. Do not store unrelated school SSO sessions.
    if (domain !== 'learn.tsinghua.edu.cn' && domain !== 'tsinghua.edu.cn') continue;
    if (c.expires > 0 && c.expires * 1000 <= Date.now()) continue;
    const cookie = new Cookie({
      key: c.name,
      value: c.value,
      domain: 'learn.tsinghua.edu.cn',
      hostOnly: true,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite.toLowerCase(),
      ...(c.expires > 0 ? { expires: new Date(c.expires * 1000) } : {}),
    });
    await jar.setCookie(cookie, `${LEARN_ORIGIN}${c.path}`);
  }
  return jar;
}
export async function interactiveLogin(store: SessionStore, config: Config): Promise<void> {
  const browser = await chromium.launch({ headless: false }).catch(() => {
    throw new AppError('BROWSER_UNAVAILABLE');
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    process.stderr.write(
      '请在浏览器中自行完成统一身份认证、验证码和二次认证。成功进入学生课程首页后会自动验证并保存。请勿在 Agent 对话中输入密码。\n',
    );
    await page.goto(`${LEARN_ORIGIN}/f/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForURL(
      (url) =>
        url.origin === LEARN_ORIGIN && url.pathname.startsWith('/f/wlxt/index/course/student'),
      { timeout: 10 * 60_000 },
    );
    await page.waitForLoadState('domcontentloaded');
    // Query all paths, then narrow to Learn in importBrowserCookies. Querying only the
    // origin URL would drop cookies whose paths are /f or /b.
    const jar = await importBrowserCookies(await context.cookies());
    const http = new SchoolHttp(jar, config);
    const helper = new Learn2018Helper({ fetch: http.fetch });
    try {
      await helper.login();
      await verifySession(helper);
    } catch (error) {
      throw http.lastError || upstreamError(error);
    }
    if ((await jar.getCookies(LEARN_ORIGIN)).length === 0) throw new AppError('AUTH_REQUIRED');
    await store.save({
      version: 1,
      updated_at: new Date().toISOString(),
      cookies: await jar.serialize(),
    });
    process.stderr.write('认证已由 thu-learn-lib 实际请求验证，会话已保存到本机私有目录。\n');
  } finally {
    await browser.close();
  }
}

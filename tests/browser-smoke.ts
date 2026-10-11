// Explicit opt-in smoke: requires `pnpm exec playwright install chromium`.
// All page requests are fulfilled locally; this never contacts the school.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { importBrowserCookies } from '../src/auth/browser.js';

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.route('**/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Local authentication smoke fixture</title><p>Only synthetic content.</p>',
    }),
  );
  const page = await context.newPage();
  await page.goto('https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/');
  await context.addCookies([
    {
      name: 'JSESSIONID',
      value: 'synthetic-browser-session',
      domain: 'learn.tsinghua.edu.cn',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'PATH_SESSION',
      value: 'path-only',
      domain: 'learn.tsinghua.edu.cn',
      path: '/f',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
    {
      name: 'SSO_OTHER',
      value: 'excluded',
      domain: 'id.tsinghua.edu.cn',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  const jar = await importBrowserCookies(await context.cookies());
  assert.match(await jar.getCookieString(page.url()), /JSESSIONID=synthetic-browser-session/);
  assert.match(await jar.getCookieString(page.url()), /PATH_SESSION=path-only/);
  assert.doesNotMatch(
    await jar.getCookieString('https://learn.tsinghua.edu.cn/b/query'),
    /PATH_SESSION/,
  );
  assert.equal(await jar.getCookieString('https://id.tsinghua.edu.cn/'), '');
  process.stdout.write(
    'PASS: Chromium launch and scoped Cookie transfer (local interception only).\n',
  );
} finally {
  await browser.close();
}

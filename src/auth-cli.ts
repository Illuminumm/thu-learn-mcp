#!/usr/bin/env node
process.env.TZ = 'Asia/Shanghai';
const { classify } = await import('./domain/errors.js');
try {
  const [{ readConfig }, { FileSessionStore }, { AuthenticationManager }] = await Promise.all([
    import('./config.js'),
    import('./auth/store.js'),
    import('./auth/manager.js'),
  ]);
  const config = readConfig();
  const store = new FileSessionStore(config.sessionDir);
  const command = process.argv[2];
  if (command === 'login') {
    const { interactiveLogin } = await import('./auth/browser.js');
    await interactiveLogin(store, config);
  } else if (command === 'status') {
    process.stdout.write(
      `${JSON.stringify(await new AuthenticationManager(store, config).status(), null, 2)}\n`,
    );
  } else if (command === 'clear') {
    await store.clear();
    process.stderr.write(
      'Local saved session removed. The school browser session is not logged out.\n',
    );
  } else {
    process.stderr.write('Usage: pnpm auth <login|status|clear>\n');
    process.exitCode = 2;
  }
} catch (error) {
  const e = classify(error);
  process.stderr.write(`${e.code}: ${e.message}\n`);
  process.exitCode = 1;
}

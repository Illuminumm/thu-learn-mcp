process.env.TZ = 'Asia/Shanghai';
const [{ ThuLearnAdapter }, { AuthenticationManager }, { config, sessionStore, schoolNetwork }] =
  await Promise.all([
    import('../src/adapter/thu-learn.js'),
    import('../src/auth/manager.js'),
    import('./fixtures.js'),
  ]);
const adapter = new ThuLearnAdapter(
  new AuthenticationManager(await sessionStore(), config, schoolNetwork()),
);
process.stdout.write(JSON.stringify((await adapter.assignments('c1')).items[0]?.deadline));

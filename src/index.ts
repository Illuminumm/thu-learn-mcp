#!/usr/bin/env node
// Upstream constructs Date from school-local strings. Set TZ before importing it.
process.env.TZ = 'Asia/Shanghai';
try {
  const [{ createApplication }, { StdioServerTransport }] = await Promise.all([
    import('./app.js'),
    import('@modelcontextprotocol/server/stdio'),
  ]);
  const server = createApplication();
  await server.connect(new StdioServerTransport());
  const close = () => {
    void server.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch {
  process.stderr.write(
    'THU Learn MCP startup failed. Check local configuration and dependency installation.\n',
  );
  process.exitCode = 1;
}

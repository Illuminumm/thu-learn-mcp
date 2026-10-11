// Only this test executable composes mocks. The production executable has no fixture mode.
process.env.TZ = 'Asia/Shanghai';
const [
  { createServer },
  { StdioServerTransport },
  { LearnService },
  { DownloadStore },
  { mockApi },
] = await Promise.all([
  import('../src/mcp/server.js'),
  import('@modelcontextprotocol/server/stdio'),
  import('../src/service/learn.js'),
  import('../src/infra/download.js'),
  import('./fixtures.js'),
]);
const directory = process.env.TEST_OUTPUT_DIR;
if (!directory) throw new Error('Missing test directory');
await createServer(
  new LearnService(
    mockApi(),
    new DownloadStore(directory, 1024),
    () => new Date('2026-10-11T04:00:00Z'),
  ),
).connect(new StdioServerTransport());

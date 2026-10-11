import { ThuLearnAdapter } from './adapter/thu-learn.js';
import { AuthenticationManager } from './auth/manager.js';
import { FileSessionStore } from './auth/store.js';
import { readConfig } from './config.js';
import { DownloadStore } from './infra/download.js';
import { LearnService } from './service/learn.js';
import { createServer } from './mcp/server.js';

export function createApplication() {
  const config = readConfig();
  const auth = new AuthenticationManager(new FileSessionStore(config.sessionDir), config);
  const adapter = new ThuLearnAdapter(auth, config.cacheTtlMs);
  const server = createServer(
    new LearnService(adapter, new DownloadStore(config.downloadDir, config.maxDownloadBytes)),
  );
  server.server.onclose = () => auth.close();
  return server;
}

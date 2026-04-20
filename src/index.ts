import { loadConfig } from './config';
import { startProxy } from './proxy';

async function main(): Promise<void> {
  console.log('[init] Loading configuration...');
  const config = await loadConfig();
  console.log(`[init] Loaded ${Object.keys(config.models).length} model(s), ${Object.keys(config.providers).length} provider(s)`);

  console.log('[init] Starting proxy server...');
  const server = startProxy(config.port);

  console.log(`[init] Dashboard:       http://localhost:${server.port}/`);
  console.log(`[init] Chat completions: POST http://localhost:${server.port}/v1/chat/completions`);
  console.log(`[init] Model list:      GET  http://localhost:${server.port}/v1/models`);
  console.log('');
  console.log('[init] Ready. Press Ctrl+C to stop.');
  await new Promise(() => { });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});

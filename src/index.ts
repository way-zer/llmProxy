import { loadConfig, getAllModels } from './config';
import { startProxy } from './proxy';
import { initRecorder } from './recorder';

async function main(): Promise<void> {
  console.log('[启动] 正在加载配置...');
  const config = await loadConfig();
  initRecorder(config.recorder?.enabled !== false);
  console.log(`[启动] 已加载 ${getAllModels().length} 个模型, ${Object.keys(config.providers).length} 个提供商`);

  console.log('[启动] 正在启动代理服务器...');
  const server = startProxy(config.port);

  console.log(`[启动] 管理面板:       http://localhost:${server.port}/`);
  console.log(`[init] Chat completions: POST http://localhost:${server.port}/v1/chat/completions`);
  console.log(`[init] Model list:      GET  http://localhost:${server.port}/v1/models`);
  console.log('');
  console.log('[启动] 就绪。按 Ctrl+C 退出。');
  await new Promise(() => { });
}

main().catch((err) => {
  console.error('[致命错误]', err);
  process.exit(1);
});

import { getConfig } from './config';
import { CORS, json } from './http';
import {
  handleListProviders, handleAddProvider, handleUpdateProvider, handleRemoveProvider,
  handleScanProvider, handleGetProviderScan,
  handleImportAll, handleImportOne,
  handleListModelDefs, handleAddModelDef, handleRemoveModelDef,
  handleListMappings, handleAddMapping, handleUpdateMapping, handleRemoveMapping,
  handleTestModel,
  handleTestDirect,
  handleReload,
} from './admin';
import { queryLogs, clearLogs, addSSEClient } from './recorder';
import { getTraces as getHttpTraces, clear as clearHttpTraces, isEnabled as isHttpTraceOn, setEnabled as setHttpTraceOn } from './httpTrace';
import { handleChatCompletions } from './handlers/chatCompletions';
import { handleResponses } from './handlers/responses';
// Bun bundles HTML + React automatically on import
import dashboardHtml from '../public/index.html';

const D = decodeURIComponent;

export function startProxy(port: number): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port,
    routes: {
      '/': dashboardHtml,
      '/health': { GET: () => health() },
      '/api/health': { GET: () => health() },
      '/v1/models': { GET: () => clientModels() },
      '/v1/chat/completions': { POST: req => handleChatCompletions(req) },
      '/v1/responses': { POST: req => handleResponses(req) },

      '/api/providers': {
        GET: () => handleListProviders(),
        POST: req => handleAddProvider(req),
      },
      '/api/providers/:name': {
        DELETE: req => handleRemoveProvider(D(req.params.name)),
        PUT: req => handleUpdateProvider(D(req.params.name), req),
      },
      '/api/providers/:name/scan': {
        GET: async req => handleGetProviderScan(D(req.params.name)),
        POST: req => handleScanProvider(D(req.params.name)),
      },
      '/api/providers/:name/import-all': {
        POST: req => handleImportAll(D(req.params.name)),
      },
      '/api/providers/:name/import': {
        POST: req => handleImportOne(D(req.params.name), req),
      },

      '/api/models': {
        GET: () => handleListModelDefs(),
        POST: req => handleAddModelDef(req),
        DELETE: req => handleRemoveModelDef(req),
      },

      '/api/mappings': {
        GET: () => handleListMappings(),
        POST: req => handleAddMapping(req),
      },
      '/api/mappings/:name': {
        DELETE: req => handleRemoveMapping(D(req.params.name)),
        PUT: req => handleUpdateMapping(D(req.params.name), req),
      },

      '/api/test/:name': {
        POST: req => handleTestModel(D(req.params.name)),
      },
      '/api/test-direct': {
        POST: req => handleTestDirect(req),
      },
      '/api/reload': { POST: () => handleReload() },
      '/api/logs': {
        GET: req => {
          const url = new URL(req.url);
          return json(queryLogs({
            limit: Number(url.searchParams.get('limit')) || undefined,
            offset: Number(url.searchParams.get('offset')) || undefined,
            endpoint: url.searchParams.get('endpoint') || undefined,
            clientModel: url.searchParams.get('model') || undefined,
            provider: url.searchParams.get('provider') || undefined,
            from: url.searchParams.get('from') || undefined,
            to: url.searchParams.get('to') || undefined,
            errorOnly: url.searchParams.has('errorOnly'),
          }));
        },
        POST: () => { clearLogs(); return json({ ok: true }); },
      },
      '/api/httptrace': { GET: () => json(getHttpTraces()) },
      '/api/httptrace/clear': { POST: () => { clearHttpTraces(); return json({ ok: true }); } },
      '/api/httptrace/config': {
        GET: () => json({ enabled: isHttpTraceOn() }),
        POST: async req => { const b = await req.json() as { enabled?: boolean }; if (typeof b.enabled === 'boolean') setHttpTraceOn(b.enabled); return json({ enabled: isHttpTraceOn() }); },
      },
      '/api/events': {
        GET: () => {
          let closed = false;
          const stream = new ReadableStream({
            start(ctrl) {
              const unsub = addSSEClient(data => {
                if (closed) return;
                ctrl.enqueue(new TextEncoder().encode(data));
              });
              // Keep-alive
              const keepAlive = setInterval(() => {
                if (!closed) ctrl.enqueue(new TextEncoder().encode(': keepalive\n\n'));
              }, 15000);
              // Cleanup on close
              const checkClosed = setInterval(() => {
                if (closed) { unsub(); clearInterval(keepAlive); clearInterval(checkClosed); }
              }, 1000);
            },
            cancel() { closed = true; },
          });
          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              ...CORS,
            },
          });
        },
      },
    },
    async fetch(req): Promise<Response> {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      return new Response('未找到', { status: 404, headers: CORS });
    },
    error(err) {
      console.error('[proxy]', err);
      return json({ error: '服务器内部错误' }, 500);
    },
  });
  console.log(`[proxy] http://localhost:${server.port}`);
  return server;
}


function health(): Response {
  const c = getConfig();
  return json({
    status: 'ok',
    models: Object.values(c.providers).reduce((sum, p) => sum + Object.keys(p.models).length, 0),
    mappings: Object.keys(c.mappings).length,
    providers: Object.keys(c.providers).length,
    port: c.port,
  });
}

function clientModels(): Response {
  const c = getConfig();
  const seen = new Set<string>();
  const data: Array<{ id: string; object: string; created: number; owned_by: string }> = [];
  for (const [name, m] of Object.entries(c.mappings)) {
    data.push({ id: name, object: 'model', created: 0, owned_by: m.provider });
    seen.add(name);
  }
  for (const [providerName, provider] of Object.entries(c.providers)) {
    for (const modelId of Object.keys(provider.models)) {
      if (!seen.has(modelId)) data.push({ id: modelId, object: 'model', created: 0, owned_by: providerName });
    }
  }
  return json({ object: 'list', data });
}

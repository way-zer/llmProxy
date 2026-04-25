import { lookupModel, getConfig, listModelNames } from './config';
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

const D = decodeURIComponent;

// Bun bundles HTML + React automatically on import
import dashboardHtml from '../public/index.html';

export function startProxy(port: number): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port,
    routes: {
      '/': dashboardHtml,
      '/health': { GET: () => health() },
      '/api/health': { GET: () => health() },
      '/v1/models': { GET: () => clientModels() },
      '/v1/chat/completions': { POST: req => proxyOpenAI('chat/completions', req) },
      '/v1/responses': { POST: req => proxyOpenAI('responses', req) },

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
    },
    async fetch(req): Promise<Response> {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      return new Response('Not Found', { status: 404, headers: CORS });
    },
    error(err) {
      console.error('[proxy]', err);
      return json({ error: 'Internal server error' }, 500);
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

async function proxyOpenAI(endpoint: string, req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!body.model || typeof body.model !== 'string') return json({ error: "Missing 'model' field" }, 400);

  const upstream = lookupModel(body.model);
  if (!upstream) {
    const names = listModelNames();
    return json({
      error: {
        message: `Model '${body.model}' not found. Available: ${names.join(', ') || 'none'}`,
        type: 'model_not_found',
      },
    }, 404);
  }

  const target = `${upstream.provider.baseUrl.replace(/\/$/, '')}/${endpoint}`;
  console.log(`[proxy] → ${body.model} → ${upstream.provider.baseUrl} (${upstream.upstreamModelId}) [${endpoint}]`);

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${upstream.provider.apiKey}` },
      body: JSON.stringify({ ...body, model: upstream.upstreamModelId }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error(`[proxy] Upstream ${res.status}: ${t.slice(0, 200)}`);
      return new Response(t, {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json', ...CORS },
      });
    }
    if (body.stream) {
      const r = res.body?.getReader();
      if (!r) return json({ error: 'Empty upstream body' }, 502);
      return new Response(new ReadableStream({
        async start(c) {
          try {
            while (true) {
              const { done, value } = await r.read();
              if (done) break;
              c.enqueue(value);
            }
            c.close();
          } catch (e) {
            console.error('[proxy] stream:', e);
            c.error(e);
          } finally {
            r.releaseLock();
          }
        },
      }), {
        status: res.status,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...CORS },
      });
    }
    const t = await res.text();
    return new Response(t, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json', ...CORS },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[proxy] fetch: ${msg}`);
    return json({ error: `Upstream connection failed: ${msg}` }, 502);
  }
}

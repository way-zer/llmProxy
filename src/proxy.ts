import { lookupModel, getConfig } from './config';
import { join } from 'node:path';
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

const PUBLIC_DIR = join(import.meta.dir, '..', 'public');
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
} as const;

const D = decodeURIComponent;

// Bun bundles HTML + React automatically on import
import dashboardHtml from '../public/index.html';

export function startProxy(port: number): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port,
    routes: {
      '/': { GET: () => new Response(dashboardHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS } }) },
      '/health': { GET: () => health() },
      '/api/health': { GET: () => health() },
      '/v1/models': { GET: () => clientModels() },
      '/v1/chat/completions': { POST: req => proxyOpenAI('chat/completions', req) },
      '/v1/responses': { POST: req => proxyOpenAI('responses', req) },

      '/api/providers': {
        GET: () => handleListProviders(CORS),
        POST: req => handleAddProvider(req, CORS),
      },
      '/api/providers/:name': {
        DELETE: req => handleRemoveProvider(D(req.params.name), CORS),
        PUT: req => handleUpdateProvider(D(req.params.name), req, CORS),
      },
      '/api/providers/:name/scan': {
        GET: async req => handleGetProviderScan(D(req.params.name), CORS),
        POST: req => handleScanProvider(D(req.params.name), CORS),
      },
      '/api/providers/:name/import-all': {
        POST: req => handleImportAll(D(req.params.name), CORS),
      },
      '/api/providers/:name/import/:modelId': {
        POST: req => handleImportOne(D(req.params.name), D(req.params.modelId), CORS),
      },

      '/api/models': {
        GET: () => handleListModelDefs(CORS),
        POST: req => handleAddModelDef(req, CORS),
        DELETE: req => handleRemoveModelDef(req, CORS),
      },

      '/api/mappings': {
        GET: () => handleListMappings(CORS),
        POST: req => handleAddMapping(req, CORS),
      },
      '/api/mappings/:name': {
        DELETE: req => handleRemoveMapping(D(req.params.name), CORS),
        PUT: req => handleUpdateMapping(D(req.params.name), req, CORS),
      },

      '/api/test/:name': {
        POST: req => handleTestModel(D(req.params.name), CORS),
      },
      '/api/test-direct': {
        POST: req => handleTestDirect(req, CORS),
      },
      '/api/reload': { POST: () => handleReload(CORS) },

      '/api/scan/:name': { POST: req => handleScanProvider(D(req.params.name), CORS) },
      '/api/scan-add/:name': { POST: req => handleImportAll(D(req.params.name), CORS) },
    },
    async fetch(req): Promise<Response> {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (req.method === 'GET') {
        const fp = new URL(req.url).pathname.slice(1);
        if (fp && !fp.startsWith('api/') && !fp.startsWith('v1/')) return await serve(fp);
      }
      return new Response('Not Found', { status: 404, headers: CORS });
    },
    error(err) {
      console.error('[proxy]', err);
      return new Response(JSON.stringify({ error: { message: 'Internal server error' } }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  console.log(`[proxy] http://localhost:${server.port}`);
  return server;
}

async function serve(filePath: string): Promise<Response> {
  if (filePath.includes('..') || filePath.startsWith('/')) return new Response('Forbidden', { status: 403, headers: CORS });
  const f = Bun.file(join(PUBLIC_DIR, filePath));
  if (!(await f.exists())) return new Response('Not Found', { status: 404, headers: CORS });
  const mime: Record<string, string> = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8', json: 'application/json', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon' };
  return new Response(f.stream(), { headers: { 'Content-Type': mime[filePath.split('.').pop()!] ?? 'application/octet-stream', ...CORS } });
}

function health(): Response {
  const c = getConfig();
  return json({ status: 'ok', models: c.models.length, mappings: Object.keys(c.mappings).length, providers: Object.keys(c.providers).length, port: c.port });
}

function clientModels(): Response {
  const c = getConfig();
  const seen = new Set<string>();
  const data: Array<{ id: string; object: string; created: number; owned_by: string }> = [];
  for (const [name, m] of Object.entries(c.mappings)) { data.push({ id: name, object: 'model', created: 0, owned_by: m.provider }); seen.add(name); }
  for (const m of c.models) { if (!seen.has(m.modelId)) data.push({ id: m.modelId, object: 'model', created: 0, owned_by: m.provider }); }
  return json({ object: 'list', data });
}

async function proxyOpenAI(endpoint: string, req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: { message: 'Invalid JSON body' } }, 400); }
  if (!body.model || typeof body.model !== 'string') return json({ error: { message: "Missing 'model' field" } }, 400);

  const upstream = lookupModel(body.model);
  if (!upstream) {
    const names = [...Object.keys(getConfig().mappings), ...Object.keys(getConfig().models)];
    return json({ error: { message: `Model '${body.model}' not found. Available: ${[...new Set(names)].join(', ') || 'none'}`, type: 'model_not_found' } }, 404);
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
      return new Response(t, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json', ...CORS } });
    }
    if (body.stream) {
      const r = res.body?.getReader();
      if (!r) return json({ error: { message: 'Empty upstream body' } }, 502);
      return new Response(new ReadableStream({
        async start(c) { try { while (true) { const { done, value } = await r.read(); if (done) break; c.enqueue(value); } c.close(); } catch (e) { console.error('[proxy] stream:', e); c.error(e); } finally { r.releaseLock(); } },
      }), { status: res.status, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...CORS } });
    }
    const t = await res.text();
    return new Response(t, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json', ...CORS } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[proxy] fetch: ${msg}`);
    return json({ error: { message: `Upstream connection failed: ${msg}` } }, 502);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

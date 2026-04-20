import { lookupModel, getConfig } from './config';
import type { ChatCompletionRequest } from './types';
import { join } from 'node:path';
import {
  handleListProviders, handleAddProvider, handleUpdateProvider, handleRemoveProvider,
  handleScanProvider, handleGetProviderScan,
  handleImportAll, handleImportOne,
  handleListModelDefs, handleAddModelDef, handleRemoveModelDef,
  handleListMappings, handleAddMapping, handleUpdateMapping, handleRemoveMapping,
  handleTestModel,
  handleReload,
} from './admin';

const PUBLIC_DIR = join(import.meta.dir, '..', 'public');

// ─── Server ─────────────────────────────────────────────────

export function startProxy(port: number): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      const cors: Record<string, string> = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
      };

      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

      // Dashboard
      if ((path === '/' || path === '/admin') && method === 'GET') {
        return await serveStatic('index.html', cors);
      }

      // OpenAI-compatible
      if (path === '/v1/models' && method === 'GET') return listClientModels(cors);
      if (path === '/v1/chat/completions' && method === 'POST') return proxyChat(request, cors);

      // Health
      if (path === '/api/health' || path === '/health') return health(cors);

      // Providers
      if (path === '/api/providers' && method === 'GET') return handleListProviders(cors);
      if (path === '/api/providers' && method === 'POST') return handleAddProvider(request, cors);
      const pm = path.match(/^\/api\/providers\/([^/]+)$/);
      if (pm) {
        const n = decodeURIComponent(pm[1]!);
        if (method === 'DELETE') return handleRemoveProvider(n, cors);
        if (method === 'PUT') return handleUpdateProvider(n, request, cors);
      }
      const psm = path.match(/^\/api\/providers\/([^/]+)\/scan$/);
      if (psm) {
        const n = decodeURIComponent(psm[1]!);
        if (method === 'GET') return handleGetProviderScan(n, cors);
        if (method === 'POST') return handleScanProvider(n, cors);
      }
      const pia = path.match(/^\/api\/providers\/([^/]+)\/import-all$/);
      if (pia && method === 'POST') return handleImportAll(decodeURIComponent(pia[1]!), cors);
      const pio = path.match(/^\/api\/providers\/([^/]+)\/import\/(.+)$/);
      if (pio && method === 'POST') return handleImportOne(decodeURIComponent(pio[1]!), decodeURIComponent(pio[2]!), cors);

      // Models
      if (path === '/api/models' && method === 'GET') return handleListModelDefs(cors);
      if (path === '/api/models' && method === 'POST') return handleAddModelDef(request, cors);
      if (path.startsWith('/api/models/') && method === 'DELETE') return handleRemoveModelDef(decodeURIComponent(path.slice('/api/models/'.length)), cors);

      // Mappings
      if (path === '/api/mappings' && method === 'GET') return handleListMappings(cors);
      if (path === '/api/mappings' && method === 'POST') return handleAddMapping(request, cors);
      const mm = path.match(/^\/api\/mappings\/([^/]+)$/);
      if (mm) {
        const n = decodeURIComponent(mm[1]!);
        if (method === 'DELETE') return handleRemoveMapping(n, cors);
        if (method === 'PUT') return handleUpdateMapping(n, request, cors);
      }

      // Test
      if (path.startsWith('/api/test/') && method === 'POST') return handleTestModel(decodeURIComponent(path.slice('/api/test/'.length)), cors);

      // Reload
      if (path === '/api/reload' && method === 'POST') return handleReload(cors);

      // Legacy scan
      if (path.startsWith('/api/scan/') && method === 'POST') return handleScanProvider(decodeURIComponent(path.slice('/api/scan/'.length)), cors);
      if (path.startsWith('/api/scan-add/') && method === 'POST') return handleImportAll(decodeURIComponent(path.slice('/api/scan-add/'.length)), cors);

      // Static
      if (method === 'GET' && path !== '/') {
        const f = path.slice(1);
        if (!f.startsWith('api/') && !f.startsWith('v1/')) return await serveStatic(f, cors);
      }

      return new Response('Not Found', { status: 404, headers: cors });
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

// ─── Static files ───────────────────────────────────────────

async function serveStatic(filePath: string, cors: Record<string, string>): Promise<Response> {
  if (filePath.includes('..') || filePath.startsWith('/')) return new Response('Forbidden', { status: 403, headers: cors });
  const f = Bun.file(join(PUBLIC_DIR, filePath));
  if (!(await f.exists())) return new Response('Not Found', { status: 404, headers: cors });
  const mime: Record<string, string> = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8', json: 'application/json', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon' };
  const ext = filePath.split('.').pop() ?? '';
  return new Response(f.stream(), { headers: { 'Content-Type': mime[ext] ?? 'application/octet-stream', ...cors } });
}

// ─── Health ─────────────────────────────────────────────────

function health(cors: Record<string, string>): Response {
  const c = getConfig();
  return json({ status: 'ok', models: Object.keys(c.models).length, mappings: Object.keys(c.mappings).length, providers: Object.keys(c.providers).length, port: c.port }, cors);
}

// ─── OpenAI-compatible model list ───────────────────────────

function listClientModels(cors: Record<string, string>): Response {
  const c = getConfig();
  const seen = new Set<string>();
  const data: Array<{ id: string; object: string; created: number; owned_by: string }> = [];
  for (const [name, m] of Object.entries(c.mappings)) {
    data.push({ id: name, object: 'model', created: 0, owned_by: m.provider });
    seen.add(name);
  }
  for (const [name, m] of Object.entries(c.models)) {
    if (!seen.has(name)) data.push({ id: name, object: 'model', created: 0, owned_by: m.provider });
  }
  return json({ object: 'list', data }, cors);
}

// ─── Chat completion proxy ──────────────────────────────────

async function proxyChat(request: Request, cors: Record<string, string>): Promise<Response> {
  let body: ChatCompletionRequest;
  try { body = await request.json(); } catch {
    return json({ error: { message: 'Invalid JSON body' } }, cors, 400);
  }
  if (!body.model) return json({ error: { message: "Missing 'model' field" } }, cors, 400);

  const upstream = lookupModel(body.model);
  if (!upstream) {
    const names = [...Object.keys(getConfig().mappings), ...Object.keys(getConfig().models)];
    const avail = [...new Set(names)].join(', ') || 'none';
    return json({ error: { message: `Model '${body.model}' not found. Available: ${avail}`, type: 'model_not_found' } }, cors, 404);
  }

  const url = `${upstream.provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  console.log(`[proxy] → ${body.model} → ${upstream.provider.baseUrl} (${upstream.upstreamModelId})`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${upstream.provider.apiKey}` },
      body: JSON.stringify({ ...body, model: upstream.upstreamModelId }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[proxy] Upstream ${res.status}: ${errText.slice(0, 200)}`);
      return new Response(errText, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json', ...cors } });
    }
    if (body.stream) {
      const reader = res.body?.getReader();
      if (!reader) return json({ error: { message: 'Empty upstream body' } }, cors, 502);
      const stream = new ReadableStream({
        async start(ctrl) {
          try { while (true) { const { done, value } = await reader.read(); if (done) break; ctrl.enqueue(value); } ctrl.close(); }
          catch (e) { console.error('[proxy] stream:', e); ctrl.error(e); }
          finally { reader.releaseLock(); }
        },
      });
      return new Response(stream, { status: res.status, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors } });
    }
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json', ...cors } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[proxy] fetch: ${msg}`);
    return json({ error: { message: `Upstream connection failed: ${msg}` } }, cors, 502);
  }
}

// ─── Helper ─────────────────────────────────────────────────

function json(data: unknown, headers: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

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
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
} as const;

// ─── Server ─────────────────────────────────────────────────

export function startProxy(port: number): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port,
    routes: {
      '/': { GET: async () => await serve('index.html') },
      '/health': { GET: () => health() },
      '/api/health': { GET: () => health() },
      '/v1/models': { GET: () => clientModels() },
      '/v1/chat/completions': { POST: proxyChat },
      '/api/providers': {
        GET: () => handleListProviders(CORS),
        POST: req => handleAddProvider(req, CORS),
      },
      '/api/models': {
        GET: () => handleListModelDefs(CORS),
        POST: req => handleAddModelDef(req, CORS),
      },
      '/api/mappings': {
        GET: () => handleListMappings(CORS),
        POST: req => handleAddMapping(req, CORS),
      },
      '/api/reload': { POST: () => handleReload(CORS) },
    },
    async fetch(req): Promise<Response> {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

      const url = new URL(req.url);
      const p = url.pathname;
      const m = req.method;

      // ── Param routes ────────────────────────────────
      // /api/providers/:name
      let match = p.match(/^\/api\/providers\/([^/]+)$/);
      if (match) {
        const n = decodeURIComponent(match[1]!);
        if (m === 'DELETE') return handleRemoveProvider(n, CORS);
        if (m === 'PUT') return handleUpdateProvider(n, req, CORS);
      }
      // /api/providers/:name/scan
      match = p.match(/^\/api\/providers\/([^/]+)\/scan$/);
      if (match) {
        const n = decodeURIComponent(match[1]!);
        if (m === 'GET') return handleGetProviderScan(n, CORS);
        if (m === 'POST') return handleScanProvider(n, CORS);
      }
      // /api/providers/:name/import-all
      match = p.match(/^\/api\/providers\/([^/]+)\/import-all$/);
      if (match && m === 'POST') return handleImportAll(decodeURIComponent(match[1]!), CORS);
      // /api/providers/:name/import/:modelId
      match = p.match(/^\/api\/providers\/([^/]+)\/import\/(.+)$/);
      if (match && m === 'POST') return handleImportOne(decodeURIComponent(match[1]!), decodeURIComponent(match[2]!), CORS);

      // /api/models/:name
      if (p.startsWith('/api/models/') && m === 'DELETE') return handleRemoveModelDef(decodeURIComponent(p.slice('/api/models/'.length)), CORS);

      // /api/mappings/:name
      match = p.match(/^\/api\/mappings\/([^/]+)$/);
      if (match) {
        const n = decodeURIComponent(match[1]!);
        if (m === 'DELETE') return handleRemoveMapping(n, CORS);
        if (m === 'PUT') return handleUpdateMapping(n, req, CORS);
      }

      // /api/test/:name
      if (p.startsWith('/api/test/') && m === 'POST') return handleTestModel(decodeURIComponent(p.slice('/api/test/'.length)), CORS);

      // Legacy
      if (p.startsWith('/api/scan/') && m === 'POST') return handleScanProvider(decodeURIComponent(p.slice('/api/scan/'.length)), CORS);
      if (p.startsWith('/api/scan-add/') && m === 'POST') return handleImportAll(decodeURIComponent(p.slice('/api/scan-add/'.length)), CORS);

      // ── Static files ────────────────────────────────
      if (m === 'GET' && p !== '/') {
        const f = p.slice(1);
        if (!f.startsWith('api/') && !f.startsWith('v1/')) return await serve(f);
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

// ─── Static files ───────────────────────────────────────────

async function serve(filePath: string): Promise<Response> {
  if (filePath.includes('..') || filePath.startsWith('/')) return new Response('Forbidden', { status: 403, headers: CORS });
  const f = Bun.file(join(PUBLIC_DIR, filePath));
  if (!(await f.exists())) return new Response('Not Found', { status: 404, headers: CORS });
  const mime: Record<string, string> = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8', json: 'application/json', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon' };
  return new Response(f.stream(), { headers: { 'Content-Type': mime[filePath.split('.').pop()!] ?? 'application/octet-stream', ...CORS } });
}

// ─── Health ─────────────────────────────────────────────────

function health(): Response {
  const c = getConfig();
  return json({ status: 'ok', models: Object.keys(c.models).length, mappings: Object.keys(c.mappings).length, providers: Object.keys(c.providers).length, port: c.port });
}

// ─── OpenAI model list ──────────────────────────────────────

function clientModels(): Response {
  const c = getConfig();
  const seen = new Set<string>();
  const data: Array<{ id: string; object: string; created: number; owned_by: string }> = [];
  for (const [name, m] of Object.entries(c.mappings)) { data.push({ id: name, object: 'model', created: 0, owned_by: m.provider }); seen.add(name); }
  for (const [name, m] of Object.entries(c.models)) { if (!seen.has(name)) data.push({ id: name, object: 'model', created: 0, owned_by: m.provider }); }
  return json({ object: 'list', data });
}

// ─── Chat proxy ─────────────────────────────────────────────

async function proxyChat(req: Request): Promise<Response> {
  let body: ChatCompletionRequest;
  try { body = await req.json(); } catch { return json({ error: { message: 'Invalid JSON body' } }, 400); }
  if (!body.model) return json({ error: { message: "Missing 'model' field" } }, 400);

  const upstream = lookupModel(body.model);
  if (!upstream) {
    const names = [...Object.keys(getConfig().mappings), ...Object.keys(getConfig().models)];
    return json({ error: { message: `Model '${body.model}' not found. Available: ${[...new Set(names)].join(', ') || 'none'}`, type: 'model_not_found' } }, 404);
  }

  const target = `${upstream.provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  console.log(`[proxy] → ${body.model} → ${upstream.provider.baseUrl} (${upstream.upstreamModelId})`);

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

// ─── Helper ─────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

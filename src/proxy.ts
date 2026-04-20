import {
  lookupModel, getConfig, saveConfig,
  addModel, removeModel,
  addProvider, updateProvider, removeProvider,
  reloadConfigAsync,
} from './config';
import type { ChatCompletionRequest } from './types';
import { scanProvider, getCachedScan, invalidateScanCache } from './scanner';
import { join } from 'node:path';

const PUBLIC_DIR = join(import.meta.dir, '..', 'public');

export function startProxy(port: number): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      const corsHeaders: Record<string, string> = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
      };

      if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Dashboard
      if ((path === '/' || path === '/admin') && method === 'GET') {
        return await serveStatic('index.html', corsHeaders);
      }

      // OpenAI-compatible
      if (path === '/v1/models' && method === 'GET') {
        return handleListModels(corsHeaders);
      }
      if (path === '/v1/chat/completions' && method === 'POST') {
        return handleChatCompletion(request, corsHeaders);
      }

      // Health
      if (path === '/api/health' || path === '/health') {
        return handleHealth(corsHeaders);
      }

      // Providers CRUD
      if (path === '/api/providers' && method === 'GET') {
        return handleListProviders(corsHeaders);
      }
      if (path === '/api/providers' && method === 'POST') {
        return handleAddProvider(request, corsHeaders);
      }

      // Provider by name
      const provMatch = path.match(/^\/api\/providers\/([^/]+)$/);
      if (provMatch) {
        const name = decodeURIComponent(provMatch[1]!);
        if (method === 'DELETE') return handleRemoveProvider(name, corsHeaders);
        if (method === 'PUT') return handleUpdateProvider(name, request, corsHeaders);
      }

      // Provider scan / import
      const provScanMatch = path.match(/^\/api\/providers\/([^/]+)\/scan$/);
      if (provScanMatch) {
        const name = decodeURIComponent(provScanMatch[1]!);
        if (method === 'GET') return handleGetProviderScan(name, corsHeaders);
        if (method === 'POST') return handleScanProvider(name, corsHeaders);
      }

      const provImportAll = path.match(/^\/api\/providers\/([^/]+)\/import-all$/);
      if (provImportAll && method === 'POST') {
        return handleImportAll(decodeURIComponent(provImportAll[1]!), corsHeaders);
      }

      const provImportOne = path.match(/^\/api\/providers\/([^/]+)\/import\/(.+)$/);
      if (provImportOne && method === 'POST') {
        return handleImportOne(decodeURIComponent(provImportOne[1]!), decodeURIComponent(provImportOne[2]!), corsHeaders);
      }

      // Model test endpoint
      if (path.startsWith('/api/test/') && method === 'POST') {
        const modelName = decodeURIComponent(path.slice('/api/test/'.length));
        return handleTestModel(modelName, corsHeaders);
      }

      // Models CRUD
      if (path === '/api/models' && method === 'GET') {
        return handleListModelMappings(corsHeaders);
      }
      if (path === '/api/models' && method === 'POST') {
        return handleAddModel(request, corsHeaders);
      }
      if (path.startsWith('/api/models/') && method === 'DELETE') {
        const name = decodeURIComponent(path.slice('/api/models/'.length));
        return handleRemoveModel(name, corsHeaders);
      }

      // Reload
      if (path === '/api/reload' && method === 'POST') {
        return handleReload(corsHeaders);
      }

      // Legacy scan endpoints
      if (path.startsWith('/api/scan/') && method === 'POST') {
        return handleScanProvider(decodeURIComponent(path.slice('/api/scan/'.length)), corsHeaders);
      }
      if (path.startsWith('/api/scan-add/') && method === 'POST') {
        return handleImportAll(decodeURIComponent(path.slice('/api/scan-add/'.length)), corsHeaders);
      }

      // Static files
      if (method === 'GET' && path !== '/') {
        const file = path.slice(1);
        if (!file.startsWith('api/') && !file.startsWith('v1/')) {
          return await serveStatic(file, corsHeaders);
        }
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    },

    error(error) {
      console.error('[proxy] Server error:', error);
      return new Response(JSON.stringify({ error: { message: 'Internal server error' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  console.log(`[proxy] Listening on http://localhost:${server.port}`);
  return server;
}

// ─── Static files ──────────────────────────────────────────

async function serveStatic(filePath: string, corsHeaders: Record<string, string>): Promise<Response> {
  // Prevent directory traversal
  if (filePath.includes('..') || filePath.startsWith('/')) {
    return new Response('Forbidden', { status: 403, headers: corsHeaders });
  }
  const fullPath = join(PUBLIC_DIR, filePath);
  const file = Bun.file(fullPath);
  if (!(await file.exists())) {
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
  const ext = filePath.split('.').pop() ?? '';
  const mime: Record<string, string> = {
    html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8', json: 'application/json',
    png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon',
  };
  return new Response(file.stream(), {
    headers: { 'Content-Type': mime[ext] ?? 'application/octet-stream', ...corsHeaders },
  });
}

// ─── Health ────────────────────────────────────────────────

function handleHealth(corsHeaders: Record<string, string>): Response {
  const cfg = getConfig();
  return json({ status: 'ok', models: Object.keys(cfg.models).length, providers: Object.keys(cfg.providers).length, port: cfg.port }, corsHeaders);
}

// ─── Providers ─────────────────────────────────────────────

function handleListProviders(corsHeaders: Record<string, string>): Response {
  const cfg = getConfig();
  const list = Object.entries(cfg.providers).map(([name, p]) => {
    const scan = getCachedScan(name);
    return {
      name, baseUrl: p.baseUrl,
      apiKey: p.apiKey ? p.apiKey.slice(0, 6) + '...' + p.apiKey.slice(-4) : '',
      hasFullKey: !!p.apiKey,
      modelCount: Object.values(cfg.models).filter(m => m.provider === name).length,
      scanStatus: scan ? (scan.error ? 'error' : 'ok') : 'pending',
      scanError: scan?.error ?? null,
      scanModelCount: scan?.models?.length ?? 0,
      scannedAt: scan?.scannedAt ?? null,
    };
  });
  return json(list, corsHeaders);
}

async function handleAddProvider(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const { name, baseUrl, apiKey } = await request.json();
    if (!name || !baseUrl) return json({ error: 'name and baseUrl are required' }, corsHeaders, 400);
    addProvider(name, baseUrl, apiKey ?? '');
    await saveConfig();
    scanProvider(name).then(r => {
      console.log(`[proxy] Auto-scan '${name}': ${r.error ? 'failed' : `found ${r.models.length} models`}`);
    }).catch(() => {});
    return json({ success: true, name }, corsHeaders);
  } catch {
    return json({ error: 'Invalid JSON body' }, corsHeaders, 400);
  }
}

async function handleUpdateProvider(name: string, request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const { baseUrl, apiKey } = await request.json();
    if (!baseUrl) return json({ error: 'baseUrl is required' }, corsHeaders, 400);
    if (!updateProvider(name, baseUrl, apiKey ?? '')) {
      return json({ error: `Provider '${name}' not found` }, corsHeaders, 404);
    }
    await saveConfig();
    invalidateScanCache(name);
    scanProvider(name).then(r => {
      console.log(`[proxy] Re-scan '${name}': ${r.error ? 'failed' : `found ${r.models.length} models`}`);
    }).catch(() => {});
    return json({ success: true, name }, corsHeaders);
  } catch {
    return json({ error: 'Invalid JSON body' }, corsHeaders, 400);
  }
}

async function handleRemoveProvider(name: string, corsHeaders: Record<string, string>): Promise<Response> {
  if (removeProvider(name)) {
    invalidateScanCache(name);
    await saveConfig();
    return json({ success: true, name }, corsHeaders);
  }
  return json({ error: `Provider '${name}' not found` }, corsHeaders, 404);
}

// ─── Scan / Import ─────────────────────────────────────────

async function handleScanProvider(name: string, corsHeaders: Record<string, string>): Promise<Response> {
  const r = await scanProvider(name);
  return json(r, corsHeaders, r.error ? 400 : 200);
}

function handleGetProviderScan(name: string, corsHeaders: Record<string, string>): Response {
  const cached = getCachedScan(name);
  if (!cached) return json({ error: `No scan cached for '${name}'` }, corsHeaders, 404);
  return json(cached, corsHeaders);
}

async function handleImportAll(providerName: string, corsHeaders: Record<string, string>): Promise<Response> {
  let scan = getCachedScan(providerName);
  if (!scan || scan.error) {
    scan = await scanProvider(providerName);
    if (scan.error) return json({ error: scan.error }, corsHeaders, 400);
  }
  const cfg = getConfig();
  if (!cfg.providers[providerName]) return json({ error: `Provider '${providerName}' not found` }, corsHeaders, 400);
  let added = 0, skipped = 0;
  for (const m of scan.models) {
    if (cfg.models[m.id]) { skipped++; continue; }
    addModel(m.id, providerName, m.id);
    added++;
  }
  saveConfig();
  return json({ success: true, providerName, total: scan.models.length, added, skipped }, corsHeaders);
}

async function handleImportOne(providerName: string, upstreamModelId: string, corsHeaders: Record<string, string>): Promise<Response> {
  if (!getConfig().providers[providerName]) return json({ error: `Provider '${providerName}' not found` }, corsHeaders, 400);
  addModel(upstreamModelId, providerName, upstreamModelId);
  await saveConfig();
  return json({ success: true, name: upstreamModelId, provider: providerName }, corsHeaders);
}

// ─── Models ────────────────────────────────────────────────

function handleListModelMappings(corsHeaders: Record<string, string>): Response {
  return json(Object.entries(getConfig().models).map(([n, m]) => ({ name: n, provider: m.provider, modelId: m.modelId })), corsHeaders);
}

async function handleAddModel(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const { name, provider, modelId } = await request.json();
    if (!name || !provider) return json({ error: 'name and provider are required' }, corsHeaders, 400);
    if (!getConfig().providers[provider]) return json({ error: `Provider '${provider}' not found` }, corsHeaders, 400);
    addModel(name, provider, modelId ?? name);
    await saveConfig();
    return json({ success: true, name }, corsHeaders);
  } catch {
    return json({ error: 'Invalid JSON body' }, corsHeaders, 400);
  }
}

async function handleRemoveModel(name: string, corsHeaders: Record<string, string>): Promise<Response> {
  if (removeModel(name)) { await saveConfig(); return json({ success: true, name }, corsHeaders); }
  return json({ error: `Model '${name}' not found` }, corsHeaders, 404);
}

// ─── Model test ────────────────────────────────────────────

async function handleTestModel(modelName: string, corsHeaders: Record<string, string>): Promise<Response> {
  const upstream = lookupModel(modelName);
  if (!upstream) {
    return json({ error: `Model '${modelName}' not found` }, corsHeaders, 404);
  }

  const upstreamUrl = `${upstream.provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const testBody = {
    model: upstream.upstreamModelId,
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 50,
    stream: false,
  };

  const start = performance.now();
  try {
    const res = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${upstream.provider.apiKey}` },
      body: JSON.stringify(testBody),
    });
    const latencyMs = Math.round(performance.now() - start);
    const text = await res.text();

    if (!res.ok) {
      return json({
        modelName,
        latencyMs,
        statusCode: res.status,
        ok: false,
        error: text.slice(0, 300),
      }, corsHeaders);
    }

    // Extract a short preview from the response
    let preview = '';
    try {
      const parsed = JSON.parse(text);
      preview = parsed.choices?.[0]?.message?.content?.slice(0, 200) ?? text.slice(0, 200);
    } catch {
      preview = text.slice(0, 200);
    }

    return json({
      modelName,
      latencyMs,
      statusCode: res.status,
      ok: true,
      preview,
    }, corsHeaders);
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const msg = err instanceof Error ? err.message : String(err);
    return json({ modelName, latencyMs, ok: false, error: msg }, corsHeaders);
  }
}

// ─── Reload ────────────────────────────────────────────────

async function handleReload(corsHeaders: Record<string, string>): Promise<Response> {
  const cfg = await reloadConfigAsync();
  invalidateScanCache();
  return json({ success: true, models: Object.keys(cfg.models).length, providers: Object.keys(cfg.providers).length }, corsHeaders);
}

// ─── OpenAI-compatible ─────────────────────────────────────

function handleListModels(corsHeaders: Record<string, string>): Response {
  const data = Object.entries(getConfig().models).map(([name, m]) => ({
    id: name, object: 'model', created: 0, owned_by: m.provider,
  }));
  return json({ object: 'list', data }, corsHeaders);
}

// ─── Chat proxy ────────────────────────────────────────────

async function handleChatCompletion(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  let body: ChatCompletionRequest;
  try { body = await request.json(); } catch {
    return json({ error: { message: 'Invalid JSON body' } }, corsHeaders, 400);
  }
  const modelId = body.model;
  if (!modelId) return json({ error: { message: "Missing 'model' field" } }, corsHeaders, 400);

  const upstream = lookupModel(modelId);
  if (!upstream) {
    const avail = Object.keys(getConfig().models).join(', ') || 'none';
    return json({ error: { message: `Model '${modelId}' not configured. Available: ${avail}`, type: 'model_not_found' } }, corsHeaders, 404);
  }

  const upstreamUrl = `${upstream.provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  console.log(`[proxy] -> ${modelId} -> ${upstream.provider.baseUrl} (${upstream.upstreamModelId})`);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${upstream.provider.apiKey}` },
      body: JSON.stringify({ ...body, model: upstream.upstreamModelId }),
    });

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      console.error(`[proxy] Upstream error ${upstreamResponse.status}: ${errorText.slice(0, 200)}`);
      return new Response(errorText, {
        status: upstreamResponse.status,
        headers: { 'Content-Type': upstreamResponse.headers.get('Content-Type') ?? 'application/json', ...corsHeaders },
      });
    }

    if (body.stream) {
      const reader = upstreamResponse.body?.getReader();
      if (!reader) return json({ error: { message: 'Upstream returned empty body' } }, corsHeaders, 502);
      const stream = new ReadableStream({
        async start(controller) {
          try {
            while (true) { const { done, value } = await reader.read(); if (done) break; controller.enqueue(value); }
            controller.close();
          } catch (err) { console.error('[proxy] Stream error:', err); controller.error(err); }
          finally { reader.releaseLock(); }
        },
      });
      return new Response(stream, {
        status: upstreamResponse.status,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...corsHeaders },
      });
    }

    const responseBody = await upstreamResponse.text();
    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: { 'Content-Type': upstreamResponse.headers.get('Content-Type') ?? 'application/json', ...corsHeaders },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[proxy] Fetch error: ${msg}`);
    return json({ error: { message: `Upstream connection failed: ${msg}` } }, corsHeaders, 502);
  }
}

// ─── Helpers ────────────────────────────────────────────────

function json(data: unknown, headers: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}


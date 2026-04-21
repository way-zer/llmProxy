import {
  getConfig, saveConfig,
  addModelDef, removeModelDef,
  addMapping, updateMapping, removeMapping,
  addProvider, updateProvider, removeProvider,
  reloadConfigAsync,
  lookupModel,
} from './config';
import { scanProvider, getCachedScan } from './scanner';
import { clearScan } from './scanstore';

function json(data: unknown, headers: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

// ─── Providers ──────────────────────────────────────────────

export async function handleListProviders(corsHeaders: Record<string, string>): Promise<Response> {
  const cfg = getConfig();
  const entries = await Promise.all(Object.entries(cfg.providers).map(async ([name, p]) => {
    const scan = await getCachedScan(name);
    return {
      name, baseUrl: p.baseUrl,
      apiKey: p.apiKey ? p.apiKey.slice(0, 6) + '...' + p.apiKey.slice(-4) : '',
      hasFullKey: !!p.apiKey,
      modelCount: cfg.models.filter(m => m.provider === name).length,
      scanStatus: scan ? (scan.error ? 'error' : 'ok') : 'pending',
      scanError: scan?.error ?? null,
      scanModelCount: scan?.models?.length ?? 0,
      scannedAt: scan?.scannedAt ?? null,
    };
  }));
  return json(entries, corsHeaders);
}

export async function handleAddProvider(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const { name, baseUrl, apiKey } = await request.json();
    if (!name || !baseUrl) return json({ error: 'name and baseUrl are required' }, corsHeaders, 400);
    addProvider(name, baseUrl, apiKey ?? '');
    await saveConfig();
    scanProvider(name).then(r => console.log(`[admin] Auto-scan '${name}': ${r.error ? 'failed' : `found ${r.models.length} models`}`)).catch(() => {});
    return json({ success: true, name }, corsHeaders);
  } catch { return json({ error: 'Invalid JSON body' }, corsHeaders, 400); }
}

export async function handleUpdateProvider(name: string, request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const { baseUrl, apiKey } = await request.json();
    if (!baseUrl) return json({ error: 'baseUrl is required' }, corsHeaders, 400);
    if (!updateProvider(name, baseUrl, apiKey ?? '')) return json({ error: `Provider '${name}' not found` }, corsHeaders, 404);
    await saveConfig();
    await clearScan(name);
    scanProvider(name).then(r => console.log(`[admin] Re-scan '${name}': ${r.error ? 'failed' : `found ${r.models.length} models`}`)).catch(() => {});
    return json({ success: true, name }, corsHeaders);
  } catch { return json({ error: 'Invalid JSON body' }, corsHeaders, 400); }
}

export async function handleRemoveProvider(name: string, corsHeaders: Record<string, string>): Promise<Response> {
  if (removeProvider(name)) { await clearScan(name); await saveConfig(); return json({ success: true, name }, corsHeaders); }
  return json({ error: `Provider '${name}' not found` }, corsHeaders, 404);
}

// ─── Scan / Import ──────────────────────────────────────────

export async function handleScanProvider(name: string, corsHeaders: Record<string, string>): Promise<Response> {
  const r = await scanProvider(name);
  return json(r, corsHeaders, r.error ? 400 : 200);
}

export async function handleGetProviderScan(name: string, corsHeaders: Record<string, string>): Promise<Response> {
  const cached = await getCachedScan(name);
  if (!cached) return json({ providerName: name, baseUrl: '', models: [], scannedAt: 0 }, corsHeaders);
  return json(cached, corsHeaders);
}

export async function handleImportAll(providerName: string, corsHeaders: Record<string, string>): Promise<Response> {
  let scan = await getCachedScan(providerName);
  if (!scan || scan.error) { scan = await scanProvider(providerName); if (scan.error) return json({ error: scan.error }, corsHeaders, 400); }
  const cfg = getConfig();
  if (!cfg.providers[providerName]) return json({ error: `Provider '${providerName}' not found` }, corsHeaders, 400);
  let added = 0, skipped = 0, mapped = 0;
  for (const m of scan.models) {
    if (cfg.models.some(x => x.provider === providerName && x.modelId === m.id)) { skipped++; continue; }
    addModelDef(providerName, m.id);
    added++;
    if (!cfg.mappings[m.id]) { addMapping(m.id, providerName, m.id); mapped++; }
  }
  saveConfig();
  return json({ success: true, providerName, total: scan.models.length, added, skipped, mapped }, corsHeaders);
}

export async function handleImportOne(providerName: string, upstreamModelId: string, corsHeaders: Record<string, string>): Promise<Response> {
  if (!getConfig().providers[providerName]) return json({ error: `Provider '${providerName}' not found` }, corsHeaders, 400);
  addModelDef(providerName, upstreamModelId);
  const mapped = !getConfig().mappings[upstreamModelId];
  if (mapped) addMapping(upstreamModelId, providerName, upstreamModelId);
  await saveConfig();
  return json({ success: true, name: upstreamModelId, provider: providerName, mapped }, corsHeaders);
}

// ─── Model definitions ──────────────────────────────────────

export function handleListModelDefs(corsHeaders: Record<string, string>): Response {
  return json(getConfig().models, corsHeaders);
}

export async function handleAddModelDef(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const { provider, modelId } = await request.json();
    if (!provider || !modelId) return json({ error: 'provider and modelId are required' }, corsHeaders, 400);
    if (!getConfig().providers[provider]) return json({ error: `Provider '${provider}' not found` }, corsHeaders, 400);
    addModelDef(provider, modelId);
    await saveConfig();
    return json({ success: true }, corsHeaders);
  } catch { return json({ error: 'Invalid JSON body' }, corsHeaders, 400); }
}

export async function handleRemoveModelDef(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider');
  const modelId = url.searchParams.get('modelId');
  if (!provider || !modelId) return json({ error: 'provider and modelId query params required' }, corsHeaders, 400);
  if (removeModelDef(provider, modelId)) { await saveConfig(); return json({ success: true }, corsHeaders); }
  return json({ error: 'Model not found' }, corsHeaders, 404);
}

// ─── Mappings ───────────────────────────────────────────────

export function handleListMappings(corsHeaders: Record<string, string>): Response {
  return json(Object.entries(getConfig().mappings).map(([n, m]) => ({ name: n, provider: m.provider, modelId: m.modelId })), corsHeaders);
}

export async function handleAddMapping(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const { name, provider, modelId } = await request.json();
    if (!name || !provider || !modelId) return json({ error: 'name, provider, and modelId are required' }, corsHeaders, 400);
    if (!addMapping(name, provider, modelId)) return json({ error: `Provider '${provider}' not found` }, corsHeaders, 400);
    await saveConfig();
    return json({ success: true, name }, corsHeaders);
  } catch { return json({ error: 'Invalid JSON body' }, corsHeaders, 400); }
}

export async function handleUpdateMapping(name: string, request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const { provider, modelId } = await request.json();
    if (!provider || !modelId) return json({ error: 'provider and modelId are required' }, corsHeaders, 400);
    if (!updateMapping(name, provider, modelId)) return json({ error: `Mapping '${name}' not found or provider '${provider}' invalid` }, corsHeaders, 404);
    await saveConfig();
    return json({ success: true, name }, corsHeaders);
  } catch { return json({ error: 'Invalid JSON body' }, corsHeaders, 400); }
}

export async function handleRemoveMapping(name: string, corsHeaders: Record<string, string>): Promise<Response> {
  if (removeMapping(name)) { await saveConfig(); return json({ success: true, name }, corsHeaders); }
  return json({ error: `Mapping '${name}' not found` }, corsHeaders, 404);
}

// ─── Test ───────────────────────────────────────────────────

export async function handleTestModel(modelName: string, corsHeaders: Record<string, string>): Promise<Response> {
  const upstream = lookupModel(modelName);
  if (!upstream) return json({ error: `Model '${modelName}' not found` }, corsHeaders, 404);

  const upstreamUrl = `${upstream.provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const start = performance.now();
  try {
    const res = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${upstream.provider.apiKey}` },
      body: JSON.stringify({ model: upstream.upstreamModelId, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 50, stream: false }),
    });
    const latencyMs = Math.round(performance.now() - start);
    const text = await res.text();
    if (!res.ok) return json({ modelName, latencyMs, statusCode: res.status, ok: false, error: text.slice(0, 300) }, corsHeaders);
    let preview = '';
    try { preview = JSON.parse(text).choices?.[0]?.message?.content?.slice(0, 200) ?? text.slice(0, 200); } catch { preview = text.slice(0, 200); }
    return json({ modelName, latencyMs, statusCode: res.status, ok: true, preview }, corsHeaders);
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    return json({ modelName, latencyMs, ok: false, error: err instanceof Error ? err.message : String(err) }, corsHeaders);
  }
}

// ─── Reload ─────────────────────────────────────────────────

export async function handleReload(corsHeaders: Record<string, string>): Promise<Response> {
  const cfg = await reloadConfigAsync();
  return json({ success: true, models: cfg.models.length, mappings: Object.keys(cfg.mappings).length, providers: Object.keys(cfg.providers).length }, corsHeaders);
}

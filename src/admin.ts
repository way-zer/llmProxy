import {
  getConfig, saveConfig, getAllModels,
  addModelDef, removeModelDef,
  addMapping, updateMapping, removeMapping,
  addProvider, updateProvider, removeProvider,
  reloadConfigAsync,
  lookupModel,
  findClosestModel,
} from './config';
import type { ProviderConfig } from './types';
import { clearScan } from './scanstore';
import { getCachedScan, scanProvider } from './scanner';
import { json, err, parseBody } from './http';

// ─── Providers ──────────────────────────────────────────────

export async function handleListProviders(): Promise<Response> {
  const cfg = getConfig();
  const entries = await Promise.all(Object.entries(cfg.providers).map(async ([name, p]) => {
    const scan = await getCachedScan(name);
    return {
      name, baseUrl: p.baseUrl,
      modelCount: Object.keys(p.models).length,
      scanStatus: scan ? (scan.error ? 'error' : 'ok') : 'pending',
      scanError: scan?.error ?? null,
      scanModelCount: scan?.models?.length ?? 0,
      scannedAt: scan?.scannedAt ?? null,
    };
  }));
  return json(entries);
}

export async function handleAddProvider(request: Request): Promise<Response> {
  const body = await parseBody<{ name: string; baseUrl: string; apiKey?: string }>(request);
  if (body instanceof Response) return body;
  if (!body.name || !body.baseUrl) return err('名称和 baseUrl 为必填项');
  addProvider(body.name, body.baseUrl, body.apiKey ?? '');
  await saveConfig();
  scanProvider(body.name).then(r =>
    console.log(`[admin] 自动扫描 '${body.name}': ${r.error ? '失败' : `发现 ${r.models.length} 个模型`}`)
  ).catch(() => {});
  return json({ success: true, name: body.name });
}

export async function handleUpdateProvider(name: string, request: Request): Promise<Response> {
  const body = await parseBody<{ baseUrl: string; apiKey?: string }>(request);
  if (body instanceof Response) return body;
  if (!body.baseUrl) return err('baseUrl 为必填项');
  if (!updateProvider(name, body.baseUrl, body.apiKey ?? '')) return err(`提供商 '${name}' 未找到`, 404);
  await saveConfig();
  await clearScan(name);
  scanProvider(name).then(r =>
    console.log(`[admin] 重新扫描 '${name}': ${r.error ? '失败' : `发现 ${r.models.length} 个模型`}`)
  ).catch(() => {});
  return json({ success: true, name });
}

export async function handleRemoveProvider(name: string): Promise<Response> {
  if (!removeProvider(name)) return err(`提供商 '${name}' 未找到`, 404);
  await clearScan(name);
  await saveConfig();
  return json({ success: true, name });
}

// ─── Scan / Import ──────────────────────────────────────────

export async function handleScanProvider(name: string): Promise<Response> {
  const r = await scanProvider(name);
  return json(r, r.error ? 400 : 200);
}

export async function handleGetProviderScan(name: string): Promise<Response> {
  const cached = await getCachedScan(name);
  if (!cached) return json({ providerName: name, baseUrl: '', models: [], scannedAt: 0 });
  return json(cached);
}

export async function handleImportAll(providerName: string): Promise<Response> {
  let scan = await getCachedScan(providerName);
  if (!scan || scan.error) {
    scan = await scanProvider(providerName);
    if (scan.error) return err(scan.error);
  }
  const cfg = getConfig();
  if (!cfg.providers[providerName]) return err(`提供商 '${providerName}' 未找到`);
  let added = 0, skipped = 0, mapped = 0;
  for (const m of scan.models) {
    if (m.id in (cfg.providers[providerName]?.models ?? {})) { skipped++; continue; }
    addModelDef(providerName, m.id);
    added++;
    if (!cfg.mappings[m.id]) { addMapping(m.id, providerName, m.id); mapped++; }
  }
  await saveConfig();
  return json({ success: true, providerName, total: scan.models.length, added, skipped, mapped });
}

export async function handleImportOne(providerName: string, request: Request): Promise<Response> {
  const body = await parseBody<{ modelId: string }>(request);
  if (body instanceof Response) return body;
  if (!body.modelId) return err('modelId 为必填项');
  if (!getConfig().providers[providerName]) return err(`提供商 '${providerName}' 未找到`);
  addModelDef(providerName, body.modelId);
  const mapped = !getConfig().mappings[body.modelId];
  if (mapped) addMapping(body.modelId, providerName, body.modelId);
  await saveConfig();
  return json({ success: true, name: body.modelId, provider: providerName, mapped });
}

// ─── Model definitions ──────────────────────────────────────

export function handleListModelDefs(): Response {
  return json(getAllModels());
}

export async function handleAddModelDef(request: Request): Promise<Response> {
  const body = await parseBody<{ provider: string; modelId: string }>(request);
  if (body instanceof Response) return body;
  if (!body.provider || !body.modelId) return err('provider 和 modelId 为必填项');
  if (!getConfig().providers[body.provider]) return err(`提供商 '${body.provider}' 未找到`);
  addModelDef(body.provider, body.modelId);
  await saveConfig();
  return json({ success: true });
}

export async function handleRemoveModelDef(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider');
  const modelId = url.searchParams.get('modelId');
  if (!provider || !modelId) return err('provider 和 modelId 查询参数为必填项');
  const result = removeModelDef(provider, modelId);
  if (!result) return err('模型未找到', 404);
  await saveConfig();
  return json({ success: true, reassigned: result.reassigned });
}
// ─── Mappings ───────────────────────────────────────────────

export function handleListMappings(): Response {
  return json(Object.entries(getConfig().mappings).map(([n, m]) => ({
    name: n, provider: m.provider, modelId: m.modelId,
  })));
}

export async function handleAddMapping(request: Request): Promise<Response> {
  const body = await parseBody<{ name: string; provider?: string; modelId?: string }>(request);
  if (body instanceof Response) return body;
  if (!body.name) return err('名称为必填项');

  let provider = body.provider ?? '';
  let modelId = body.modelId ?? '';
  let fuzzy = false;

  // If no provider/model specified, or model doesn't exist → fuzzy match
  const modelExists = provider && modelId && modelId in (getConfig().providers[provider]?.models ?? {});
  if (!modelExists) {
    const match = findClosestModel(body.name);
    if (!match) return err('目录中没有模型可供匹配');
    provider = match.provider;
    modelId = match.modelId;
    fuzzy = !(body.provider && body.modelId && body.provider === provider && body.modelId === modelId);
  }

  if (!addMapping(body.name, provider, modelId)) return err(`提供商 '${provider}' 未找到`);
  await saveConfig();
  return json({ success: true, name: body.name, provider, modelId, fuzzy });
}

export async function handleUpdateMapping(name: string, request: Request): Promise<Response> {
  const body = await parseBody<{ provider: string; modelId: string }>(request);
  if (body instanceof Response) return body;
  if (!body.provider || !body.modelId) return err('provider 和 modelId 为必填项');
  if (!updateMapping(name, body.provider, body.modelId)) {
    return err(`映射 '${name}' 未找到或提供商 '${body.provider}' 无效`, 404);
  }
  await saveConfig();
  return json({ success: true, name });
}

export async function handleRemoveMapping(name: string): Promise<Response> {
  if (!removeMapping(name)) return err(`映射 '${name}' 未找到`, 404);
  await saveConfig();
  return json({ success: true, name });
}

// ─── Test ───────────────────────────────────────────────────

async function doTest(provider: ProviderConfig, upstreamModelId: string, label: string): Promise<Response> {
  const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({ model: upstreamModelId, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 50, stream: true }),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      const t = await res.text();
      return json({ modelName: label, latencyMs, statusCode: res.status, ok: false, error: t.slice(0, 300) });
    }
    // Parse SSE stream for preview
    const text = await res.text();
    let preview = '';
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') break;
      try {
        const chunk = JSON.parse(payload);
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) preview += content;
      } catch { /* skip malformed chunks */ }
    }
    return json({ modelName: label, latencyMs, statusCode: res.status, ok: true, preview: preview.slice(0, 200) || text.slice(0, 200) });
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    return json({ modelName: label, latencyMs, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function handleTestModel(name: string): Promise<Response> {
  const upstream = lookupModel(name);
  if (!upstream) return err(`模型 '${name}' 未找到`, 404);
  return doTest(upstream.provider, upstream.upstreamModelId, name);
}

export async function handleTestDirect(request: Request): Promise<Response> {
  const body = await parseBody<{ provider: string; modelId: string }>(request);
  if (body instanceof Response) return body;
  if (!body.provider || !body.modelId) return err('provider 和 modelId 为必填项');
  const p = getConfig().providers[body.provider];
  if (!p) return err(`提供商 '${body.provider}' 未找到`, 404);
  return doTest(p, body.modelId, body.modelId);
}

// ─── Reload ─────────────────────────────────────────────────

export async function handleReload(): Promise<Response> {
  const cfg = await reloadConfigAsync();
  return json({
    success: true,
    models: getAllModels().length,
    mappings: Object.keys(cfg.mappings).length,
    providers: Object.keys(cfg.providers).length,
  });
}

import type { AppConfig, ProviderConfig } from './types';
import { join } from 'node:path';

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = temp;
    }
  }
  return dp[n]!;
}

const CONFIG_PATH = join(import.meta.dir, '..', 'config.json');

let config: AppConfig = {
  port: 3000,
  providers: {},
  mappings: {},
};

export function getConfig(): Readonly<AppConfig> {
  return config;
}

/** Collect all ModelDef entries from every provider's models dict. */
export function getAllModels(): Array<{ provider: string; modelId: string }> {
  const result: Array<{ provider: string; modelId: string }> = [];
  for (const [providerName, provider] of Object.entries(config.providers)) {
    for (const modelId of Object.keys(provider.models)) {
      result.push({ provider: providerName, modelId });
    }
  }
  return result;
}

// ─── Persistence ────────────────────────────────────────────

async function readConfigFile(): Promise<AppConfig | null> {
  const file = Bun.file(CONFIG_PATH);
  if (!(await file.exists())) return null;
  const raw = JSON.parse(await file.text()) as Record<string, unknown>;

  const providers = (raw.providers ?? {}) as Record<string, ProviderConfig>;

  // Ensure every provider has a models field (safety net)
  for (const p of Object.values(providers)) {
    if (!p.models) p.models = {};
  }

  return {
    port: (raw.port as number) ?? 3000,
    providers,
    mappings: (raw.mappings ?? {}) as AppConfig['mappings'],
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const loaded = await readConfigFile();
  if (loaded) {
    config = loaded;
  } else {
    console.log(`[config] No config.json at ${CONFIG_PATH}, using defaults`);
    config = { port: 3000, providers: {}, mappings: {} };
    await saveConfig();
  }
  return config;
}

export async function saveConfig(): Promise<void> {
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function reloadConfigAsync(): Promise<AppConfig> {
  const loaded = await readConfigFile();
  if (loaded) config = loaded;
  return config;
}

// ─── Providers ──────────────────────────────────────────────

export function addProvider(name: string, baseUrl: string, apiKey: string): void {
  config.providers[name] = { baseUrl, apiKey, models: {} };
}

export function updateProvider(name: string, baseUrl: string, apiKey: string): boolean {
  if (!config.providers[name]) return false;
  config.providers[name] = { ...config.providers[name], baseUrl, apiKey };
  return true;
}

export function removeProvider(name: string): boolean {
  if (!config.providers[name]) return false;
  // Remove mappings that reference this provider
  for (const [kn, m] of Object.entries(config.mappings)) {
    if (m.provider === name) delete config.mappings[kn];
  }
  delete config.providers[name];
  return true;
}

// ─── Model definitions ──────────────────────────────────────

export function addModelDef(provider: string, modelId: string): void {
  const p = config.providers[provider];
  if (!p) return;
  p.models[modelId] = {};
}

export function removeModelDef(provider: string, modelId: string): { reassigned: Array<{ name: string; from: string; to: string }> } | null {
  const p = config.providers[provider];
  if (!p || !(modelId in p.models)) return null;
  delete p.models[modelId];

  const reassigned: Array<{ name: string; from: string; to: string }> = [];

  // Reassign mappings that pointed to the removed model
  for (const [name, m] of Object.entries(config.mappings)) {
    if (m.provider !== provider || m.modelId !== modelId) continue;
    let best: { provider: string; modelId: string } | null = null;
    let bestDist = Infinity;
    for (const [pname, prov] of Object.entries(config.providers)) {
      for (const mid of Object.keys(prov.models)) {
        const d = lev(modelId, mid);
        if (d < bestDist || (d === bestDist && pname === provider)) {
          best = { provider: pname, modelId: mid };
          bestDist = d;
        }
      }
    }
    if (best) {
      const from = m.modelId;
      m.provider = best.provider;
      m.modelId = best.modelId;
      reassigned.push({ name, from, to: best.modelId });
    }
  }

  return { reassigned };
}

// ─── Mappings ───────────────────────────────────────────────

export function addMapping(name: string, provider: string, modelId: string): boolean {
  if (!config.providers[provider]) return false;
  config.mappings[name] = { provider, modelId };
  return true;
}

/** Find the model closest to the given query string across all providers. */
export function findClosestModel(query: string): { provider: string; modelId: string } | null {
  let best: { provider: string; modelId: string } | null = null;
  let bestDist = Infinity;
  for (const [pname, prov] of Object.entries(config.providers)) {
    for (const mid of Object.keys(prov.models)) {
      const d = lev(query, mid);
      if (d < bestDist) {
        best = { provider: pname, modelId: mid };
        bestDist = d;
      }
    }
  }
  return best;
}

export function updateMapping(name: string, provider: string, modelId: string): boolean {
  if (!config.mappings[name]) return false;
  if (!config.providers[provider]) return false;
  config.mappings[name] = { provider, modelId };
  return true;
}

export function removeMapping(name: string): boolean {
  if (!config.mappings[name]) return false;
  delete config.mappings[name];
  return true;
}

// ─── Lookup ─────────────────────────────────────────────────

export function lookupModel(clientName: string): { provider: ProviderConfig; upstreamModelId: string } | null {
  // routing mappings first
  const mapping = config.mappings[clientName];
  if (mapping) {
    const provider = config.providers[mapping.provider];
    if (provider) return { provider, upstreamModelId: mapping.modelId };
  }
  // fallback: search all provider models
  for (const [providerName, provider] of Object.entries(config.providers)) {
    if (clientName in provider.models) {
      return { provider, upstreamModelId: clientName };
    }
  }
  return null;
}

export function listModelNames(): string[] {
  const names = new Set(Object.keys(config.mappings));
  for (const [, provider] of Object.entries(config.providers)) {
    for (const modelId of Object.keys(provider.models)) {
      names.add(modelId);
    }
  }
  return [...names];
}

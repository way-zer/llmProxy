import type { AppConfig, ProviderConfig } from './types';
import { join } from 'node:path';

const CONFIG_PATH = join(import.meta.dir, '..', 'config.json');

let config: AppConfig = {
  port: 3000,
  providers: {},
  models: [],
  mappings: {},
};

export function getConfig(): Readonly<AppConfig> {
  return config;
}

// ─── Persistence ────────────────────────────────────────────

async function readConfigFile(): Promise<AppConfig | null> {
  const file = Bun.file(CONFIG_PATH);
  if (!(await file.exists())) return null;
  const raw: Partial<AppConfig> = JSON.parse(await file.text());
  return {
    port: raw.port ?? 3000,
    providers: raw.providers ?? {},
    models: Array.isArray(raw.models) ? raw.models : [],
    mappings: raw.mappings ?? {},
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const loaded = await readConfigFile();
  if (loaded) {
    config = loaded;
  } else {
    console.log(`[config] No config.json at ${CONFIG_PATH}, using defaults`);
    config = { port: 3000, providers: {}, models: [], mappings: {} };
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
  config.providers[name] = { baseUrl, apiKey };
}

export function updateProvider(name: string, baseUrl: string, apiKey: string): boolean {
  if (!config.providers[name]) return false;
  config.providers[name] = { ...config.providers[name], baseUrl, apiKey };
  return true;
}

export function removeProvider(name: string): boolean {
  if (!config.providers[name]) return false;
  config.models = config.models.filter(m => m.provider !== name);
  for (const [kn, m] of Object.entries(config.mappings)) {
    if (m.provider === name) delete config.mappings[kn];
  }
  delete config.providers[name];
  return true;
}

// ─── Model definitions ──────────────────────────────────────

export function addModelDef(provider: string, modelId: string): void {
  if (!config.models.some(m => m.provider === provider && m.modelId === modelId)) {
    config.models.push({ provider, modelId });
  }
}

export function removeModelDef(provider: string, modelId: string): boolean {
  const len = config.models.length;
  config.models = config.models.filter(m => !(m.provider === provider && m.modelId === modelId));
  return config.models.length < len;
}

// ─── Mappings ───────────────────────────────────────────────

export function addMapping(name: string, provider: string, modelId: string): boolean {
  if (!config.providers[provider]) return false;
  config.mappings[name] = { provider, modelId };
  return true;
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
  // fallback: model catalog
  const def = config.models.find(m => m.modelId === clientName);
  if (def) {
    const provider = config.providers[def.provider];
    if (provider) return { provider, upstreamModelId: def.modelId };
  }
  return null;
}

export function listModelNames(): string[] {
  const names = new Set(Object.keys(config.mappings));
  for (const m of config.models) names.add(m.modelId);
  return [...names];
}

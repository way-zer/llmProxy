import type { AppConfig, ProviderConfig, UpstreamModel } from './types';
import { join } from 'node:path';

const CONFIG_PATH = join(import.meta.dir, '..', 'config.json');

let config: AppConfig = {
  port: 3000,
  providers: {},
  models: {},
  mappings: {},
  scans: {},
};

export function getConfig(): Readonly<AppConfig> {
  return config;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export async function loadConfig(): Promise<AppConfig> {
  const file = Bun.file(CONFIG_PATH);
  if (await file.exists()) {
    const text = await file.text();
    config = JSON.parse(text) as AppConfig;
    if (!config.mappings) config.mappings = {};
    if (!config.scans) config.scans = {};
  } else {
    console.log(`[config] No config.json at ${CONFIG_PATH}, using defaults`);
    config = { port: 3000, providers: {}, models: {}, mappings: {}, scans: {} };
    await saveConfig();
  }
  return config;
}

export async function saveConfig(): Promise<void> {
  const text = JSON.stringify(config, null, 2);
  await Bun.write(CONFIG_PATH, text);
}

export async function reloadConfigAsync(): Promise<AppConfig> {
  const file = Bun.file(CONFIG_PATH);
  if (await file.exists()) {
    const text = await file.text();
    config = JSON.parse(text) as AppConfig;
    if (!config.mappings) config.mappings = {};
    if (!config.scans) config.scans = {};
  }
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

export function toggleProviderStar(name: string): boolean {
  if (!config.providers[name]) return false;
  config.providers[name] = { ...config.providers[name], starred: !config.providers[name].starred };
  return true;
}

export function removeProvider(name: string): boolean {
  if (!config.providers[name]) return false;
  for (const [mn, m] of Object.entries(config.models)) {
    if (m.provider === name) delete config.models[mn];
  }
  for (const [kn, m] of Object.entries(config.mappings)) {
    if (m.provider === name) delete config.mappings[kn];
  }
  delete config.providers[name];
  return true;
}

// ─── Model definitions (收藏的上游模型) ───────────────────────

export function addModelDef(name: string, provider: string, modelId: string): void {
  config.models[name] = { provider, modelId };
}

export function removeModelDef(name: string): boolean {
  if (!config.models[name]) return false;
  delete config.models[name];
  return true;
}

// ─── Mappings (客户端路由表, id → provider/model) ──────────────

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

// ─── Scans (持久化) ──────────────────────────────────────────

export function getScan(providerName: string): AppConfig['scans'][string] | undefined {
  return config.scans[providerName];
}

export function saveScan(providerName: string, models: UpstreamModel[], error?: string): void {
  config.scans[providerName] = { models, error, scannedAt: Date.now() };
}

export function clearScan(providerName: string): void {
  delete config.scans[providerName];
}

// ─── Lookup (mapping → provider, fallback model → provider) ───

export function lookupModel(clientName: string): { provider: ProviderConfig; upstreamModelId: string } | null {
  // Check routing mappings first
  const mapping = config.mappings[clientName];
  if (mapping) {
    const provider = config.providers[mapping.provider];
    if (provider) return { provider, upstreamModelId: mapping.modelId };
  }
  // Fall back to model catalog
  const def = config.models[clientName];
  if (def) {
    const provider = config.providers[def.provider];
    if (provider) return { provider, upstreamModelId: def.modelId };
  }
  return null;
}

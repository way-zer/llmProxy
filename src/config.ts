import type { AppConfig, ModelMapping, ProviderConfig } from "./types";
import { join } from "node:path";

const CONFIG_PATH = join(import.meta.dir, "..", "config.json");

let config: AppConfig = {
  port: 3000,
  providers: {},
  models: {},
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
  } else {
    console.log(`[config] No config.json found at ${CONFIG_PATH}, using defaults`);
    config = {
      port: 3000,
      providers: {},
      models: {},
    };
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
    console.log("[config] Configuration reloaded from disk");
  }
  return config;
}

export function addModel(mappingName: string, provider: string, modelId: string): void {
  config.models[mappingName] = { provider, modelId };
}

export function removeModel(mappingName: string): boolean {
  if (config.models[mappingName]) {
    delete config.models[mappingName];
    return true;
  }
  return false;
}

export function addProvider(name: string, baseUrl: string, apiKey: string): void {
  config.providers[name] = { baseUrl, apiKey };
}

export function updateProvider(name: string, baseUrl: string, apiKey: string): boolean {
  if (!config.providers[name]) return false;
  config.providers[name] = { baseUrl, apiKey };
  return true;
}

export function removeProvider(name: string): boolean {
  if (config.providers[name]) {
    // Also remove all model mappings that use this provider
    const modelsToRemove: string[] = [];
    for (const [modelName, mapping] of Object.entries(config.models)) {
      if (mapping.provider === name) {
        modelsToRemove.push(modelName);
      }
    }
    for (const modelName of modelsToRemove) {
      delete config.models[modelName];
    }
    delete config.providers[name];
    return true;
  }
  return false;
}

export function lookupModel(modelId: string): { provider: ProviderConfig; upstreamModelId: string } | null {
  const mapping = config.models[modelId];
  if (!mapping) {
    return null;
  }
  const provider = config.providers[mapping.provider];
  if (!provider) {
    return null;
  }
  return {
    provider,
    upstreamModelId: mapping.modelId,
  };
}

// ─── Types ──────────────────────────────────────────────────

export interface ProviderInfo {
  name: string;
  baseUrl: string;
  modelCount: number;
  scanStatus: 'ok' | 'error' | 'pending';
  scanError: string | null;
  scanModelCount: number;
  scannedAt: number | null;
}

export interface ModelDef {
  provider: string;
  modelId: string;
}

export interface MappingDef {
  name: string;
  provider: string;
  modelId: string;
}

export interface ScanResult {
  providerName: string;
  baseUrl: string;
  models: Array<{ id: string; object?: string; created?: number; owned_by?: string }>;
  error?: string;
  scannedAt: number;
}

export interface HealthInfo {
  status: string;
  models: number;
  mappings: number;
  providers: number;
  port: number;
}

export interface TestResult {
  modelName: string;
  latencyMs: number;
  ok: boolean;
  preview?: string;
  error?: string;
  statusCode?: number;
}

// ─── API helpers ────────────────────────────────────────────

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || data.error || `HTTP ${r.status}`);
  return data as T;
}

export const api = {
  health: () => req<HealthInfo>('GET', '/api/health'),

  // Providers
  listProviders: () => req<ProviderInfo[]>('GET', '/api/providers'),
  addProvider: (name: string, baseUrl: string, apiKey: string) =>
    req<{ success: boolean }>('POST', '/api/providers', { name, baseUrl, apiKey }),
  updateProvider: (name: string, baseUrl: string, apiKey: string) =>
    req<{ success: boolean }>('PUT', `/api/providers/${encodeURIComponent(name)}`, { baseUrl, apiKey }),
  removeProvider: (name: string) =>
    req<{ success: boolean }>('DELETE', `/api/providers/${encodeURIComponent(name)}`),

  // Scan
  getScan: (provider: string) => req<ScanResult>('GET', `/api/providers/${encodeURIComponent(provider)}/scan`),
  rescan: (provider: string) => req<ScanResult>('POST', `/api/providers/${encodeURIComponent(provider)}/scan`),
  importAll: (provider: string) =>
    req<{ success: boolean; total: number; added: number; skipped: number; mapped: number }>('POST', `/api/providers/${encodeURIComponent(provider)}/import-all`),
  importOne: (provider: string, modelId: string) =>
    req<{ success: boolean }>('POST', `/api/providers/${encodeURIComponent(provider)}/import`, { modelId }),

  // Models
  listModels: () => req<ModelDef[]>('GET', '/api/models'),
  removeModel: (provider: string, modelId: string) => req<{ success: boolean; reassigned: Array<{ name: string; from: string; to: string }> }>('DELETE', `/api/models?provider=${encodeURIComponent(provider)}&modelId=${encodeURIComponent(modelId)}`),

  // Mappings
  listMappings: () => req<MappingDef[]>('GET', '/api/mappings'),
  addMapping: (name: string, provider?: string, modelId?: string) =>
    req<{ success: boolean; name: string; provider: string; modelId: string; fuzzy: boolean }>('POST', '/api/mappings', { name, provider, modelId }),
  updateMapping: (name: string, provider: string, modelId: string) =>
    req<{ success: boolean }>('PUT', `/api/mappings/${encodeURIComponent(name)}`, { provider, modelId }),
  removeMapping: (name: string) =>
    req<{ success: boolean }>('DELETE', `/api/mappings/${encodeURIComponent(name)}`),

  // Test
  test: (name: string) => req<TestResult>('POST', `/api/test/${encodeURIComponent(name)}`),
  testDirect: (provider: string, modelId: string) => req<TestResult>('POST', '/api/test-direct', { provider, modelId }),

  // Config
  reload: () => req<{ success: boolean; models: number; mappings: number; providers: number }>('POST', '/api/reload'),
};

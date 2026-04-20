import type { UpstreamModelsResponse, UpstreamModel } from './types';
import { getConfig } from './config';
import { getScan, saveScan } from './scanstore';

export interface ScanResult {
  providerName: string;
  baseUrl: string;
  models: UpstreamModel[];
  error?: string;
  scannedAt: number;
}

export async function getCachedScan(providerName: string): Promise<ScanResult | undefined> {
  const s = await getScan(providerName);
  if (!s) return undefined;
  const provider = getConfig().providers[providerName];
  return {
    providerName,
    baseUrl: provider?.baseUrl ?? '',
    models: s.models,
    error: s.error,
    scannedAt: s.scannedAt,
  };
}

export async function scanProvider(providerName: string): Promise<ScanResult> {
  const cfg = getConfig();
  const provider = cfg.providers[providerName];

  if (!provider) {
    const r: ScanResult = { providerName, baseUrl: '', models: [], error: `Provider '${providerName}' not found`, scannedAt: Date.now() };
    await saveScan(providerName, [], r.error);
    return r;
  }

  const url = `${provider.baseUrl.replace(/\/$/, '')}/models`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => 'unknown error');
      const err = `HTTP ${res.status}: ${t.slice(0, 300)}`;
      await saveScan(providerName, [], err);
      return { providerName, baseUrl: provider.baseUrl, models: [], error: err, scannedAt: Date.now() };
    }
    const data = (await res.json()) as UpstreamModelsResponse;
    if (!data.data?.length) {
      await saveScan(providerName, []);
      return { providerName, baseUrl: provider.baseUrl, models: [], scannedAt: Date.now() };
    }
    const models = data.data.sort((a, b) => a.id.localeCompare(b.id));
    await saveScan(providerName, models);
    return { providerName, baseUrl: provider.baseUrl, models, scannedAt: Date.now() };
  } catch (err) {
    const msg = `Connection failed: ${err instanceof Error ? err.message : String(err)}`;
    await saveScan(providerName, [], msg);
    return { providerName, baseUrl: provider.baseUrl, models: [], error: msg, scannedAt: Date.now() };
  }
}


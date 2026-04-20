import type { UpstreamModelsResponse, UpstreamModel } from "./types";
import { getConfig, getScan, saveScan } from "./config";

export interface ScanResult {
  providerName: string;
  baseUrl: string;
  models: UpstreamModel[];
  error?: string;
  scannedAt: number;
}

/** Get persisted scan from config. */
export function getCachedScan(providerName: string): ScanResult | undefined {
  const s = getScan(providerName);
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

/** Scan upstream and persist result to config. */
export async function scanProvider(providerName: string): Promise<ScanResult> {
  const cfg = getConfig();
  const provider = cfg.providers[providerName];

  if (!provider) {
    const result: ScanResult = {
      providerName, baseUrl: '', models: [],
      error: `Provider '${providerName}' not found`,
      scannedAt: Date.now(),
    };
    saveScan(providerName, [], result.error);
    return result;
  }

  const modelsUrl = `${provider.baseUrl.replace(/\/$/, "")}/models`;

  try {
    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      const error = `HTTP ${response.status}: ${errorText.slice(0, 300)}`;
      saveScan(providerName, [], error);
      return { providerName, baseUrl: provider.baseUrl, models: [], error, scannedAt: Date.now() };
    }

    const data = (await response.json()) as UpstreamModelsResponse;

    if (!data.data || !Array.isArray(data.data)) {
      const error = `Unexpected response format: expected { data: [...] }`;
      saveScan(providerName, [], error);
      return { providerName, baseUrl: provider.baseUrl, models: [], error, scannedAt: Date.now() };
    }

    const models = data.data.sort((a, b) => a.id.localeCompare(b.id));
    saveScan(providerName, models);
    return { providerName, baseUrl: provider.baseUrl, models, scannedAt: Date.now() };
  } catch (err) {
    const error = `Connection failed: ${err instanceof Error ? err.message : String(err)}`;
    saveScan(providerName, [], error);
    return { providerName, baseUrl: provider.baseUrl, models: [], error, scannedAt: Date.now() };
  }
}

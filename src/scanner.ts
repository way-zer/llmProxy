import type { UpstreamModelsResponse, UpstreamModel } from "./types";
import { getConfig } from "./config";

export interface ScanResult {
  providerName: string;
  baseUrl: string;
  models: UpstreamModel[];
  error?: string;
  scannedAt: number; // timestamp
}

// In-memory scan cache
const scanCache = new Map<string, ScanResult>();

export function getCachedScan(providerName: string): ScanResult | undefined {
  return scanCache.get(providerName);
}

export function invalidateScanCache(providerName?: string): void {
  if (providerName) {
    scanCache.delete(providerName);
  } else {
    scanCache.clear();
  }
}

export async function initScanCache(): Promise<void> {
  const cfg = getConfig();
  const names = Object.keys(cfg.providers);
  if (names.length === 0) return;

  console.log(`[scanner] Warming cache for ${names.length} provider(s)...`);
  const results = await Promise.allSettled(names.map(name => scanProvider(name)));
  let ok = 0;
  let fail = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && !r.value.error) ok++;
    else fail++;
  });
  console.log(`[scanner] Cache warmup done: ${ok} ok, ${fail} failed`);
}

export async function scanProvider(providerName: string): Promise<ScanResult> {
  const cfg = getConfig();
  const provider = cfg.providers[providerName];

  if (!provider) {
    const result: ScanResult = {
      providerName,
      baseUrl: "",
      models: [],
      error: `Provider '${providerName}' not found`,
      scannedAt: Date.now(),
    };
    scanCache.set(providerName, result);
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
      const result: ScanResult = {
        providerName,
        baseUrl: provider.baseUrl,
        models: [],
        error: `HTTP ${response.status}: ${errorText.slice(0, 300)}`,
        scannedAt: Date.now(),
      };
      scanCache.set(providerName, result);
      return result;
    }

    const data = (await response.json()) as UpstreamModelsResponse;

    if (!data.data || !Array.isArray(data.data)) {
      const result: ScanResult = {
        providerName,
        baseUrl: provider.baseUrl,
        models: [],
        error: `Unexpected response format: expected { data: [...] }`,
        scannedAt: Date.now(),
      };
      scanCache.set(providerName, result);
      return result;
    }

    const result: ScanResult = {
      providerName,
      baseUrl: provider.baseUrl,
      models: data.data.sort((a, b) => a.id.localeCompare(b.id)),
      scannedAt: Date.now(),
    };
    scanCache.set(providerName, result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: ScanResult = {
      providerName,
      baseUrl: provider.baseUrl,
      models: [],
      error: `Connection failed: ${message}`,
      scannedAt: Date.now(),
    };
    scanCache.set(providerName, result);
    return result;
  }
}

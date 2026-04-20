import type { UpstreamModel } from './types';
import { join } from 'node:path';

const PATH = join(import.meta.dir, '..', 'scans.json');

interface ScanEntry {
  models: UpstreamModel[];
  error?: string;
  scannedAt: number;
}

type ScanStore = Record<string, ScanEntry>;

let store: ScanStore | null = null;

async function load(): Promise<ScanStore> {
  if (store) return store;
  const f = Bun.file(PATH);
  if (await f.exists()) {
    store = JSON.parse(await f.text()) as ScanStore;
  } else {
    store = {};
  }
  return store;
}

async function save(): Promise<void> {
  if (!store) return;
  await Bun.write(PATH, JSON.stringify(store, null, 2));
}

export async function getScan(providerName: string): Promise<ScanEntry | undefined> {
  const s = await load();
  return s[providerName];
}

export async function saveScan(providerName: string, models: UpstreamModel[], error?: string): Promise<void> {
  const s = await load();
  s[providerName] = { models, error, scannedAt: Date.now() };
  await save();
}

export async function clearScan(providerName: string): Promise<void> {
  const s = await load();
  delete s[providerName];
  await save();
}

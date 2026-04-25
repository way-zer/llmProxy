import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

// ─── Types ───────────────────────────────────────────────────

export interface Tokens {
  input: number;
  output: number;
  reasoning: number;
  cached: number;
  cacheWrite: number;
}

/** Compact event for SSE broadcast (no messages/content). */
export interface LiveEvent {
  id: number;
  timestamp: string;
  endpoint: string;
  clientModel: string;
  upstreamProvider: string;
  upstreamModel: string;
  stream: boolean;
  statusCode: number;
  latencyMs: number;
  totalMs: number;
  tokens: Tokens;
  error: string | null;
}

/** A row from the SQLite request_logs table. */
export interface LogEntry {
  id: number;
  timestamp: string;
  endpoint: string;
  client_model: string;
  upstream_provider: string;
  upstream_model: string;
  stream: number;
  status_code: number;
  latency_ms: number;
  request_params: string;
  response_meta: string;
  error: string | null;
}

// ─── SQLite persistence ──────────────────────────────────────

const DB_PATH = join(import.meta.dir, '..', 'data', 'requests.db');
let db: Database;
let recorderEnabled = true;

function initDb() {
  mkdirSync(join(import.meta.dir, '..', 'data'), { recursive: true });
  db = new Database(DB_PATH, { create: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  db.run(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp         TEXT NOT NULL,
      endpoint          TEXT NOT NULL,
      client_model      TEXT NOT NULL,
      upstream_provider TEXT NOT NULL,
      upstream_model    TEXT NOT NULL,
      stream            INTEGER NOT NULL DEFAULT 0,
      status_code       INTEGER,
      latency_ms        INTEGER,
      total_ms          INTEGER DEFAULT 0,
      request_params    TEXT NOT NULL DEFAULT '{}',
      response_meta     TEXT NOT NULL DEFAULT '{}',
      error             TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_ts ON request_logs(timestamp)`);
  // Migration: add total_ms column for older DBs
  try { db.run(`ALTER TABLE request_logs ADD COLUMN total_ms INTEGER DEFAULT 0`); } catch { /* column exists */ }
}

// ─── SSE broadcast ───────────────────────────────────────────

type SSEClient = (data: string) => void;
const sseClients = new Set<SSEClient>();

export function addSSEClient(cb: SSEClient): () => void {
  sseClients.add(cb);
  return () => sseClients.delete(cb);
}

// ─── Core: record a request ──────────────────────────────────

export interface RecordParams {
  endpoint: string;
  clientModel: string;
  upstreamProvider: string;
  upstreamModel: string;
  stream: boolean;
  requestBody: Record<string, unknown>;
  statusCode: number;
  latencyMs: number;
  totalMs: number;
  tokens: Tokens;
  responseMeta?: Record<string, unknown>; // stripped, for SQLite
  error: string | null;
}

let seq = 0;

export function recordRequest(p: RecordParams): number {
  if (!recorderEnabled) return 0;

  const timestamp = new Date().toISOString();
  const id = ++seq;

  // 1. SSE broadcast (compact, no messages/content)
  {
    const data = `data: ${JSON.stringify({ id, timestamp, endpoint: p.endpoint, clientModel: p.clientModel, upstreamProvider: p.upstreamProvider, upstreamModel: p.upstreamModel, stream: p.stream, statusCode: p.statusCode, latencyMs: p.latencyMs, totalMs: p.totalMs, tokens: p.tokens, error: p.error })}\n\n`;
    for (const cb of sseClients) cb(data);
  }

  // 2. SQLite persistence — summarize large fields
  const requestParams: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(p.requestBody)) {
    if (key === 'messages' && Array.isArray(val)) {
      requestParams.messages = `${val.length} messages`;
    } else if (key === 'input' && Array.isArray(val)) {
      requestParams.input = `${val.length} input items`;
    } else if (key === 'tools' && Array.isArray(val)) {
      requestParams.tools = val.map((t: Record<string, unknown>) => (t.function as Record<string, unknown>)?.name ?? t.name ?? t.type);
    } else {
      requestParams[key] = val;
    }
  }
  const responseMeta = p.responseMeta ?? p.tokens;

  setImmediate(() => {
    try {
      db.run(
        `INSERT INTO request_logs
         (id, timestamp, endpoint, client_model, upstream_provider, upstream_model,
          stream, status_code, latency_ms, total_ms, request_params, response_meta, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, timestamp, p.endpoint, p.clientModel, p.upstreamProvider, p.upstreamModel,
          p.stream ? 1 : 0, p.statusCode, p.latencyMs, p.totalMs,
          JSON.stringify(requestParams),
          JSON.stringify(responseMeta),
          p.error,
        ],
      );
    } catch (e) {
      console.error('[recorder] SQLite write failed:', e);
    }
  });

  return id;
}

// ─── Query / clear persisted logs ────────────────────────────

export function clearLogs(): void {
  if (db) db.run('DELETE FROM request_logs');
}

export interface LogQueryParams {
  limit?: number; offset?: number;
  endpoint?: string; clientModel?: string; provider?: string;
  from?: string; to?: string; errorOnly?: boolean;
}

export function queryLogs(params: LogQueryParams = {}): { logs: LogEntry[]; total: number } {
  const conditions: string[] = [];
  const values: string[] = [];

  if (params.endpoint)     { conditions.push('endpoint = ?');          values.push(params.endpoint); }
  if (params.clientModel)  { conditions.push('client_model = ?');      values.push(params.clientModel); }
  if (params.provider)     { conditions.push('upstream_provider = ?'); values.push(params.provider); }
  if (params.from)         { conditions.push('timestamp >= ?');        values.push(params.from); }
  if (params.to)           { conditions.push('timestamp <= ?');        values.push(params.to); }
  if (params.errorOnly)    { conditions.push('error IS NOT NULL'); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(params.limit ?? 100, 1000);
  const offset = params.offset ?? 0;

  const { c: total } = db.query(`SELECT COUNT(*) as c FROM request_logs ${where}`).get(...values) as { c: number };
  const logs = db.query(`SELECT * FROM request_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...values, limit, offset) as LogEntry[];

  return { logs, total };
}

/** Update after stream completes. */
export function updateTokens(id: number, tokens: Tokens, totalMs: number, meta?: Record<string, unknown>): void {
  if (id === 0) return;
  const hasMeta = meta && Object.keys(meta).length > 0;
  const responseMeta = JSON.stringify(hasMeta ? { ...meta, ...tokens } : tokens);
  try {
    db.run(`UPDATE request_logs SET response_meta = ?, total_ms = ? WHERE id = ?`, [responseMeta, totalMs, id]);
  } catch (e) {
    console.error('[recorder] updateTokens failed:', e);
  }
  // Broadcast update via SSE
  const data = `event: update\ndata: ${JSON.stringify({ id, tokens, totalMs })}\n\n`;
  for (const cb of sseClients) cb(data);
}

// ─── Lifecycle ───────────────────────────────────────────────

export function initRecorder(enabled: boolean): void {
  recorderEnabled = enabled;
  if (!enabled) { console.log('[recorder] 已禁用'); return; }
  initDb();
  console.log('[recorder] SQLite 已就绪');
}

export function closeRecorder(): void { db?.close(); }

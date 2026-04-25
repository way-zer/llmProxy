const MAX_ENTRIES = 50;

export interface HttpTrace {
  id: number;
  timestamp: string;
  endpoint: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body: string;
  } | null;
  latencyMs: number;
  error: string | null;
}

let enabled = false;
const ring: HttpTrace[] = [];
let seq = 0;

export function isEnabled(): boolean { return enabled; }
export function setEnabled(v: boolean): void { enabled = v; if (!v) ring.length = 0; }

export function getTraces(): HttpTrace[] { return [...ring].reverse(); }
export function clear(): void { ring.length = 0; seq = 0; }

export function recordTrace(
  endpoint: string,
  reqMethod: string, reqUrl: string, reqHeaders: Record<string, string>, reqBody: string,
  resStatus: number, resHeaders: Record<string, string>, resBody: string,
  latencyMs: number, error: string | null,
): void {
  if (!enabled) return;
  const id = ++seq;
  ring.push({
    id, timestamp: new Date().toISOString(), endpoint,
    request: { method: reqMethod, url: reqUrl, headers: reqHeaders, body: reqBody },
    response: resStatus > 0 ? { status: resStatus, headers: resHeaders, body: resBody } : null,
    latencyMs, error,
  });
  if (ring.length > MAX_ENTRIES) ring.shift();
}

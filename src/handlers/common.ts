import { CORS, json } from '../http';
import { type Tokens } from '../recorder';
import { isEnabled as isHttpTraceOn, recordTrace } from '../httpTrace';

export { type Tokens };
export const ZERO_TOKENS: Tokens = { input: 0, output: 0, reasoning: 0, cached: 0, cacheWrite: 0 };

export async function fetchUpstream(endpoint: string, baseUrl: string, apiKey: string, body: Record<string, unknown>): Promise<Response> {
  const target = `${baseUrl.replace(/\/$/, '')}/${endpoint}`;
  const reqBody = JSON.stringify(body);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  const start = performance.now();
  const res = await fetch(target, { method: 'POST', headers, body: reqBody });

  if (isHttpTraceOn()) {
    const ms = Math.round(performance.now() - start);
    const clone = res.clone();
    clone.text().then(body => {
      const h: Record<string, string> = {};
      clone.headers.forEach((v, k) => h[k] = v);
      recordTrace(endpoint, 'POST', target, headers, reqBody, res.status, h, body, ms, null);
    }).catch(() => {});
  }

  return res;
}

export function pipeStream(
  res: Response,
  onChunk: (chunk: Record<string, unknown>) => void,
  onComplete: () => void,
): Response {
  const r = res.body?.getReader();
  if (!r) return json({ error: '上游响应为空' }, 502);
  let buffer = '';

  return new Response(new ReadableStream({
    async start(c) {
      try {
        while (true) {
          const { done, value } = await r.read();
          if (done) break;
          c.enqueue(value);
          buffer += new TextDecoder().decode(value);
          const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const p = line.slice(6).replace(/\r$/, '');
            if (p === '[DONE]') continue;
            try { onChunk(JSON.parse(p)); } catch { /* */ }
          }
        }
        // flush remaining
        if (buffer.startsWith('data: ')) {
          const p = buffer.slice(6).replace(/\r$/, '');
          if (p !== '[DONE]') { try { onChunk(JSON.parse(p)); } catch { /* */ } }
        }
        onComplete();
        c.close();
      } catch (e) { console.error('[proxy] stream:', e); c.error(e); } finally { r.releaseLock(); }
    },
  }), { status: res.status, headers: { ...forwardHeaders(res), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
}

const HOP_HEADERS = new Set(['transfer-encoding', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade']);

export function forwardHeaders(res: Response): Record<string, string> {
  const h: Record<string, string> = {};
  res.headers.forEach((v, k) => { if (!HOP_HEADERS.has(k.toLowerCase())) h[k] = v; });
  return { ...h, ...CORS };
}

export function upstreamError(res: Response, t: string): Response {
  console.error(`[proxy] Upstream ${res.status}: ${t.slice(0, 200)}`);
  return new Response(t, { status: res.status, headers: forwardHeaders(res) });
}

import { lookupModel } from '../config';
import { json } from '../http';
import { recordRequest, updateTokens, type Tokens } from '../recorder';
import { fetchUpstream, pipeStream, upstreamError, forwardHeaders, ZERO_TOKENS } from './common';

function extractTokens(chunk: Record<string, unknown>): Tokens | null {
  const usage = (chunk.usage ?? (chunk.response as Record<string, unknown>)?.usage) as Record<string, unknown> | undefined;
  if (!usage) return null;
  const d = (usage.input_tokens_details ?? usage.output_tokens_details ?? {}) as Record<string, unknown>;
  return {
    input: (usage.input_tokens ?? 0) as number,
    output: (usage.output_tokens ?? 0) as number,
    reasoning: (d.reasoning_tokens ?? 0) as number,
    cached: (d.cached_tokens ?? 0) as number,
    cacheWrite: 0,
  };
}

export async function handleResponses(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: '无效的 JSON 请求体' }, 400); }
  if (!body.model || typeof body.model !== 'string') return json({ error: "缺少 'model' 字段" }, 400);

  const u = lookupModel(body.model as string);
  if (!u) return json({ error: { message: `模型 '${body.model}' 未找到`, type: 'model_not_found' } }, 404);

  const clientModel = body.model as string;
  body.model = u.upstreamModelId;

  const logBase = {
    endpoint: 'responses',
    clientModel,
    upstreamProvider: u.providerName,
    upstreamModel: u.upstreamModelId,
    stream: !!body.stream,
    requestBody: body,
  };

  const start = performance.now();
  try {
    const res = await fetchUpstream(logBase.endpoint, u.provider.baseUrl, u.provider.apiKey, body);
    const latencyMs = Math.round(performance.now() - start);

    if (!res.ok) {
      const t = await res.text();
      recordRequest({ ...logBase, statusCode: res.status, totalMs: latencyMs, latencyMs, tokens: ZERO_TOKENS, error: t.slice(0, 500) });
      return upstreamError(res, t);
    }

    if (!logBase.stream) {
      const t = await res.text();
      let tokens = ZERO_TOKENS;
      let meta: Record<string, unknown> | undefined;
      try { const p = JSON.parse(t); tokens = extractTokens(p) ?? ZERO_TOKENS; const { output, ...m } = p; meta = m; } catch { /* */ }

      recordRequest({ ...logBase, statusCode: res.status, totalMs: Math.round(performance.now() - start), latencyMs, tokens, responseMeta: meta, error: null });
      return new Response(t, { status: res.status, headers: forwardHeaders(res) });
    }

    const logId = recordRequest({ ...logBase, statusCode: res.status, totalMs: 0, latencyMs, tokens: ZERO_TOKENS, error: null });
    const tokens: Tokens = { input: 0, output: 0, reasoning: 0, cached: 0, cacheWrite: 0 };
    const meta: Record<string, unknown> = {};
    return pipeStream(res,
      chunk => {
        if (chunk.model && !meta.model) meta.model = chunk.model;
        if (chunk.system_fingerprint && !meta.system_fingerprint) meta.system_fingerprint = chunk.system_fingerprint;
        if ((chunk.choices as any)?.[0]?.finish_reason) meta.finish_reason = (chunk.choices as any)[0].finish_reason;
        const t = extractTokens(chunk);
        if (t) { tokens.input = t.input || tokens.input; tokens.output = t.output || tokens.output; tokens.reasoning = t.reasoning || tokens.reasoning; tokens.cached = t.cached || tokens.cached; tokens.cacheWrite = t.cacheWrite || tokens.cacheWrite; }
      },
      () => {
        updateTokens(logId, tokens, Math.round(performance.now() - start), meta);
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[proxy] fetch: ${msg}`);
    recordRequest({ ...logBase, statusCode: 502, totalMs: Math.round(performance.now() - start), latencyMs: 0, tokens: ZERO_TOKENS, error: msg });
    return json({ error: `上游连接失败: ${msg}` }, 502);
  }
}

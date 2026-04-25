import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api';
import type { LiveEvent } from '../recorder';

const PAGE_SIZE = 20;
const MAX_LIVE = 50;

const badge = (code: number) => {
  if (code >= 200 && code < 300) return <span className="badge badge-ok">{code}</span>;
  if (code >= 400) return <span className="badge badge-err">{code}</span>;
  return <span className="badge badge-pending">{code}</span>;
};
const fmtLat = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
const fmtTime = (ts: string) => new Date(ts).toLocaleTimeString();
const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };

interface HistoryRow {
  id: number; timestamp: string; endpoint: string;
  client_model: string; upstream_provider: string; upstream_model: string;
  stream: number; status_code: number; total_ms: number; latency_ms: number;
  request_params: string; response_meta: string; error: string | null;
}

interface RowData {
  key: string; timestamp: string; endpoint: string; clientModel: string;
  upstreamModel: string; upstreamProvider: string; stream: boolean;
  statusCode: number; latencyMs: number; totalMs: number;
  tokens: { input: number; output: number; cached: number; cacheWrite: number };
  error: string | null; isLive: boolean;
  requestParams?: string; responseMeta?: string;
}

export function Monitor() {
  const [liveRows, setLiveRows] = useState<LiveEvent[]>([]);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const seenIds = useRef<Set<number>>(new Set());
  const pageRef = useRef(0);

  const loadHistory = useCallback(async (page: number) => {
    try {
      const r = await api.getLogs({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      setHistoryRows(r.logs as unknown as HistoryRow[]);
      setHistoryTotal(r.total); setHistoryErr(null);
    } catch (e) { setHistoryErr(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => {
    loadHistory(0);
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as LiveEvent;
        if (seenIds.current.has(evt.id)) return;
        seenIds.current.add(evt.id);
        setLiveRows(prev => { const n = [evt, ...prev]; return n.slice(0, MAX_LIVE); });
        api.getLogs({ limit: 1 }).then(r => setHistoryTotal(r.total)).catch(() => {});
      } catch { /* */ }
    };
    es.addEventListener('update', (e: Event) => {
      try {
        const upd = JSON.parse((e as MessageEvent).data) as { id: number; tokens: { input: number; output: number; reasoning: number; cached: number; cacheWrite: number }; totalMs: number };
        setLiveRows(prev => prev.filter(ev => ev.id !== upd.id));
        loadHistory(pageRef.current);
      } catch { /* */ }
    });
    es.onerror = () => {};
    return () => { es.close(); };
  }, [loadHistory]);

  const goPage = (p: number) => { setHistoryPage(p); pageRef.current = p; loadHistory(p); };
  const toggleExpand = (key: string) => setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const totalPages = Math.max(1, Math.ceil(historyTotal / PAGE_SIZE));

  // Build unified rows: live first, then history
  const allRows: RowData[] = [
    ...liveRows.map(e => ({
      key: `live-${e.id}`, timestamp: e.timestamp, endpoint: e.endpoint,
      clientModel: e.clientModel, upstreamModel: e.upstreamModel, upstreamProvider: e.upstreamProvider,
      stream: e.stream, statusCode: e.statusCode, latencyMs: e.latencyMs, totalMs: e.totalMs,
      tokens: e.tokens, error: e.error, isLive: true,
    })),
    ...historyRows.map(row => ({
      key: `hist-${row.id}`, timestamp: row.timestamp, endpoint: row.endpoint,
      clientModel: row.client_model, upstreamModel: row.upstream_model, upstreamProvider: row.upstream_provider,
      stream: !!row.stream, statusCode: row.status_code, latencyMs: row.latency_ms, totalMs: row.total_ms,
      tokens: (() => { try { const m = JSON.parse(row.response_meta); return { input: (m.input ?? m.promptTokens ?? 0) as number, output: (m.output ?? m.completionTokens ?? 0) as number, cached: (m.cached ?? 0) as number, cacheWrite: (m.cacheWrite ?? 0) as number }; } catch { return { input: 0, output: 0, cached: 0, cacheWrite: 0 }; } })(),
      error: row.error, isLive: false,
      requestParams: row.request_params, responseMeta: row.response_meta,
    })),
  ];

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h2>请求记录 <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 400 }}>({historyTotal} 条)</span>{historyErr && <span style={{ color: 'var(--red)', marginLeft: 8, fontSize: 13 }}>{historyErr}</span>}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <button className="btn btn-xs" onClick={() => loadHistory(historyPage)}>刷新</button>
            <button className="btn btn-xs btn-danger" onClick={() => { if (confirm('清空所有历史记录？')) { api.clearLogs().then(() => { loadHistory(0); setLiveRows([]); }).catch(() => {}); } }}>清空</button>
            {totalPages > 1 && (<>
              <button className="btn btn-xs" disabled={historyPage === 0} onClick={() => goPage(historyPage - 1)}>‹</button>
              <span style={{ color: 'var(--text2)' }}>{historyPage + 1}/{totalPages}</span>
              <button className="btn btn-xs" disabled={historyPage >= totalPages - 1} onClick={() => goPage(historyPage + 1)}>›</button>
            </>)}
          </div>
        </div>
        {allRows.length === 0 ? (
          <div className="empty"><p>暂无记录。发送 API 请求到代理端点即可看到数据。</p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th style={{ width: 30 }} /><th style={{ width: 80 }}>时间</th><th>端点</th><th>客户端模型</th><th>上游</th>
                <th style={{ width: 60 }}>状态</th><th style={{ width: 100 }}>耗时</th><th style={{ width: 160 }}>Tokens</th>
              </tr></thead>
              <tbody>
                {allRows.map(r => <RequestRow key={r.key} r={r} expanded={expanded} onToggle={toggleExpand} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <HttpTracePanel />
    </>
  );
}

// ─── Shared row component ────────────────────────────────────

function RequestRow({ r, expanded, onToggle }: { r: RowData; expanded: Set<string>; onToggle: (k: string) => void }) {
  const isExp = expanded.has(r.key);
  const t = r.tokens;

  return (<>
    <tr onClick={() => onToggle(r.key)} style={{ cursor: 'pointer', ...(r.isLive ? { background: 'rgba(99,102,241,.06)' } : {}), ...(r.error ? { background: 'rgba(239,68,68,.06)' } : {}) }}>
      <td style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 12 }}>{isExp ? '▲' : '▶'}</td>
      <td style={{ fontSize: 13, color: 'var(--text2)' }}>{r.isLive && <span className="badge badge-pending" style={{ marginRight: 4, fontSize: 10 }}>LIVE</span>}{fmtTime(r.timestamp)}</td>
      <td className="mono" style={{ fontSize: 13 }}>{r.endpoint}</td>
      <td className="mono" style={{ fontSize: 13 }}>{r.clientModel}</td>
      <td style={{ fontSize: 13, color: 'var(--text2)' }}>{r.upstreamModel} <span style={{ color: 'var(--text2)', opacity: .5 }}>({r.upstreamProvider})</span></td>
      <td><span style={{ whiteSpace: 'nowrap' }}>{badge(r.statusCode)}{r.stream && <span className="badge badge-ok" style={{ marginLeft: 4 }}>流</span>}</span></td>
      <td style={{ fontSize: 13, color: 'var(--text2)' }}>{fmtLat(r.latencyMs)} / {fmtLat(r.totalMs)}</td>
      <td style={{ fontSize: 13, color: 'var(--text2)' }}>
        {r.stream && t.input + t.output === 0
          ? <span style={{ color: 'var(--amber)' }}>streaming…</span>
          : <>{t.input}入/{t.output}出{t.cached > 0 || t.cacheWrite > 0 ? <><br/><span style={{ fontSize: 12, opacity: .7 }}>缓存{t.cached}/{t.cacheWrite}</span></> : null}</>}
      </td>
    </tr>
    {isExp && (<tr><td colSpan={8} style={{ padding: '0 14px 12px' }}>
      <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: 12, fontSize: 13 }}>
        {r.requestParams != null && <>
          <div style={{ marginBottom: 10 }}><div style={{ color: 'var(--text2)', marginBottom: 4 }}>请求:</div><pre style={{ background: 'var(--surface)', borderRadius: 4, padding: 8, fontSize: 12, overflowX: 'auto', maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{JSON.stringify(tryParse(r.requestParams) ?? r.requestParams, null, 2)}</pre></div>
          <div><div style={{ color: 'var(--text2)', marginBottom: 4 }}>响应:</div><pre style={{ background: 'var(--surface)', borderRadius: 4, padding: 8, fontSize: 12, overflowX: 'auto', maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{JSON.stringify(tryParse(r.responseMeta ?? '') ?? r.responseMeta, null, 2)}</pre></div>
        </>}
      </div>
    </td></tr>)}
  </>);
}

// ─── HTTP Trace panel ────────────────────────────────────────

function HttpTracePanel() {
  const [on, setOn] = useState(false);
  const [traces, setTraces] = useState<Array<{ id: number; timestamp: string; request: { url: string; headers: Record<string, string>; body: string }; response: { status: number; headers: Record<string, string>; body: string } | null; latencyMs: number; error: string | null }>>([]);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    api.getHttpTraceConfig().then(c => setOn(c.enabled)).catch(() => {});
    const iv = setInterval(() => { api.getHttpTraces().then(setTraces).catch(() => {}); }, 2000);
    return () => clearInterval(iv);
  }, []);

  const toggle = async () => { const next = !on; setOn(next); try { await api.setHttpTraceConfig(next); } catch { setOn(!next); } };
  const fmtTime = (ts: string) => new Date(ts).toLocaleTimeString();

  return (
    <div className="card">
      <div className="card-header">
        <h2>Trace ({traces.length})</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ color: 'var(--text2)' }}>HTTP Trace</span>
            <span onClick={toggle} style={{ width: 36, height: 20, borderRadius: 10, background: on ? 'var(--green)' : 'var(--border)', position: 'relative', transition: 'background .2s', display: 'inline-block' }}>
              <span style={{ position: 'absolute', top: 1, left: on ? 18 : 1, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
            </span>
          </label>
          <button className="btn btn-xs btn-danger" onClick={() => { api.clearHttpTraces().then(() => setTraces([])).catch(() => {}); }}>清空</button>
        </div>
      </div>
      {!on ? <div className="empty"><p>Trace 已关闭。开启后可查看与上游的完整 HTTP 请求/响应（最近 50 条）。</p></div> :
        traces.length === 0 ? <div className="empty"><p>暂无记录。</p></div> : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table>
              <thead><tr><th style={{ width: 80 }}>时间</th><th>URL</th><th style={{ width: 60 }}>状态</th><th style={{ width: 70 }}>延迟</th><th style={{ width: 60 }} /></tr></thead>
              <tbody>
                {traces.map(t => (<><tr key={t.id} onClick={() => setSelected(prev => prev === t.id ? null : t.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontSize: 13, color: 'var(--text2)' }}>{fmtTime(t.timestamp)}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{t.request.url}</td>
                  <td>{t.response ? <span className={t.response.status >= 400 ? 'badge badge-err' : 'badge badge-ok'}>{t.response.status}</span> : '-'}</td>
                  <td style={{ fontSize: 13, color: 'var(--text2)' }}>{t.latencyMs}ms</td>
                  <td style={{ fontSize: 13, color: 'var(--accent2)' }}>{selected === t.id ? '▲' : '▼'}</td>
                </tr>
                {selected === t.id && (<tr><td colSpan={5} style={{ padding: '0 14px 12px' }}>
                  <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: 12, fontSize: 13 }}>
                    <div style={{ marginBottom: 10 }}><div style={{ color: 'var(--text2)', marginBottom: 4 }}>请求头:</div><pre style={{ background: 'var(--surface)', borderRadius: 4, padding: 8, fontSize: 12, overflowX: 'auto', maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{JSON.stringify(t.request.headers, null, 2)}</pre></div>
                    <div style={{ marginBottom: 10 }}><div style={{ color: 'var(--text2)', marginBottom: 4 }}>请求体:</div><pre style={{ background: 'var(--surface)', borderRadius: 4, padding: 8, fontSize: 12, overflowX: 'auto', maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{t.request.body}</pre></div>
                    {t.response && <><div style={{ marginBottom: 10 }}><div style={{ color: 'var(--text2)', marginBottom: 4 }}>响应头:</div><pre style={{ background: 'var(--surface)', borderRadius: 4, padding: 8, fontSize: 12, overflowX: 'auto', maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{JSON.stringify(t.response.headers, null, 2)}</pre></div>
                    <div><div style={{ color: 'var(--text2)', marginBottom: 4 }}>响应体:</div><pre style={{ background: 'var(--surface)', borderRadius: 4, padding: 8, fontSize: 12, overflowX: 'auto', maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{t.response.body}</pre></div></>}
                  </div>
                </td></tr>)}
                </>))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

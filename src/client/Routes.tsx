import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import type { MappingDef, ModelDef, ProviderInfo, TestResult } from './api';

interface Props { onRefresh: () => void; }

export function Routes({ onRefresh }: Props) {
  const [mappings, setMappings] = useState<MappingDef[]>([]);
  const [models, setModels] = useState<ModelDef[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [tests, setTests] = useState<Record<string, TestResult | null>>({});
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const toast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setMsg({ text, type }); setTimeout(() => setMsg(null), 3000);
  }, []);

  const load = useCallback(async () => {
    try {
      const [m, p, c] = await Promise.all([api.listMappings(), api.listProviders(), api.listModels()]);
      setMappings(m); setProviders(p); setModels(c); onRefresh();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  }, [onRefresh, toast]);

  useEffect(() => { load(); }, [load]);

  const testIt = async (name: string) => {
    setTests(prev => ({ ...prev, [name]: null }));
    try { const r = await api.test(name); setTests(prev => ({ ...prev, [name]: r })); }
    catch (e) { setTests(prev => ({ ...prev, [name]: { modelName: name, latencyMs: 0, ok: false, error: e instanceof Error ? e.message : String(e) } })); }
  };

  const testDirect = async (provider: string, modelId: string) => {
    setTests(prev => ({ ...prev, [modelId]: null }));
    try { const r = await api.testDirect(provider, modelId); setTests(prev => ({ ...prev, [modelId]: r })); }
    catch (e) { setTests(prev => ({ ...prev, [modelId]: { modelName: modelId, latencyMs: 0, ok: false, error: e instanceof Error ? e.message : String(e) } })); }
  };
  const updateMapping = async (name: string, provider: string, modelId: string) => {
    try { await api.updateMapping(name, provider, modelId); setMappings(prev => prev.map(m => m.name === name ? { ...m, provider, modelId } : m)); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); load(); }
  };

  const addRoute = async (name: string, provider: string, modelId: string) => {
    const exists = mappings.some(m => m.name === name);
    try {
      if (exists) { await api.updateMapping(name, provider, modelId); toast(`"${name}" updated`); }
      else { await api.addMapping(name, provider, modelId); toast(`"${name}" added to routes`); }
      load();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const removeMapping = async (name: string) => {
    if (!confirm(`Remove route "${name}"?`)) return;
    try { await api.removeMapping(name); toast('Route removed'); load(); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const removeModel = async (provider: string, modelId: string) => {
    if (!confirm(`Remove "${modelId}" from catalog?`)) return;
    try { await api.removeModel(provider, modelId); toast('Removed from catalog'); load(); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const routedSet = new Set(mappings.map(m => `${m.provider}|${m.modelId}`));

  const Latency = ({ name }: { name: string }) => {
    const t = tests[name];
    if (t === undefined) return <button className="btn btn-xs" onClick={() => testIt(name)}>Test</button>;
    if (t === null) return <span style={{ color: 'var(--text2)', fontSize: 12 }}>...</span>;
    if (t.ok) return <span className="badge badge-ok" title={t.preview ?? ''}>{t.latencyMs}ms</span>;
    return <span className="badge badge-err" title={t.error ?? ''}>fail</span>;
  };

  const kid = (m: ModelDef) => `${m.provider}|${m.modelId}`;

  return (
    <>
      {msg && <div className={`toast toast-${msg.type}`} style={{ marginBottom: 8 }}>{msg.text}</div>}

      {/* ── Model Catalog ── */}
      <div className="card">
        <div className="card-header"><h2>Model Catalog ({models.length})</h2></div>
        {models.length === 0 ? (
          <div className="empty"><p>No models in catalog. Star (★) models from the Providers tab.</p></div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Provider</th><th>Latency</th><th /></tr></thead>
            <tbody>
              {models.map(m => {
                const routed = routedSet.has(kid(m));
                return (
                  <tr key={kid(m)}>
                    <td className="mono"><b>{m.modelId}</b></td>
                    <td><span className="badge badge-provider">{m.provider}</span></td>
                    <td>
                      {tests[m.modelId] === undefined && <button className="btn btn-xs" onClick={() => testDirect(m.provider, m.modelId)}>Test</button>}
                      {tests[m.modelId] === null && <span style={{ color: 'var(--text2)', fontSize: 12 }}>...</span>}
                      {tests[m.modelId]?.ok && <span className="badge badge-ok" title={tests[m.modelId]!.preview ?? ''}>{tests[m.modelId]!.latencyMs}ms</span>}
                      {tests[m.modelId] && !tests[m.modelId]!.ok && <span className="badge badge-err" title={tests[m.modelId]!.error ?? ''}>fail</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!routed && <button className="btn btn-xs" onClick={() => addRoute(m.modelId, m.provider, m.modelId)}>Add Route</button>}
                      {routed && <span className="badge badge-ok" style={{ marginRight: 6 }}>routed</span>}
                      <button className="btn btn-danger btn-xs" onClick={() => removeModel(m.provider, m.modelId)}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Routes ── */}
      <div className="card">
        <div className="card-header"><h2>Routes ({mappings.length})</h2></div>
        {mappings.length === 0 ? (
          <div className="empty"><p>No routes yet. Add routes from the model catalog above.</p></div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Model</th><th>Latency</th><th /></tr></thead>
            <tbody>
              {mappings.map(m => (
                <tr key={m.name}>
                  <td className="mono"><b>{m.name}</b></td>
                  <td>
                    <select
                      value={`${m.provider}|${m.modelId}`}
                      onChange={e => { const [p, mid] = e.target.value.split('|'); updateMapping(m.name, p!, mid!); }}
                      style={{ ...selectStyle, width: '100%', maxWidth: 260 }}
                    >
                      {models.map(c => (
                        <option key={kid(c)} value={`${c.provider}|${c.modelId}`}>{c.modelId} ({c.provider})</option>
                      ))}
                    </select>
                  </td>
                  <td><Latency name={m.name} /></td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-danger btn-xs" onClick={() => removeMapping(m.name)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)',
  background: 'var(--surface2)', color: 'var(--text)', fontSize: 12,
  fontFamily: 'inherit', width: 140,
};

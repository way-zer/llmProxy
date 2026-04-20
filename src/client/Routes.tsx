import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import type { MappingDef, ModelDef, ProviderInfo, TestResult } from './api';

interface Props {
  onRefresh: () => void;
}

export function Routes({ onRefresh }: Props) {
  const [mappings, setMappings] = useState<MappingDef[]>([]);
  const [models, setModels] = useState<ModelDef[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [tests, setTests] = useState<Record<string, TestResult | null>>({});
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [pickModel, setPickModel] = useState('');

  const toast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  }, []);

  const load = useCallback(async () => {
    try {
      const [m, p, c] = await Promise.all([api.listMappings(), api.listProviders(), api.listModels()]);
      setMappings(m);
      setProviders(p);
      setModels(c);
      onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [onRefresh, toast]);

  useEffect(() => { load(); }, [load]);

  const testIt = async (name: string) => {
    setTests(prev => ({ ...prev, [name]: null }));
    try {
      const r = await api.test(name);
      setTests(prev => ({ ...prev, [name]: r }));
      setTests(prev => ({ ...prev, [name]: { modelName: name, latencyMs: 0, ok: false, error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const updateMapping = async (name: string, provider: string, modelId: string) => {
    try {
      await api.updateMapping(name, provider, modelId);
      setMappings(prev => prev.map(m => m.name === name ? { ...m, provider, modelId } : m));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      load();
    }
  };

  const addRoute = async (name: string, provider: string, modelId: string) => {
    if (mappings.some(m => m.name === name)) {
      toast(`"${name}" already routed`, 'error');
      return;
    }
    try {
      await api.addMapping(name, provider, modelId);
      toast(`"${name}" added to routes`);
      load();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const removeMapping = async (name: string) => {
    if (!confirm(`Remove route "${name}"?`)) return;
    try { await api.removeMapping(name); toast('Route removed'); load(); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const removeModel = async (name: string) => {
    if (!confirm(`Remove "${name}" from catalog?`)) return;
    try { await api.removeModel(name); toast('Removed from catalog'); load(); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const handlePickModel = (val: string) => {
    setPickModel(val);
    if (!val) return;
    const model = models.find(m => m.name === val);
    if (model) addRoute(model.name, model.provider, model.modelId);
  };

  const routedNames = new Set(mappings.map(m => m.name));

  const Latency = ({ name }: { name: string }) => {
    const t = tests[name];
    if (t === undefined) return <button className="btn btn-xs" onClick={() => testIt(name)}>Test</button>;
    if (t === null) return <span style={{ color: 'var(--text2)', fontSize: 12 }}>...</span>;
    if (t.ok) return <span className="badge badge-ok" title={t.preview ?? ''}>{t.latencyMs}ms</span>;
    return <span className="badge badge-err" title={t.error ?? ''}>fail</span>;
  };

  return (
    <>
      {msg && <div className={`toast toast-${msg.type}`} style={{ marginBottom: 8 }}>{msg.text}</div>}

      {/* ── Model Catalog (top) ── */}
      <div className="card">
        <div className="card-header">
          <h2>Model Catalog ({models.length})</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>Add to routes:</span>
            <select
              value={pickModel}
              onChange={e => handlePickModel(e.target.value)}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', minWidth: 180 }}
            >
              <option value="">-- pick a model --</option>
              {models.filter(m => !routedNames.has(m.name)).map(m => (
                <option key={m.name} value={m.name}>{m.name} ({m.provider})</option>
              ))}
            </select>
          </div>
        </div>
        {models.length === 0 ? (
          <div className="empty"><p>No models in catalog. Star (★) models from the Providers tab.</p></div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Provider</th><th>Upstream</th><th>Latency</th><th /></tr></thead>
            <tbody>
              {models.map(m => {
                const routed = routedNames.has(m.name);
                return (
                  <tr key={m.name}>
                    <td className="mono"><b>{m.name}</b></td>
                    <td><span className="badge badge-provider">{m.provider}</span></td>
                    <td className="mono">{m.modelId}</td>
                    <td style={{ width: 90 }}><Latency name={m.name} /></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!routed && (
                        <button className="btn btn-xs" onClick={() => addRoute(m.name, m.provider, m.modelId)}>Add Route</button>
                      )}
                      {routed && <span className="badge badge-ok" style={{ marginRight: 8 }}>routed</span>}
                      <button className="btn btn-danger btn-xs" onClick={() => removeModel(m.name)}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Routes (bottom) ── */}
      <div className="card">
        <div className="card-header"><h2>Routes ({mappings.length})</h2></div>
        {mappings.length === 0 ? (
          <div className="empty"><p>No routes yet. Add routes from the model catalog above.</p></div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Provider</th><th>Upstream Model</th><th>Latency</th><th /></tr></thead>
            <tbody>
              {mappings.map(m => {
                const modelOptions = models.filter(c => c.provider === m.provider);
                return (
                  <tr key={m.name}>
                    <td className="mono"><b>{m.name}</b></td>
                    <td>
                      <select
                        value={m.provider}
                        onChange={e => updateMapping(m.name, e.target.value, m.modelId)}
                        style={selectStyle}
                      >
                        {providers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        value={m.modelId}
                        onChange={e => updateMapping(m.name, m.provider, e.target.value)}
                        style={selectStyle}
                      >
                        {modelOptions.length === 0 && <option value={m.modelId}>{m.modelId}</option>}
                        {modelOptions.map(c => <option key={c.modelId} value={c.modelId}>{c.modelId}</option>)}
                      </select>
                    </td>
                    <td style={{ width: 90 }}><Latency name={m.name} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-danger btn-xs" onClick={() => removeMapping(m.name)}>Remove</button>
                    </td>
                  </tr>
                );
              })}
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

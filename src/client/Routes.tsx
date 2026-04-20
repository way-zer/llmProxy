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
  // New mapping form
  const [newName, setNewName] = useState('');
  const [newProvider, setNewProvider] = useState('');
  const [newModelId, setNewModelId] = useState('');

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
    } catch (e) {
      setTests(prev => ({ ...prev, [name]: { modelName: name, latencyMs: 0, ok: false, error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const updateMapping = async (name: string, provider: string, modelId: string) => {
    try {
      await api.updateMapping(name, provider, modelId);
      setMappings(prev => prev.map(m => m.name === name ? { ...m, provider, modelId } : m));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      load(); // revert on error
    }
  };

  const removeMapping = async (name: string) => {
    if (!confirm(`Remove "${name}"?`)) return;
    try { await api.removeMapping(name); toast('Removed'); load(); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const removeModel = async (name: string) => {
    if (!confirm(`Remove "${name}" from catalog?`)) return;
    try { await api.removeModel(name); toast('Removed from catalog'); load(); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const addFromCatalog = async (name: string, provider: string, modelId: string) => {
    try {
      await api.addMapping(name, provider, modelId);
      toast(`"${name}" added`);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const createMapping = async () => {
    if (!newName || !newProvider || !newModelId) { toast('All fields required', 'error'); return; }
    try {
      await api.addMapping(newName, newProvider, newModelId);
      toast(`"${newName}" created`);
      setNewName(''); setNewModelId('');
      load();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  // Models without a mapping
  const unmappedModels = models.filter(m => !mappings.some(map => map.name === m.name));

  return (
    <>
      {/* Quick create */}
      <div className="quick-add card">
        <div className="form-group">
          <label>Name</label>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. my-gpt" style={{ width: 140 }} />
        </div>
        <div className="form-group">
          <label>Provider</label>
          <select value={newProvider} onChange={e => setNewProvider(e.target.value)}>
            <option value="">--</option>
            {providers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Upstream Model</label>
          <input value={newModelId} onChange={e => setNewModelId(e.target.value)} placeholder="e.g. gpt-4o" style={{ width: 160 }} />
        </div>
        <button className="btn btn-primary" onClick={createMapping} style={{ marginBottom: 0 }}>Create</button>
      </div>

      {msg && <div className={`toast toast-${msg.type}`} style={{ marginBottom: 8 }}>{msg.text}</div>}

      {/* Active mappings */}
      <div className="card">
        <div className="card-header"><h2>Routes ({mappings.length})</h2></div>
        {mappings.length === 0 ? (
          <div className="empty"><p>No routes yet. Import models from Providers or create one above.</p></div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Provider</th><th>Upstream Model</th><th>Latency</th><th /></tr></thead>
            <tbody>
              {mappings.map(m => {
                const t = tests[m.name];
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
                      <input
                        defaultValue={m.modelId}
                        onBlur={e => { if (e.target.value !== m.modelId) updateMapping(m.name, m.provider, e.target.value); }}
                        style={inputStyle}
                        list={`dl-${m.name}`}
                        key={m.name}
                      />
                      <datalist id={`dl-${m.name}`}>
                        {models.filter(c => c.provider === m.provider).map(c => <option key={c.modelId} value={c.modelId} />)}
                      </datalist>
                    </td>
                    <td style={{ width: 90 }}>
                      {t === undefined ? (
                        <button className="btn btn-xs" onClick={() => testIt(m.name)}>Test</button>
                      ) : t === null ? (
                        <span style={{ color: 'var(--text2)', fontSize: 12 }}>...</span>
                      ) : t.ok ? (
                        <span className="badge badge-ok" title={t.preview ?? ''}>{t.latencyMs}ms</span>
                      ) : (
                        <span className="badge badge-err" title={t.error ?? ''}>fail</span>
                      )}
                    </td>
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

      {/* Unmapped model catalog */}
      {unmappedModels.length > 0 && (
        <div className="card">
          <div className="card-header"><h2>Model Catalog — not routed ({unmappedModels.length})</h2></div>
          <table>
            <thead><tr><th>Name</th><th>Provider</th><th>Upstream</th><th /></tr></thead>
            <tbody>
              {unmappedModels.map(m => (
                <tr key={m.name}>
                  <td className="mono">{m.name}</td>
                  <td><span className="badge badge-provider">{m.provider}</span></td>
                  <td className="mono">{m.modelId}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-xs" onClick={() => addFromCatalog(m.name, m.provider, m.modelId)}>Add Route</button>
                    <button className="btn btn-danger btn-xs" onClick={() => removeModel(m.name)} style={{ marginLeft: 4 }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)',
  background: 'var(--surface2)', color: 'var(--text)', fontSize: 12,
  fontFamily: 'inherit', width: 110,
};

const inputStyle: React.CSSProperties = {
  padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)',
  background: 'var(--surface2)', color: 'var(--text)', fontSize: 12,
  fontFamily: 'inherit', width: 160,
};

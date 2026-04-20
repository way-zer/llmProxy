import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import type { MappingDef, ModelDef, ProviderInfo, TestResult } from './api';

interface Props {
  onRefresh: () => void;
}

export function Mappings({ onRefresh }: Props) {
  const [mappings, setMappings] = useState<MappingDef[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [catalog, setCatalog] = useState<ModelDef[]>([]);
  const [tests, setTests] = useState<Record<string, TestResult | null>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editProvider, setEditProvider] = useState('');
  const [editModelId, setEditModelId] = useState('');
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
      setCatalog(c);
      onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [onRefresh, toast]);

  useEffect(() => {
    load();
    // Listen for nav events from Models tab
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.name) setNewName(detail.name);
      if (detail?.provider) setNewProvider(detail.provider);
      if (detail?.modelId) setNewModelId(detail.modelId);
    };
    window.addEventListener('nav', handler);
    return () => window.removeEventListener('nav', handler);
  }, [load]);

  const testMapping = async (name: string) => {
    setTests(prev => ({ ...prev, [name]: null }));
    try {
      const r = await api.test(name);
      setTests(prev => ({ ...prev, [name]: r }));
    } catch (e) {
      setTests(prev => ({ ...prev, [name]: { modelName: name, latencyMs: 0, ok: false, error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const startEdit = (m: MappingDef) => {
    setEditing(m.name);
    setEditProvider(m.provider);
    setEditModelId(m.modelId);
  };

  const cancelEdit = () => {
    setEditing(null);
  };

  const saveEdit = async (name: string) => {
    if (!editProvider || !editModelId) { toast('Provider and Model ID required', 'error'); return; }
    try {
      await api.updateMapping(name, editProvider, editModelId);
      toast(`"${name}" updated`);
      setEditing(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const pickFromCatalog = (val: string) => {
    if (!val) return;
    const [p, m] = val.split('|');
    setEditProvider(p!);
    setEditModelId(m!);
  };

  const addMapping = async () => {
    if (!newName || !newProvider || !newModelId) { toast('All fields required', 'error'); return; }
    try {
      await api.addMapping(newName, newProvider, newModelId);
      toast(`"${newName}" created`);
      setNewName('');
      setNewModelId('');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const removeMapping = async (name: string) => {
    if (!confirm(`Remove mapping "${name}"?`)) return;
    try {
      await api.removeMapping(name);
      toast('Mapping removed');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <>
      <div className="quick-add card">
        <div className="form-group">
          <label>Mapping Name</label>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. my-gpt" style={{ width: 150 }} />
        </div>
        <div className="form-group">
          <label>Provider</label>
          <select value={newProvider} onChange={e => setNewProvider(e.target.value)}>
            <option value="">--</option>
            {providers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Upstream Model ID</label>
          <input value={newModelId} onChange={e => setNewModelId(e.target.value)} placeholder="e.g. gpt-4o" style={{ width: 160 }} />
        </div>
        <button className="btn btn-primary" onClick={addMapping} style={{ marginBottom: 0 }}>Create Mapping</button>
      </div>

      <div className="card">
        <div className="card-header"><h2>Routing Mappings (映射表)</h2></div>

        {msg && (
          <div className={`toast toast-${msg.type}`} style={{ position: 'relative', top: 0, right: 0, marginBottom: 8 }}>
            {msg.text}
          </div>
        )}

        {mappings.length === 0 ? (
          <div className="empty"><p>No mappings yet.</p></div>
        ) : (
          <table>
            <thead><tr><th>Mapping</th><th>Provider</th><th>Upstream</th><th>Latency</th><th /></tr></thead>
            <tbody>
              {mappings.map(m => {
                const t = tests[m.name];
                const isEditing = editing === m.name;
                return (
                  <tr key={m.name} style={isEditing ? { background: 'var(--surface2)' } : undefined}>
                    <td className="mono"><b>{m.name}</b></td>
                    {isEditing ? (
                      <>
                        <td>
                          <select value={editProvider} onChange={e => setEditProvider(e.target.value)}
                            style={{ padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', width: 110 }}>
                            {providers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <input value={editModelId} onChange={e => setEditModelId(e.target.value)}
                            style={{ padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', width: 150 }} />
                        </td>
                        <td />
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-primary btn-xs" onClick={() => saveEdit(m.name)}>Save</button>
                          <button className="btn btn-xs" onClick={cancelEdit}>Cancel</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td><span className="badge badge-provider">{m.provider}</span></td>
                        <td className="mono">{m.modelId}</td>
                        <td style={{ width: 90 }}>
                          {t === undefined ? (
                            <button className="btn btn-xs" onClick={() => testMapping(m.name)}>Test</button>
                          ) : t === null ? (
                            <span style={{ color: 'var(--text2)', fontSize: 12 }}>...</span>
                          ) : t.ok ? (
                            <span className="badge badge-ok" title={t.preview ?? ''}>{t.latencyMs}ms</span>
                          ) : (
                            <span className="badge badge-err" title={t.error ?? ''}>fail</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-xs" onClick={() => startEdit(m)}>Edit</button>
                          <button className="btn btn-danger btn-xs" onClick={() => removeMapping(m.name)}>Remove</button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Quick Pick — shown when editing */}
      {editing && (
        <div className="card" style={{ background: 'var(--surface2)', padding: '8px 16px' }}>
          <span style={{ color: 'var(--text2)', marginRight: 8, fontSize: 12 }}>Quick pick from catalog:</span>
          <select
            onChange={e => pickFromCatalog(e.target.value)}
            style={{ padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', minWidth: 180 }}
          >
            <option value="">-- select --</option>
            {catalog.map(m => (
              <option key={m.name} value={`${m.provider}|${m.modelId}`}>{m.name} ({m.provider})</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

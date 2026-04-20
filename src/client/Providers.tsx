import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import type { ProviderInfo, ScanResult, ModelDef } from './api';

interface Props {
  onRefresh: () => void;
}

export function Providers({ onRefresh }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scans, setScans] = useState<Record<string, ScanResult | null>>({});
  const [catalog, setCatalog] = useState<ModelDef[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', baseUrl: '', apiKey: '' });
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const toast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  }, []);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api.listProviders(), api.listModels()]);
      setProviders(p);
      setCatalog(c);
      onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [onRefresh, toast]);

  const loadScan = useCallback(async (name: string) => {
    try {
      const s = await api.getScan(name);
      setScans(prev => ({ ...prev, [name]: s }));
    } catch {
      setScans(prev => ({ ...prev, [name]: null }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (name: string) => {
    const next = new Set(expanded);
    if (next.has(name)) { next.delete(name); } else { next.add(name); await loadScan(name); }
    setExpanded(next);
  };

  const openModal = (p?: ProviderInfo) => {
    if (p) {
      setEditing(p.name);
      setForm({ name: p.name, baseUrl: p.baseUrl, apiKey: '' });
    } else {
      setEditing(null);
      setForm({ name: '', baseUrl: '', apiKey: '' });
    }
    setModalOpen(true);
  };

  const saveProvider = async () => {
    if (!form.name || !form.baseUrl) { toast('Name and Base URL required', 'error'); return; }
    try {
      if (editing) {
        await api.updateProvider(editing, form.baseUrl, form.apiKey);
        toast('Provider updated');
      } else {
        await api.addProvider(form.name, form.baseUrl, form.apiKey);
        toast('Provider added');
      }
      setModalOpen(false);
      // Wait for background scan, then reload
      setTimeout(() => { load(); }, 1500);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const removeProvider = async (name: string) => {
    if (!confirm(`Remove provider "${name}" and its catalog entries?`)) return;
    try {
      await api.removeProvider(name);
      toast('Provider removed');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const rescan = async (name: string) => {
    setScans(prev => ({ ...prev, [name]: null }));
    try {
      await api.rescan(name);
      toast('Re-scan complete');
      await loadScan(name);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const importAll = async (name: string) => {
    try {
      const r = await api.importAll(name);
      toast(`Added ${r.added}, skipped ${r.skipped}`);
      await load();
      await loadScan(name);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const toggleStar = async (provider: string, modelId: string) => {
    const catKey = `${provider}/${modelId}`;
    const starred = catalogSet.has(catKey);
    if (starred) {
      setCatalog(prev => prev.filter(m => m.name !== catKey));
    } else {
      setCatalog(prev => [...prev, { name: catKey, provider, modelId }]);
    }
    try {
      if (starred) await api.removeModel(catKey);
      else await api.importOne(provider, modelId);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      load();
    }
  };

  const catalogSet = new Set(catalog.map(m => m.name));

  return (
    <div className="card">
      <div className="card-header">
        <h2>Upstream Providers</h2>
        <button className="btn btn-primary" onClick={() => openModal()}>+ Add Provider</button>
      </div>

      {msg && (
        <div className={`toast toast-${msg.type}`} style={{ position: 'relative', top: 0, right: 0, marginBottom: 8 }}>
          {msg.text}
        </div>
      )}

      {providers.length === 0 ? (
        <div className="empty"><p>No providers configured.</p></div>
      ) : (
        providers.map(p => {
          const scan = scans[p.name];
          const isExp = expanded.has(p.name);
          return (
            <div key={p.name} className={`provider-card${isExp ? ' expanded' : ''}`}>
              <div className="provider-card-header" onClick={() => toggleExpand(p.name)}>
                <span className="expand-icon">▶</span>
                <span className="name">{p.name}</span>
                <span className="meta">
                  {p.modelCount > 0 && <span className="badge badge-provider">{p.modelCount} in catalog</span>}
                  {p.scanStatus === 'ok' && <span className="badge badge-ok">{p.scanModelCount} models</span>}
                  {p.scanStatus === 'error' && <span className="badge badge-err" title={p.scanError ?? ''}>scan failed</span>}
                  {p.scanStatus === 'pending' && <span className="badge badge-pending">scanning...</span>}
                  <span className="mono" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.baseUrl}</span>
                </span>
                <span className="inline-actions" onClick={e => e.stopPropagation()}>
                  <button className="btn btn-sm" onClick={() => openModal(p)}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => removeProvider(p.name)}>Remove</button>
                </span>
              </div>
              {isExp && (
                <div className="provider-card-body">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                    <span style={{ fontSize: 13, color: 'var(--text2)', flex: 1 }}>
                      Scanned from <code className="mono">{p.baseUrl}/models</code>
                    </span>
                    <button className="btn btn-sm" onClick={() => rescan(p.name)}>Re-scan</button>
                    <button className="btn btn-sm" onClick={() => importAll(p.name)}>Star All</button>
                  </div>
                  <div className="scan-model-list">
                    {scan === undefined ? (
                      <div className="empty"><p>Loading...</p></div>
                    ) : scan === null || scan.error ? (
                      <div className="empty"><p style={{ color: 'var(--red)' }}>{scan?.error || 'Not scanned yet — click Re-scan'}</p></div>
                    ) : scan.models.length === 0 ? (
                      <div className="empty"><p>No models found upstream.</p></div>
                    ) : (
                      scan.models.map(m => {
                        const starred = catalogSet.has(`${p.name}/${m.id}`);
                        return (
                        <div key={m.id} className="scan-model-row">
                          <span className="mono">{m.id}</span>
                          <span
                            onClick={() => toggleStar(p.name, m.id)}
                            style={{ cursor: 'pointer', fontSize: 15, userSelect: 'none', color: starred ? 'var(--amber)' : 'var(--border)' }}
                            title={starred ? 'Unstar' : 'Star'}
                          >{starred ? '★' : '☆'}</span>
                        </div>
                      )})
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="modal-overlay show" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}>
          <div className="modal">
            <h3>{editing ? 'Edit Provider' : 'Add Provider'}</h3>
            <div className="form-group">
              <label>Name</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} disabled={!!editing} placeholder="e.g. openai" />
            </div>
            <div className="form-group">
              <label>Base URL</label>
              <input value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
            </div>
            <div className="form-group">
              <label>API Key</label>
              <input type="password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveProvider}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

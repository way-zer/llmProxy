import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { useToast } from './App';
import type { ProviderInfo, ScanResult, ModelDef } from './api';

interface Props { onRefresh: () => void; }

export function Providers({ onRefresh }: Props) {
  const { toast, confirm } = useToast();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scans, setScans] = useState<Record<string, ScanResult | null>>({});
  const [catalog, setCatalog] = useState<ModelDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', baseUrl: '', apiKey: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api.listProviders(), api.listModels()]);
      setProviders(p); setCatalog(c); onRefresh();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
    finally { setLoading(false); }
  }, [onRefresh, toast]);

  const loadScan = useCallback(async (name: string) => {
    try {
      const result = await api.getScan(name);
      setScans(prev => ({ ...prev, [name]: result }));
    }
    catch { setScans(prev => ({ ...prev, [name]: null })); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (name: string) => {
    const next = new Set(expanded);
    if (next.has(name)) { next.delete(name); }
    else { next.add(name); await loadScan(name); }
    setExpanded(next);
  };

  const openModal = (p?: ProviderInfo) => {
    setFormErrors({});
    if (p) { setEditing(p.name); setForm({ name: p.name, baseUrl: p.baseUrl, apiKey: '' }); }
    else { setEditing(null); setForm({ name: '', baseUrl: '', apiKey: '' }); }
    setModalOpen(true);
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    if (!form.baseUrl.trim()) errs.baseUrl = 'Base URL is required';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const saveProvider = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing) {
        await api.updateProvider(editing, form.baseUrl, form.apiKey);
        toast('Provider updated');
      } else {
        await api.addProvider(form.name, form.baseUrl, form.apiKey);
        toast('Provider added');
      }
      setModalOpen(false);
      load();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
    finally { setSaving(false); }
  };

  const removeProvider = async (name: string) => {
    if (!await confirm(`Remove provider "${name}" and all its catalog entries?`)) return;
    try { await api.removeProvider(name); toast('Provider removed'); load(); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const rescan = async (name: string) => {
    setScans(prev => ({ ...prev, [name]: null }));
    try { await api.rescan(name); toast('Re-scan complete'); await loadScan(name); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const importAll = async (name: string) => {
    setImporting(prev => new Set(prev).add(name));
    try {
      const r = await api.importAll(name);
      toast(`Imported ${r.added} model${r.added !== 1 ? 's' : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}`);
      await load();
      await loadScan(name);
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
    finally { setImporting(prev => { const next = new Set(prev); next.delete(name); return next; }); }
  };

  const toggleStar = async (provider: string, modelId: string) => {
    const key = `${provider}|${modelId}`;
    const starred = catalogSet.has(key);
    setCatalog(prev => starred
      ? prev.filter(m => !(m.provider === provider && m.modelId === modelId))
      : [...prev, { provider, modelId }]
    );
    try {
      if (starred) await api.removeModel(provider, modelId);
      else await api.importOne(provider, modelId);
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); load(); }
  };

  const catalogSet = new Set(catalog.map(m => `${m.provider}|${m.modelId}`));

  // ─── Render helpers ────────────────────────────────────────

  const renderSkeleton = () => (
    <div className="card">
      <div className="card-header"><div className="skeleton" style={{ width: 160, height: 20 }} /></div>
      {[1, 2, 3].map(i => (
        <div key={i} className="skeleton-row">
          <div className="skeleton skeleton-cell" style={{ flex: 1 }} />
          <div className="skeleton skeleton-cell" style={{ width: 120 }} />
          <div className="skeleton skeleton-cell" style={{ width: 80 }} />
        </div>
      ))}
    </div>
  );

  // ─── Render ────────────────────────────────────────────────

  return (
    <div className="card">
      <div className="card-header">
        <h2>Upstream Providers</h2>
        <button className="btn btn-primary" onClick={() => openModal()}>+ Add Provider</button>
      </div>

      {loading ? renderSkeleton() : providers.length === 0 ? (
        <div className="empty">
          <p>No providers configured yet.</p>
          <button className="btn btn-primary" onClick={() => openModal()}>Add your first provider</button>
        </div>
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
                  {p.scanStatus === 'pending' && <span className="badge badge-pending">scanning…</span>}
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
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => importAll(p.name)}
                      disabled={importing.has(p.name)}
                    >
                      {importing.has(p.name) && <span className="spinner" />}
                      Star All
                    </button>
                  </div>
                  <div className="scan-model-list">
                    {scan === undefined ? (
                      <div className="empty"><p><span className="spinner" style={{ marginRight: 6 }} />Loading scan results...</p></div>
                    ) : scan === null || scan.error ? (
                      <div className="empty"><p style={{ color: 'var(--red)' }}>{scan?.error || 'Not scanned yet — click Re-scan'}</p></div>
                    ) : scan.models.length === 0 ? (
                      <div className="empty"><p>No models found upstream.</p></div>
                    ) : (
                      scan.models.map(m => {
                        const starred = catalogSet.has(`${p.name}|${m.id}`);
                        return (
                          <div key={m.id} className="scan-model-row">
                            <span className="mono">{m.id}</span>
                            <span
                              onClick={() => toggleStar(p.name, m.id)}
                              style={{ cursor: 'pointer', fontSize: 15, userSelect: 'none', color: starred ? 'var(--amber)' : 'var(--border)' }}
                              title={starred ? 'Remove from catalog' : 'Add to catalog'}
                            >{starred ? '★' : '☆'}</span>
                          </div>
                        );
                      })
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
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}>
          <div className="modal">
            <h3>{editing ? 'Edit Provider' : 'Add Provider'}</h3>
            <div className="form-group">
              <label>Name</label>
              <input
                className={formErrors.name ? 'has-error' : ''}
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                disabled={!!editing}
                placeholder="e.g. openai"
                autoFocus={!editing}
              />
              {formErrors.name && <div className="form-error">{formErrors.name}</div>}
            </div>
            <div className="form-group">
              <label>Base URL</label>
              <input
                className={formErrors.baseUrl ? 'has-error' : ''}
                value={form.baseUrl}
                onChange={e => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                autoFocus={!!editing}
              />
              {formErrors.baseUrl && <div className="form-error">{formErrors.baseUrl}</div>}
            </div>
            <div className="form-group">
              <label>API Key</label>
              <input
                type="password"
                value={form.apiKey}
                onChange={e => setForm({ ...form, apiKey: e.target.value })}
                placeholder="sk-..."
              />
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveProvider} disabled={saving}>
                {saving && <span className="spinner" />}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

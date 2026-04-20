import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import type { ModelDef, TestResult } from './api';

interface Props {
  onRefresh: () => void;
}

export function Models({ onRefresh }: Props) {
  const [models, setModels] = useState<ModelDef[]>([]);
  const [tests, setTests] = useState<Record<string, TestResult | null>>({});
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const toast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  }, []);

  const load = useCallback(async () => {
    try {
      setModels(await api.listModels());
      onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [onRefresh, toast]);

  useEffect(() => { load(); }, [load]);

  const testModel = async (name: string) => {
    setTests(prev => ({ ...prev, [name]: null }));
    try {
      const r = await api.test(name);
      setTests(prev => ({ ...prev, [name]: r }));
    } catch (e) {
      setTests(prev => ({ ...prev, [name]: { modelName: name, latencyMs: 0, ok: false, error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const removeModel = async (name: string) => {
    if (!confirm(`Remove "${name}" from catalog?`)) return;
    try {
      await api.removeModel(name);
      toast('Removed');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const switchToMappings = (name: string, provider: string, modelId: string) => {
    // Dispatch a custom event to switch tabs
    window.dispatchEvent(new CustomEvent('nav', { detail: { tab: 'mappings', name, provider, modelId } }));
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Model Catalog (模型目录)</h2>
        <button className="btn btn-sm" onClick={load}>Refresh</button>
      </div>

      {msg && (
        <div className={`toast toast-${msg.type}`} style={{ position: 'relative', top: 0, right: 0, marginBottom: 8 }}>
          {msg.text}
        </div>
      )}

      {models.length === 0 ? (
        <div className="empty"><p>No models in catalog.</p></div>
      ) : (
        <table>
          <thead><tr><th>Name</th><th>Provider</th><th>Upstream</th><th>Latency</th><th /></tr></thead>
          <tbody>
            {models.map(m => {
              const t = tests[m.name];
              return (
                <tr key={m.name}>
                  <td className="mono"><b>{m.name}</b></td>
                  <td><span className="badge badge-provider">{m.provider}</span></td>
                  <td className="mono">{m.modelId}</td>
                  <td style={{ width: 90 }}>
                    {t === undefined ? (
                      <button className="btn btn-xs" onClick={() => testModel(m.name)}>Test</button>
                    ) : t === null ? (
                      <span style={{ color: 'var(--text2)', fontSize: 12 }}>...</span>
                    ) : t.ok ? (
                      <span className="badge badge-ok" title={t.preview ?? ''}>{t.latencyMs}ms</span>
                    ) : (
                      <span className="badge badge-err" title={t.error ?? ''}>fail</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-xs" onClick={() => switchToMappings(m.name, m.provider, m.modelId)}>+ Mapping</button>
                    <button className="btn btn-danger btn-xs" onClick={() => removeModel(m.name)}>Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

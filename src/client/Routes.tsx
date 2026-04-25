import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import type { MappingDef, ModelDef, ProviderInfo, TestResult } from './api';

interface Props { onRefresh: () => void; }

const modelKey = (m: ModelDef) => `${m.provider}|${m.modelId}`;


interface LatencyProps { name: string }
const Latency = ({ name }: LatencyProps) => {
  const [result, setResult] = useState<TestResult | null | undefined>(undefined);
  const test = async () => {
    setResult(null);
    try { setResult(await api.test(name)); }
    catch (e) { setResult({ modelName: name, latencyMs: 0, ok: false, error: e instanceof Error ? e.message : String(e) }); }
  };
  if (result === undefined) return <button className="btn btn-xs" onClick={test}>测试</button>;
  if (result === null) return <span style={{ color: 'var(--text2)', fontSize: 14 }}>...</span>;
  if (result.ok) return <span className="badge badge-ok" title={`${result.preview ?? ''}&#10;点击重新测试`} onClick={test} style={{ cursor: 'pointer' }}>{result.latencyMs}ms</span>;
  return <span className="badge badge-err" title={result.error ?? '未知错误'} onClick={test} style={{ cursor: 'pointer' }}>{result.error ? result.error.slice(0, 40) + (result.error.length > 40 ? '…' : '') : '失败'}</span>;
};


export function Routes({ onRefresh }: Props) {
  const [mappings, setMappings] = useState<MappingDef[]>([]);
  const [models, setModels] = useState<ModelDef[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [directTests, setDirectTests] = useState<Record<string, TestResult | null>>({});
  const [testingAll, setTestingAll] = useState<{ total: number; done: number } | null>(null);
  const [newRouteName, setNewRouteName] = useState('');
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const toast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setMsg({ text, type }); setTimeout(() => setMsg(null), 3000);
  }, []);

  const load = useCallback(async () => {
    try {
      const [m, p, c] = await Promise.all([api.listMappings(), api.listProviders(), api.listModels()]);
      setMappings(m); setProviders(p); setModels(c.toSorted((a, b) => a.provider.localeCompare(b.provider) || a.modelId.localeCompare(b.modelId))); onRefresh();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  }, [onRefresh, toast]);

  useEffect(() => { load(); }, [load]);

  const testDirect = async (provider: string, modelId: string) => {
    const key = `${provider}|${modelId}`;
    setDirectTests(prev => ({ ...prev, [key]: null }));
    try {
      const result = await api.testDirect(provider, modelId);
      setDirectTests(prev => ({ ...prev, [key]: result }));
    }
    catch (e) { setDirectTests(prev => ({ ...prev, [key]: { modelName: modelId, latencyMs: 0, ok: false, error: e instanceof Error ? e.message : String(e) } })); }
  };

  const testAllModels = useCallback(async () => {
    setTestingAll({ total: models.length, done: 0 });
    let done = 0;
    const promises = models.map(async (m) => {
      const key = modelKey(m);
      setDirectTests(prev => ({ ...prev, [key]: null }));
      try {
        const result = await api.testDirect(m.provider, m.modelId);
        setDirectTests(prev => ({ ...prev, [key]: result }));
      } catch (e) {
        setDirectTests(prev => ({ ...prev, [key]: { modelName: m.modelId, latencyMs: 0, ok: false, error: e instanceof Error ? e.message : String(e) } }));
      }
      done++;
      setTestingAll(prev => prev ? { ...prev, done } : null);
    });
    await Promise.all(promises);
    setTestingAll(null);
  }, [models]);

  const updateMapping = async (name: string, provider: string, modelId: string) => {
    try { await api.updateMapping(name, provider, modelId); setMappings(prev => prev.map(m => m.name === name ? { ...m, provider, modelId } : m)); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); load(); }
  };

  const addRoute = async (name: string, provider: string, modelId: string) => {
    const exists = mappings.some(m => m.name === name);
    try {
      if (exists) { await api.updateMapping(name, provider, modelId); toast(`"${name}" 已更新`); }
      else { await api.addMapping(name, provider, modelId); toast(`"${name}" 已添加到路由`); }
      load();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const handleAddRoute = async () => {
    const name = newRouteName.trim();
    if (!name) return;
    try {
      const r = await api.addMapping(name);
      toast(`"${name}" → ${r.modelId} (${r.provider})${r.fuzzy ? ' [模糊匹配]' : ''}`);
      setNewRouteName('');
      load();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };
  const removeMapping = async (name: string) => {
    if (!confirm(`删除路由 "${name}"？`)) return;
    try { await api.removeMapping(name); toast('路由已删除'); load(); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const removeModel = async (provider: string, modelId: string) => {
    if (!confirm(`从目录中删除 "${modelId}"？`)) return;
    try {
      const result = await api.removeModel(provider, modelId);
      if (result.reassigned.length > 0) {
        const names = result.reassigned.map(r => `"${r.name}" → ${r.to}`).join(', ');
        toast(`已删除。路由重分配: ${names}`);
      } else {
        toast('已从目录删除');
      }
      load();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const routedSet = new Set(mappings.map(m => `${m.provider}|${m.modelId}`));

  const DirectLatency = ({ provider, modelId }: { provider: string; modelId: string }) => {
    const key = `${provider}|${modelId}`;
    const t = directTests[key];
    if (t === undefined) return <button className="btn btn-xs" onClick={() => testDirect(provider, modelId)}>测试</button>;
    if (t === null) return <span style={{ color: 'var(--text2)', fontSize: 14 }}>...</span>;
    if (t.ok) return <span className="badge badge-ok" title={`${t.preview ?? ''}&#10;点击重新测试`} onClick={() => testDirect(provider, modelId)} style={{ cursor: 'pointer' }}>{t.latencyMs}ms</span>;
    return <span className="badge badge-err" title={t.error ?? '未知错误'} onClick={() => testDirect(provider, modelId)} style={{ cursor: 'pointer' }}>{t.error ? t.error.slice(0, 40) + (t.error.length > 40 ? '…' : '') : '失败'}</span>;
  };

  return (
    <>
      {msg && <div className={`toast toast-${msg.type}`} style={{ marginBottom: 8 }}>{msg.text}</div>}

      {/* ── Model Catalog ── */}
      <div className="card">
        <div className="card-header"><h2>模型目录 ({models.length})</h2>
          {models.length > 0 && (
            testingAll
              ? <span style={{ fontSize: 14, color: 'var(--text2)' }}>测试中 {testingAll.done}/{testingAll.total}...</span>
              : <button className="btn btn-xs" onClick={testAllModels}>全部测试</button>
          )}
        </div>
        {models.length === 0 ? (
          <div className="empty"><p>目录中暂无模型。请在「提供商」标签页中点击 ★ 导入。</p></div>
        ) : (
          <table>
            <thead><tr><th>名称</th><th>提供商</th><th>延迟</th><th /></tr></thead>
            <tbody>
              {models.map(m => {
                const routed = routedSet.has(modelKey(m));
                return (
                  <tr key={modelKey(m)}>
                    <td className="mono"><b>{m.modelId}</b></td>
                    <td><span className="badge badge-provider">{m.provider}</span></td>
                    <td><DirectLatency provider={m.provider} modelId={m.modelId} /></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!routed && <button className="btn btn-xs" onClick={() => addRoute(m.modelId, m.provider, m.modelId)}>添加路由</button>}
                      {routed && <span className="badge badge-ok" style={{ marginRight: 6 }}>已路由</span>}
                      <button className="btn btn-danger btn-xs" onClick={() => removeModel(m.provider, m.modelId)}>删除</button>
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
        <div className="card-header">
          <h2>路由 ({mappings.length})</h2>
          {models.length > 0 && (
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                className="input-xs"
                placeholder="路由名称"
                value={newRouteName}
                onChange={e => setNewRouteName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddRoute(); }}
                style={{ width: 140 }}
              />
              <button className="btn btn-xs" disabled={!newRouteName.trim()} onClick={handleAddRoute}>添加</button>
            </span>
          )}
        </div>
        {mappings.length === 0 ? (
          <div className="empty"><p>暂无路由。在上方模型目录中点击「添加路由」或输入名称添加。</p></div>
        ) : (
          <table>
            <thead><tr><th>名称</th><th>模型</th><th>延迟</th><th /></tr></thead>
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
                        <option key={modelKey(c)} value={`${c.provider}|${c.modelId}`}>{c.modelId} ({c.provider})</option>
                      ))}
                    </select>
                  </td>
                  <td><Latency name={m.name} /></td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-danger btn-xs" onClick={() => removeMapping(m.name)}>删除</button>
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
  background: 'var(--surface2)', color: 'var(--text)', fontSize: 14,
  fontFamily: 'inherit', width: 140,
};

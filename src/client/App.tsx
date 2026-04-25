import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';
import { api } from './api';
import type { HealthInfo } from './api';
import { Overview } from './Overview';
import { Providers } from './Providers';
import { Routes } from './Routes';
import { Monitor } from './Monitor';

// ─── Toast system ───────────────────────────────────────────

interface ToastItem { id: number; text: string; type: 'success' | 'error' }
let toastId = 0;

interface ToastCtx {
  toast: (text: string, type?: 'success' | 'error') => void;
  confirm: (msg: string) => Promise<boolean>;
}
const ToastContext = createContext<ToastCtx>({ toast: () => {}, confirm: async () => false });
export const useToast = () => useContext(ToastContext);

function ToastContainer({ items, onRemove }: { items: ToastItem[]; onRemove: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="toast-container">
      {items.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span>{t.text}</span>
          <button className="toast-close" onClick={() => onRemove(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

// ─── Confirm dialog ─────────────────────────────────────────

function ConfirmDialog({ message, onResolve }: { message: string; onResolve: (ok: boolean) => void }) {
  return (
    <div className="confirm-overlay" onClick={e => { if (e.target === e.currentTarget) onResolve(false); }}>
      <div className="confirm-box">
        <h3>确认</h3>
        <p>{message}</p>
        <div className="modal-footer">
          <button className="btn" onClick={() => onResolve(false)}>取消</button>
          <button className="btn btn-danger" onClick={() => onResolve(true)}>确认</button>
        </div>
      </div>
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'providers', label: '提供商' },
  { id: 'routes', label: '路由' },
  { id: 'monitor', label: '监控' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// ─── App ────────────────────────────────────────────────────

export function App() {
  const [tab, setTab] = useState<TabId>('overview');
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null);

  const addToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise(resolve => setConfirmState({ message, resolve }));
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api.health());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleReload = useCallback(async () => {
    try {
      const r = await api.reload();
      addToast(`已重新加载: ${r.models} 个模型, ${r.mappings} 个映射, ${r.providers} 个提供商`);
      await refreshHealth();
    } catch (e) {
      addToast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [addToast, refreshHealth]);

  useEffect(() => { refreshHealth(); }, [refreshHealth]);

  return (
    <ToastContext.Provider value={{ toast: addToast, confirm }}>
      <ToastContainer items={toasts} onRemove={id => setToasts(prev => prev.filter(t => t.id !== id))} />
      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onResolve={ok => { confirmState.resolve(ok); setConfirmState(null); }}
        />
      )}

      <header className="header">
        <h1><span>llm</span>SimpleProxy</h1>
        <nav className="header-stats">
          {error ? (
            <span style={{ color: 'var(--red)' }}>{error}</span>
          ) : health ? (
            <>
              <span><span className="status-dot" />运行中</span>
              <span>模型: <b>{health.models}</b></span>
              <span>映射: <b>{health.mappings}</b></span>
              <span>提供商: <b>{health.providers}</b></span>
              <span>端口: <b>{health.port}</b></span>
              <button className="btn btn-xs" onClick={handleReload} style={{ marginLeft: 4 }}>重新加载</button>
            </>
          ) : (
            <span><span className="spinner" style={{ marginRight: 6 }} />连接中...</span>
          )}
        </nav>
      </header>

      <nav className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </nav>

      <main className="main">
        {tab === 'overview' && <Overview />}
        {tab === 'providers' && <Providers onRefresh={refreshHealth} />}
        {tab === 'routes' && <Routes onRefresh={refreshHealth} />}
        {tab === 'monitor' && <Monitor />}
      </main>
    </ToastContext.Provider>
  );
}

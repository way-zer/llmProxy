import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import type { HealthInfo } from './api';
import { Overview } from './Overview';
import { Providers } from './Providers';
import { Models } from './Models';
import { Mappings } from './Mappings';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'providers', label: 'Providers' },
  { id: 'models', label: 'Models' },
  { id: 'mappings', label: 'Mappings' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<TabId>('overview');
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api.health());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { refreshHealth(); }, [refreshHealth]);

  return (
    <>
      <header className="header">
        <h1><span>llm</span>Proxy</h1>
        <nav className="header-stats">
          {error ? (
            <span style={{ color: 'var(--red)' }}>{error}</span>
          ) : health ? (
            <>
              <span><span className="status-dot" />running</span>
              <span>Models: <b>{health.models}</b></span>
              <span>Mappings: <b>{health.mappings}</b></span>
              <span>Providers: <b>{health.providers}</b></span>
              <span>Port: <b>{health.port}</b></span>
            </>
          ) : (
            <span>Connecting...</span>
          )}
        </nav>
      </header>

      <nav className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === 'overview' && <Overview />}
        {tab === 'providers' && <Providers onRefresh={refreshHealth} />}
        {tab === 'models' && <Models onRefresh={refreshHealth} />}
        {tab === 'mappings' && <Mappings onRefresh={refreshHealth} />}
      </main>
    </>
  );
}

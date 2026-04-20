export function Overview() {
  return (
    <>
      <div className="card">
        <div className="card-header"><h2>Endpoints</h2></div>
        <table>
          <tbody>
            <tr><td style={{ width: 60 }}><span className="badge badge-provider">POST</span></td><td className="mono">/v1/chat/completions</td><td>OpenAI-compatible proxy</td></tr>
            <tr><td><span className="badge badge-provider">GET</span></td><td className="mono">/v1/models</td><td>List mappings + model catalog</td></tr>
            <tr><td><span className="badge badge-provider">GET</span></td><td className="mono">/api/health</td><td>Health check</td></tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="card-header"><h2>Concepts</h2></div>
        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 2 }}>
          <p><b style={{ color: 'var(--text)' }}>Models (模型)</b> — saved upstream references, like bookmarks. Created by scanning providers.</p>
          <p><b style={{ color: 'var(--text)' }}>Mappings (映射)</b> — routing table. Client name → provider/model. Quickly switchable.</p>
          <p>Client sends <code className="mono" style={{ color: 'var(--accent2)' }}>model: "my-gpt"</code> → Mapping → upstream.</p>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h2>Example</h2></div>
        <pre style={{ background: 'var(--surface2)', borderRadius: 6, padding: 16, fontSize: 12, overflowX: 'auto' }}>
          <code>{`curl http://localhost:3000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"my-gpt","messages":[{"role":"user","content":"Hi"}]}'`}</code>
        </pre>
      </div>
    </>
  );
}

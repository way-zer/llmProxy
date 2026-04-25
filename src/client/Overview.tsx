export function Overview() {
  return (
    <>
      <div className="card">
        <div className="card-header"><h2>端点</h2></div>
        <table>
          <tbody>
            <tr><td style={{ width: 60 }}><span className="badge badge-provider">POST</span></td><td className="mono">/v1/chat/completions</td><td>OpenAI 兼容代理</td></tr>
            <tr><td><span className="badge badge-provider">GET</span></td><td className="mono">/v1/models</td><td>列出映射与模型目录</td></tr>
            <tr><td><span className="badge badge-provider">GET</span></td><td className="mono">/api/health</td><td>健康检查</td></tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="card-header"><h2>概念</h2></div>
        <div style={{ fontSize: 15, color: 'var(--text2)', lineHeight: 2 }}>
          <p><b style={{ color: 'var(--text)' }}>提供商</b> — 上游 API 端点。扫描后可发现可用模型。</p>
          <p><b style={{ color: 'var(--text)' }}>路由</b> — 路由表。每条记录将客户端请求的模型名映射到上游提供商 + 模型。提供商和模型可随时切换。</p>
          <p>在扫描结果中点击 ★ 将模型加入目录并自动创建路由。</p>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h2>示例</h2></div>
        <pre style={{ background: 'var(--surface2)', borderRadius: 6, padding: 16, fontSize: 14, overflowX: 'auto' }}>
          <code>{`curl http://localhost:3000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"my-gpt","messages":[{"role":"user","content":"Hi"}]}'`}</code>
        </pre>
      </div>
    </>
  );
}

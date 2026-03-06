export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>AI Trader</h1>
      <p>API-only paper trading bot. Endpoints:</p>
      <ul>
        <li><a href="/api/health">GET /api/health</a></li>
        <li><a href="/api/alerts">GET /api/alerts</a></li>
        <li><a href="/api/trades">GET /api/trades</a></li>
        <li><a href="/api/stats">GET /api/stats</a></li>
      </ul>
      <p>POST /api/tv — webhook (TradingView)</p>
    </main>
  );
}

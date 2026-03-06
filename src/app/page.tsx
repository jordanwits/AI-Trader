"use client";

import { useState, useEffect, useCallback } from "react";

type Health = { ok: boolean; ts: string } | null;
type Stats = { today: { trades_count: number; daily_loss_approx: number } } | null;
type Alert = {
  id: string;
  received_at: string;
  alert_key: string;
  ticker: string | null;
  action: string | null;
  price: number | null;
  stop: number | null;
  timeframe: string | null;
  parsed: unknown;
};
type Trade = {
  id: string;
  decision_id: string | null;
  placed_at: string;
  status: string;
  qty: number | null;
  side: string | null;
  symbol: string | null;
  alpaca_order_id: string | null;
  error: string | null;
};

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Home() {
  const [health, setHealth] = useState<Health>(null);
  const [stats, setStats] = useState<Stats>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [hRes, sRes, aRes, tRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/stats"),
        fetch("/api/alerts?limit=15"),
        fetch("/api/trades?limit=15"),
      ]);

      const [h, s, a, t] = await Promise.all([
        hRes.json().catch(() => null),
        sRes.json().catch(() => null),
        aRes.json().catch(() => null),
        tRes.json().catch(() => null),
      ]);

      setHealth(h?.ok !== undefined ? h : null);
      setStats(s?.today !== undefined ? s : null);
      setAlerts(Array.isArray(a?.alerts) ? a.alerts : []);
      setTrades(Array.isArray(t?.trades) ? t.trades : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 30_000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  const isHealthy = health?.ok === true;

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "2rem",
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "1.75rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              background: "linear-gradient(135deg, #00d4aa 0%, #00a884 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            AI Trader
          </h1>
          <p
            style={{
              margin: "0.25rem 0 0",
              fontSize: "0.875rem",
              color: "var(--text-secondary)",
            }}
          >
            Paper trading bot · Status & health dashboard
          </p>
        </div>
        <button className="refresh-btn" onClick={fetchAll} disabled={loading}>
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </header>

      {error && (
        <div
          style={{
            padding: "1rem 1.5rem",
            background: "rgba(248, 81, 73, 0.15)",
            border: "1px solid var(--accent-red)",
            borderRadius: 12,
            color: "var(--accent-red)",
            marginBottom: "1.5rem",
          }}
        >
          {error}
        </div>
      )}

      <section className="dashboard-grid" style={{ marginBottom: "2rem" }}>
        <div className="card">
          <div className="card-header">
            <span>System Health</span>
            <span
              className={`status-dot ${isHealthy ? "healthy" : "error"}`}
              title={isHealthy ? "Operational" : "Degraded"}
            />
          </div>
          {loading && !health ? (
            <div className="loading-shimmer" style={{ height: 48 }} />
          ) : (
            <div>
              <div style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: 0.25 }}>
                {isHealthy ? "Operational" : "Degraded"}
              </div>
              <div className="mono" style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                {health?.ts ? formatDate(health.ts) : "—"}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">Today&apos;s Stats</div>
          {loading && !stats ? (
            <div className="loading-shimmer" style={{ height: 48 }} />
          ) : (
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <div>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: 0.25 }}>
                  Trades
                </div>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--accent)" }}>
                  {stats?.today?.trades_count ?? "—"}
                </div>
              </div>
              <div>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: 0.25 }}>
                  Daily P&L (approx)
                </div>
                <div
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    color:
                      (stats?.today?.daily_loss_approx ?? 0) >= 0
                        ? "var(--accent)"
                        : "var(--accent-red)",
                  }}
                >
                  {(stats?.today?.daily_loss_approx ?? 0) >= 0 ? "+" : ""}
                  ${stats?.today?.daily_loss_approx ?? 0}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">Webhook</div>
          <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            POST /api/tv
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 0.5 }}>
            TradingView alerts → paper orders
          </div>
        </div>
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gap: "1.5rem",
        }}
      >
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">Recent Trades</div>
          <div className="table-wrapper">
            {loading && !trades ? (
              <div className="loading-shimmer" style={{ height: 200 }} />
            ) : !trades?.length ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
                No trades yet
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Status</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id}>
                      <td className="mono" title={t.placed_at}>
                        {formatTime(t.placed_at)}
                      </td>
                      <td className="mono">{t.symbol ?? "—"}</td>
                      <td className={t.side === "buy" ? "side-buy" : "side-sell"}>
                        {t.side ?? "—"}
                      </td>
                      <td className="mono">{t.qty ?? "—"}</td>
                      <td>
                        <span className={`badge ${t.status}`}>{t.status}</span>
                      </td>
                      <td
                        style={{
                          maxWidth: 120,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: t.error ? "var(--accent-red)" : "var(--text-secondary)",
                        }}
                        title={t.error ?? undefined}
                      >
                        {t.error ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">Recent Alerts</div>
          <div className="table-wrapper">
            {loading && alerts === null ? (
              <div className="loading-shimmer" style={{ height: 200 }} />
            ) : !alerts?.length ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
                No alerts received yet
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Ticker</th>
                    <th>Action</th>
                    <th>Price</th>
                    <th>Stop</th>
                    <th>TF</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.id}>
                      <td className="mono" title={a.received_at}>
                        {formatTime(a.received_at)}
                      </td>
                      <td className="mono">{a.ticker ?? "—"}</td>
                      <td>{a.action ?? "—"}</td>
                      <td className="mono">{a.price != null ? a.price : "—"}</td>
                      <td className="mono">{a.stop != null ? a.stop : "—"}</td>
                      <td>{a.timeframe ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

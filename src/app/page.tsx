"use client";

import { useState, useEffect, useCallback } from "react";

type Health = { ok: boolean; ts: string } | null;
type Stats = { today: { trades_count: number; daily_loss_approx: number } } | null;
type PortfolioAccount = {
  cash: string;
  buying_power: string;
  equity: string;
  portfolio_value: string;
};
type PortfolioHistory = {
  timestamp: number[];
  equity: number[];
  profit_loss?: number[];
  profit_loss_pct?: number[];
  base_value: number;
  timeframe: string;
};
type Portfolio = { account: PortfolioAccount; history: PortfolioHistory } | null;
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
type Decision = {
  id: string;
  decided_at: string;
  approve: boolean;
  reason: string | null;
  blocked_reason: string | null;
  alert: { ticker: string | null; received_at: string; action: string | null } | null;
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
type AlpacaOrder = {
  id: string;
  symbol: string;
  qty: string;
  side: string;
  status: string;
  filled_at: string | null;
  submitted_at: string;
  filled_avg_price: string | null;
};
type AlpacaPosition = {
  symbol: string;
  qty: string;
  side: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  avg_entry_price: string;
};

function PortfolioChart({ history }: { history: PortfolioHistory }) {
  const { equity } = history;
  if (!equity?.length) return null;
  const min = Math.min(...equity);
  const max = Math.max(...equity);
  const range = max - min || 1;
  const padding = { top: 8, right: 8, bottom: 8, left: 8 };
  const w = 600;
  const h = 184;
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;
  const bottomY = padding.top + chartH;
  const coords = equity.map((eq, i) => {
    const x = padding.left + (i / (equity.length - 1 || 1)) * chartW;
    const y = padding.top + chartH - ((eq - min) / range) * chartH;
    return { x, y };
  });
  const linePoints = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const areaPoints = [
    `${padding.left},${bottomY}`,
    ...coords.map((c) => `${c.x},${c.y}`),
    `${padding.left + chartW},${bottomY}`,
  ].join(" ");
  return (
    <svg className="portfolio-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="portfolioGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon className="area" points={areaPoints} />
      <polyline className="line" points={linePoints} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

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
  const [portfolio, setPortfolio] = useState<Portfolio>(null);
  const [portfolioPeriod, setPortfolioPeriod] = useState<"1D" | "1M" | "1A">("1M");
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [alpacaOrders, setAlpacaOrders] = useState<AlpacaOrder[] | null>(null);
  const [positions, setPositions] = useState<AlpacaPosition[] | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [accountDebug, setAccountDebug] = useState<{
    account: { equity: string; portfolio_value: string; cash: string; buying_power: string };
    api_config?: { trading_url: string };
    positions?: Array<{
      symbol: string;
      market_value: string;
        unrealized_pl: string;
        current_price: string;
        avg_entry_price: string;
        cost_basis: string;
        qty: string;
    }>;
    reconciliation?: {
      cash: number;
      sum_positions_market_value: number;
      computed_equity_cash_plus_positions: string;
      account_equity_from_api: number;
      difference: string;
      note: string;
    };
    api_source: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPortfolio = useCallback(async () => {
    const timeframe = portfolioPeriod === "1D" ? "15Min" : "1D";
    const res = await fetch(`/api/portfolio?period=${portfolioPeriod}&timeframe=${timeframe}`);
    const data = await res.json().catch(() => null);
    if (data?.account && data?.history) setPortfolio(data);
  }, [portfolioPeriod]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const timeframe = portfolioPeriod === "1D" ? "15Min" : "1D";
      const [hRes, sRes, pRes, aRes, dRes, tRes, alpRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/stats"),
        fetch(`/api/portfolio?period=${portfolioPeriod}&timeframe=${timeframe}`),
        fetch("/api/alerts?limit=15"),
        fetch("/api/decisions?limit=15"),
        fetch("/api/trades?limit=15"),
        fetch("/api/alpaca-activity"),
      ]);

      const [h, s, p, a, d, t, alp] = await Promise.all([
        hRes.json().catch(() => null),
        sRes.json().catch(() => null),
        pRes.json().catch(() => null),
        aRes.json().catch(() => null),
        dRes.json().catch(() => null),
        tRes.json().catch(() => null),
        alpRes.json().catch(() => null),
      ]);

      setHealth(h?.ok !== undefined ? h : null);
      setStats(s?.today !== undefined ? s : null);
      if (p?.account && p?.history) setPortfolio(p);
      setAlerts(Array.isArray(a?.alerts) ? a.alerts : []);
      setDecisions(Array.isArray(d?.decisions) ? d.decisions : []);
      setTrades(Array.isArray(t?.trades) ? t.trades : []);
      setAlpacaOrders(Array.isArray(alp?.orders) ? alp.orders : []);
      setPositions(Array.isArray(alp?.positions) ? alp.positions : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [portfolioPeriod]);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchAll]);

  useEffect(() => {
    if (portfolioPeriod) fetchPortfolio();
  }, [portfolioPeriod, fetchPortfolio]);

  useEffect(() => {
    if (!debugOpen) {
      setAccountDebug(null);
      return;
    }
    fetch("/api/account-debug")
      .then((r) => r.json())
      .then((d) => {
          if (!d.error && d.account)
            setAccountDebug({
              account: d.account,
              api_config: d.api_config,
              positions: d.positions,
              reconciliation: d.reconciliation,
              api_source: d.api_source,
            });
      })
      .catch(() => {});
  }, [debugOpen]);

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

      <section className="card" style={{ marginBottom: "2rem" }}>
        <div className="card-header">
          <span>Your Portfolio</span>
          <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
            {portfolio?.account ? "Live" : "—"}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2rem", alignItems: "flex-start" }}>
          <div>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: 0.25 }}>
              Portfolio Value
            </div>
            {loading && !portfolio ? (
              <div className="loading-shimmer" style={{ height: 36, width: 140 }} />
            ) : (
              <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>
                $
                {portfolio?.account
                  ? (() => {
                      const cash = Number(portfolio.account.cash);
                      const positionsValue =
                        positions?.reduce((sum, p) => sum + Number(p.market_value), 0) ?? 0;
                      const reconciled = cash + positionsValue;
                      return reconciled.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      });
                    })()
                  : "—"}
              </div>
            )}
            {(() => {
              const pl = portfolio?.history?.profit_loss?.slice(-1)[0];
              if (pl == null || !Number.isFinite(pl)) return null;
              const pct = (portfolio?.history?.profit_loss_pct?.slice(-1)[0] ?? 0) * 100;
              return (
                <div
                  style={{
                    fontSize: "0.9rem",
                    marginTop: 0.25,
                    color: pl >= 0 ? "var(--accent)" : "var(--accent-red)",
                  }}
                >
                  {pl >= 0 ? "+" : ""}${pl.toFixed(2)} ({pct.toFixed(2)}%)
                </div>
              );
            })()}
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: 0.25 }}>
              Buying Power
            </div>
            <div className="mono" style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              {portfolio?.account
                ? `$${Number(portfolio.account.buying_power).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : "—"}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: 0.25 }}>
              Cash
            </div>
            <div className="mono" style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              {portfolio?.account
                ? `$${Number(portfolio.account.cash).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : "—"}
            </div>
          </div>
        </div>
        <div style={{ marginTop: "1rem" }}>
          <button
            type="button"
            onClick={() => setDebugOpen((o) => !o)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              fontSize: "0.75rem",
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
            }}
          >
            {debugOpen ? "Hide" : "Compare with Alpaca"} – troubleshoot portfolio mismatch
          </button>
          {debugOpen && (
            accountDebug ? (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "var(--bg-secondary)",
                borderRadius: 6,
                fontSize: "0.8rem",
                fontFamily: "monospace",
              }}
            >
              <div style={{ marginBottom: "0.5rem", color: "var(--text-secondary)" }}>
                Raw API response (our dashboard uses equity || portfolio_value)
              </div>
              <div>equity: {accountDebug.account.equity}</div>
              <div>portfolio_value: {accountDebug.account.portfolio_value}</div>
              <div>cash: {accountDebug.account.cash}</div>
              <div>buying_power: {accountDebug.account.buying_power}</div>
              {accountDebug.positions?.length ? (
                <>
                  <div style={{ marginTop: "0.75rem", marginBottom: "0.25rem", color: "var(--text-secondary)" }}>
                    Positions (from /v2/positions) – compare market_value, unrealized_pl with Alpaca
                  </div>
                  {accountDebug.positions.map((p) => (
                    <div key={p.symbol} style={{ marginLeft: "0.5rem" }}>
                      {p.symbol}: market_value={p.market_value} unrealized_pl={p.unrealized_pl} current_price={p.current_price} cost_basis={p.cost_basis}
                    </div>
                  ))}
                  {accountDebug.api_config && (
                    <div style={{ marginTop: "0.5rem", color: "var(--text-secondary)" }}>
                      Trading: {accountDebug.api_config.trading_url}
                    </div>
                  )}
                </>
              ) : null}
              {accountDebug.reconciliation && (
                <>
                  <div style={{ marginTop: "0.75rem", marginBottom: "0.25rem", color: "var(--text-secondary)" }}>
                    Reconciliation
                  </div>
                  <div>cash + sum(positions.market_value) = {accountDebug.reconciliation.computed_equity_cash_plus_positions}</div>
                  <div>account.equity = {accountDebug.reconciliation.account_equity_from_api}</div>
                  <div
                    style={{
                      color: Math.abs(Number(accountDebug.reconciliation.difference)) > 0.01 ? "var(--accent-red)" : "var(--accent)",
                    }}
                  >
                    difference: {accountDebug.reconciliation.difference}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                    {accountDebug.reconciliation.note}
                  </div>
                </>
              )}
              <div style={{ marginTop: "0.5rem", color: "var(--accent)" }}>{accountDebug.api_source}</div>
            </div>
            ) : (
              <div style={{ marginTop: "0.75rem", color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                Loading debug data…
              </div>
            )
          )}
        </div>
        <div style={{ marginTop: "1.5rem" }}>
          <div className="period-tabs">
            {(["1D", "1M", "1A"] as const).map((p) => (
              <button
                key={p}
                className={portfolioPeriod === p ? "active" : ""}
                onClick={() => setPortfolioPeriod(p)}
              >
                {p === "1A" ? "1Y" : p}
              </button>
            ))}
          </div>
          <div className="portfolio-chart">
            {portfolio?.history?.equity?.length ? (
              <PortfolioChart history={portfolio.history} />
            ) : loading && !portfolio ? (
              <div className="loading-shimmer" style={{ width: "100%", height: "100%", borderRadius: 8 }} />
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "var(--text-secondary)",
                  fontSize: "0.9rem",
                }}
              >
                No chart data
              </div>
            )}
          </div>
        </div>
      </section>

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
        {positions && positions.length > 0 && (
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="card-header">Open Positions</div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Avg Entry</th>
                    <th>Current</th>
                    <th>Total P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => (
                    <tr key={pos.symbol}>
                      <td className="mono">{pos.symbol}</td>
                      <td className={pos.side === "long" ? "side-buy" : "side-sell"}>{pos.side}</td>
                      <td className="mono">{pos.qty}</td>
                      <td className="mono">${Number(pos.avg_entry_price).toFixed(2)}</td>
                      <td className="mono">${(() => {
                        const n = Number(pos.current_price);
                        return Number.isFinite(n) ? n.toFixed(3).replace(/\.?0+$/, "") : pos.current_price;
                      })()}</td>
                      <td
                        style={{
                          color: Number(pos.unrealized_pl) >= 0 ? "var(--accent)" : "var(--accent-red)",
                          fontWeight: 600,
                        }}
                      >
                        {Number(pos.unrealized_pl) >= 0 ? "+" : ""}$
                        {Number(pos.unrealized_pl).toFixed(2)} (
                        {(Number(pos.unrealized_plpc) * 100).toFixed(2)}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">Recent Orders (Alpaca)</div>
          <div className="table-wrapper">
            {loading && alpacaOrders === null ? (
              <div className="loading-shimmer" style={{ height: 200 }} />
            ) : !alpacaOrders?.length ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
                No orders yet
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
                    <th>Avg Price</th>
                  </tr>
                </thead>
                <tbody>
                  {alpacaOrders.map((o) => (
                    <tr key={o.id}>
                      <td className="mono" title={o.filled_at ?? o.submitted_at}>
                        {formatTime(o.filled_at ?? o.submitted_at)}
                      </td>
                      <td className="mono">{o.symbol}</td>
                      <td className={o.side === "buy" ? "side-buy" : "side-sell"}>{o.side}</td>
                      <td className="mono">{o.qty}</td>
                      <td>
                        <span className={`badge ${o.status}`}>{o.status}</span>
                      </td>
                      <td className="mono">
                        {o.filled_avg_price ? `$${Number(o.filled_avg_price).toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">Recent Decisions (why alerts did/didn&apos;t trade)</div>
          <div className="table-wrapper">
            {loading && decisions === null ? (
              <div className="loading-shimmer" style={{ height: 120 }} />
            ) : !decisions?.length ? (
              <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-secondary)" }}>
                No decisions yet
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Ticker</th>
                    <th>Action</th>
                    <th>Result</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id}>
                      <td className="mono" title={d.decided_at}>
                        {formatTime(d.decided_at)}
                      </td>
                      <td className="mono">{d.alert?.ticker ?? "—"}</td>
                      <td>{d.alert?.action ?? "—"}</td>
                      <td>
                        <span className={`badge ${d.approve ? "filled" : "blocked"}`}>
                          {d.approve ? "Approved" : "Blocked"}
                        </span>
                      </td>
                      <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={d.reason ?? d.blocked_reason ?? ""}>
                        {d.reason ?? d.blocked_reason ?? "—"}
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

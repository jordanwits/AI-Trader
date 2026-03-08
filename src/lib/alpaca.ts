import { env } from "./env";

async function alpacaFetch(
  method: string,
  path: string,
  body?: object
): Promise<{ id?: string; [k: string]: unknown }> {
  const url = `${env.ALPACA_BASE_URL.replace(/\/$/, "")}${path}`;
  const options: RequestInit = {
    method,
    headers: {
      "APCA-API-KEY-ID": env.ALPACA_KEY,
      "APCA-API-SECRET-KEY": env.ALPACA_SECRET,
      "Content-Type": "application/json",
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const errMsg = (data.message as string) ?? data.error ?? res.statusText;
    throw new Error(`Alpaca error ${res.status}: ${errMsg}`);
  }

  return data as { id?: string; [k: string]: unknown };
}

export type PlaceOrderResult = {
  alpaca_order_id: string;
  raw: Record<string, unknown>;
};

export async function placeMarketOrder(
  symbol: string,
  qty: number,
  side: "buy" | "sell"
): Promise<PlaceOrderResult> {
  const body = {
    symbol,
    qty: Math.floor(qty),
    side,
    type: "market",
    time_in_force: "day",
  };

  const raw = await alpacaFetch("POST", "/v2/orders", body);
  const id = raw.id as string | undefined;
  if (!id) throw new Error("Alpaca returned no order id");

  return { alpaca_order_id: id, raw: raw as Record<string, unknown> };
}

/** Rounds stop price to appropriate precision for Alpaca (avoids 0 for micro-cap crypto). */
export function roundStopPrice(stopPrice: number): number {
  if (stopPrice < 0.0001) return Math.round(stopPrice * 1e8) / 1e8;
  if (stopPrice < 0.01) return Math.round(stopPrice * 1e6) / 1e6;
  if (stopPrice < 1) return Math.round(stopPrice * 1e4) / 1e4;
  if (stopPrice < 100) return Math.round(stopPrice * 1e3) / 1e3;
  return Math.round(stopPrice * 100) / 100;
}

/** Place market order with a bracket stop-loss and take-profit. Alpaca requires both for bracket orders. */
export async function placeMarketOrderWithStopLoss(
  symbol: string,
  qty: number,
  side: "buy" | "sell",
  stopPrice: number,
  takeProfitPrice: number,
  entryPrice: number
): Promise<PlaceOrderResult> {
  // Alpaca requires stop/tp at least $0.01 away from entry.
  // For micro-priced assets (<$1), use proportional min distance instead.
  const minDistance = entryPrice < 1 ? entryPrice * 0.02 : 0.01;

  let sl = stopPrice;
  if (side === "buy" && sl > entryPrice - minDistance) {
    sl = entryPrice - minDistance;
  } else if (side === "sell" && sl < entryPrice + minDistance) {
    sl = entryPrice + minDistance;
  }
  const slRounded = roundStopPrice(sl);

  let tp = takeProfitPrice;
  if (side === "buy" && tp < entryPrice + minDistance) {
    tp = entryPrice + minDistance;
  } else if (side === "sell" && tp > entryPrice - minDistance) {
    tp = entryPrice - minDistance;
  }
  const tpRounded = roundStopPrice(tp);

  const body = {
    symbol,
    qty: Math.floor(qty),
    side,
    type: "market",
    time_in_force: "day",
    order_class: "bracket",
    stop_loss: { stop_price: String(slRounded) },
    take_profit: { limit_price: String(tpRounded) },
  };

  const raw = await alpacaFetch("POST", "/v2/orders", body);
  const id = raw.id as string | undefined;
  if (!id) throw new Error("Alpaca returned no order id");

  return { alpaca_order_id: id, raw: raw as Record<string, unknown> };
}

export type AlpacaAccount = {
  id: string;
  account_number: string;
  cash: string;
  buying_power: string;
  equity: string;
  last_equity: string;
  portfolio_value: string;
};

export async function getAccount(): Promise<AlpacaAccount> {
  const data = await alpacaFetch("GET", "/v2/account");
  return {
    id: data.id as string,
    account_number: data.account_number as string,
    cash: data.cash as string,
    buying_power: data.buying_power as string,
    equity: data.equity as string,
    last_equity: data.last_equity as string,
    portfolio_value: data.portfolio_value as string,
  };
}

export type PortfolioHistory = {
  timestamp: number[];
  equity: number[];
  profit_loss: number[];
  profit_loss_pct: number[];
  base_value: number;
  timeframe: string;
};

export async function getPortfolioHistory(params: {
  period?: "1D" | "1W" | "1M" | "1A";
  timeframe?: "1Min" | "5Min" | "15Min" | "1H" | "1D";
} = {}): Promise<PortfolioHistory> {
  const sp = new URLSearchParams();
  if (params.period) sp.set("period", params.period);
  if (params.timeframe) sp.set("timeframe", params.timeframe);
  const qs = sp.toString();
  const path = `/v2/account/portfolio/history${qs ? `?${qs}` : ""}`;
  const data = (await alpacaFetch("GET", path)) as PortfolioHistory;
  return data;
}

export type AlpacaOrder = {
  id: string;
  symbol: string;
  qty: string;
  side: string;
  type: string;
  status: string;
  filled_at: string | null;
  submitted_at: string;
  filled_avg_price: string | null;
};

export async function getOrders(params?: {
  status?: "open" | "closed" | "all";
  limit?: number;
}): Promise<AlpacaOrder[]> {
  const sp = new URLSearchParams();
  sp.set("status", params?.status ?? "all");
  sp.set("limit", String(params?.limit ?? 50));
  sp.set("direction", "desc");
  const path = `/v2/orders?${sp.toString()}`;
  const data = (await alpacaFetch("GET", path)) as unknown as AlpacaOrder[];
  return Array.isArray(data) ? data : [];
}

export type AlpacaPosition = {
  symbol: string;
  qty: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  avg_entry_price: string;
};

export async function getPositions(): Promise<AlpacaPosition[]> {
  const data = (await alpacaFetch("GET", "/v2/positions")) as unknown as AlpacaPosition[];
  return Array.isArray(data) ? data : [];
}

function getSymbolCandidates(symbol: string): string[] {
  const clean = symbol.replace("/", "").toUpperCase();
  const candidates = [clean];
  if (!clean.endsWith("USD") && !clean.endsWith("USDT") && !clean.endsWith("USDC")) {
    candidates.push(clean + "USD");
  }
  return candidates;
}

/** Resolves ticker to Alpaca symbol format (e.g. DOGE -> DOGEUSD). Returns null if not tradeable. */
export async function resolveAlpacaSymbol(symbol: string): Promise<string | null> {
  for (const sym of getSymbolCandidates(symbol)) {
    try {
      const data = (await alpacaFetch("GET", `/v2/assets/${encodeURIComponent(sym)}`)) as { tradable?: boolean };
      if (data?.tradable === true) return sym;
    } catch {
      continue;
    }
  }
  return null;
}

/** Returns true if symbol is tradeable on Alpaca. Skips AI when false to save tokens. */
export async function isSymbolTradeable(symbol: string): Promise<boolean> {
  return (await resolveAlpacaSymbol(symbol)) !== null;
}

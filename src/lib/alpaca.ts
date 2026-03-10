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
  side: "buy" | "sell",
  assetClass: "crypto" | "us_equity" | null = "us_equity"
): Promise<PlaceOrderResult> {
  const tif = assetClass === "crypto" ? "ioc" : "day";
  const body = {
    symbol,
    qty: assetClass === "crypto" ? qty : Math.floor(qty),
    side,
    type: "market",
    time_in_force: tif,
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

/** Enforce min distance from entry for stop/tp. Alpaca requires $0.01 for bracket; we use proportional for crypto too. */
function clampStopTp(
  side: "buy" | "sell",
  stopPrice: number,
  takeProfitPrice: number,
  entryPrice: number
): { sl: number; tp: number } {
  let minDistance: number;
  if (entryPrice < 0.1) minDistance = Math.max(0.0001, entryPrice * 0.02);
  else if (entryPrice < 1) minDistance = Math.max(0.01, entryPrice * 0.02);
  else if (entryPrice < 10) minDistance = Math.max(0.01, entryPrice * 0.015);
  else minDistance = Math.max(0.01, entryPrice * 0.005);

  let sl = stopPrice;
  if (side === "buy" && sl > entryPrice - minDistance) sl = entryPrice - minDistance;
  else if (side === "sell" && sl < entryPrice + minDistance) sl = entryPrice + minDistance;

  let tp = takeProfitPrice;
  if (side === "buy" && tp < entryPrice + minDistance) tp = entryPrice + minDistance;
  else if (side === "sell" && tp > entryPrice - minDistance) tp = entryPrice - minDistance;

  return { sl, tp };
}

/**
 * Place market order with SL and TP. Both crypto and equities use the same flow:
 * 1. Place market order
 * 2. Wait for fill
 * 3. Recalculate SL/TP from actual fill price (not alert price)
 * 4. Place exit orders (crypto: separate orders; equities: OCO)
 * This ensures take profit and stop loss are based on actual buy-in price.
 */
export async function placeMarketOrderWithStopLoss(
  symbol: string,
  qty: number,
  side: "buy" | "sell",
  stopPrice: number,
  takeProfitPrice: number,
  signalEntryPrice: number
): Promise<PlaceOrderResult> {
  const assetClass = await getAssetClass(symbol);
  const qtyForOrder = assetClass === "crypto" ? qty : Math.floor(qty);

  if (assetClass === "crypto") {
    return placeCryptoOrderWithSlTp(symbol, qtyForOrder, side, stopPrice, takeProfitPrice, signalEntryPrice);
  }

  return placeEquityOrderWithSlTp(symbol, qtyForOrder, side, stopPrice, takeProfitPrice, signalEntryPrice);
}

/** Equity: market order, poll for fill, then place OCO (SL + TP) based on actual fill price. */
async function placeEquityOrderWithSlTp(
  symbol: string,
  qty: number,
  side: "buy" | "sell",
  stopPrice: number,
  takeProfitPrice: number,
  signalEntryPrice: number
): Promise<PlaceOrderResult> {
  const marketBody = {
    symbol,
    qty,
    side,
    type: "market",
    time_in_force: "day",
  };

  const raw = await alpacaFetch("POST", "/v2/orders", marketBody);
  const orderId = raw.id as string | undefined;
  if (!orderId) throw new Error("Alpaca returned no order id");

  let fill: FillResult | null = await waitForOrderFill(orderId, 30_000);
  if (fill == null) {
    const lastCheck = await getOrder(orderId);
    fill = extractFillFromOrder(lastCheck);
    if (fill == null) {
      throw new Error("Equity market order did not fill within 30 seconds");
    }
  }

  const { price: filledPrice, filledQty } = fill;

  if (side === "buy") {
    // Long: SL below entry, TP above. Close with sell OCO.
    const stopDistance = signalEntryPrice - stopPrice;
    const tpDistance = takeProfitPrice - signalEntryPrice;
    const slFromFill = filledPrice - stopDistance;
    const tpFromFill = filledPrice + tpDistance;
    const { sl, tp } = clampStopTp("buy", slFromFill, tpFromFill, filledPrice);
    const slRounded = roundStopPrice(sl);
    const tpRounded = roundStopPrice(tp);
    const slLimit = roundStopPrice(Math.min(slRounded, slRounded * 0.98));

    await alpacaFetch("POST", "/v2/orders", {
      symbol,
      qty: Math.floor(filledQty),
      side: "sell",
      type: "limit",
      limit_price: String(tpRounded),
      time_in_force: "gtc",
      order_class: "oco",
      take_profit: { limit_price: String(tpRounded) },
      stop_loss: { stop_price: String(slRounded), limit_price: String(slLimit) },
    });
  } else {
    // Short: SL above entry, TP below. Close with buy OCO (buy to cover).
    const stopDistance = stopPrice - signalEntryPrice;
    const tpDistance = signalEntryPrice - takeProfitPrice;
    const slFromFill = filledPrice + stopDistance;
    const tpFromFill = filledPrice - tpDistance;
    const { sl, tp } = clampStopTp("sell", slFromFill, tpFromFill, filledPrice);
    const slRounded = roundStopPrice(sl);
    const tpRounded = roundStopPrice(tp);
    const slLimit = roundStopPrice(Math.max(slRounded, slRounded * 1.02));

    await alpacaFetch("POST", "/v2/orders", {
      symbol,
      qty: Math.floor(filledQty),
      side: "buy",
      type: "limit",
      limit_price: String(tpRounded),
      time_in_force: "gtc",
      order_class: "oco",
      take_profit: { limit_price: String(tpRounded) },
      stop_loss: { stop_price: String(slRounded), limit_price: String(slLimit) },
    });
  }

  return { alpaca_order_id: orderId, raw: raw as Record<string, unknown> };
}

type FillResult = { price: number; filledQty: number };

function extractFillFromOrder(order: AlpacaOrder | null): FillResult | null {
  if (!order?.filled_avg_price) return null;
  const price = parseFloat(order.filled_avg_price);
  const filledQty = parseFloat(order.filled_qty ?? order.qty ?? "0");
  if (!Number.isFinite(price) || filledQty < 1e-10) return null;
  const isFilled =
    order.status === "filled" ||
    order.status === "partially_filled" ||
    (order.status === "canceled" && filledQty > 0);
  return isFilled ? { price, filledQty } : null;
}

/** Crypto: market order, poll for fill, then place SL and TP. Handles partial fills (IOC). Recalculates SL/TP from actual fill. SELL = close long only (no SL/TP). */
async function placeCryptoOrderWithSlTp(
  symbol: string,
  qty: number,
  side: "buy" | "sell",
  stopPrice: number,
  takeProfitPrice: number,
  signalEntryPrice: number
): Promise<PlaceOrderResult> {
  const tif = "ioc";
  const marketBody = {
    symbol,
    qty,
    side,
    type: "market",
    time_in_force: tif,
  };

  const raw = await alpacaFetch("POST", "/v2/orders", marketBody);
  const orderId = raw.id as string | undefined;
  if (!orderId) throw new Error("Alpaca returned no order id");

  let fill: FillResult | null = await waitForOrderFill(orderId, 30_000);
  if (fill == null) {
    const lastCheck = await getOrder(orderId);
    fill = extractFillFromOrder(lastCheck);
    if (fill == null) {
      throw new Error("Crypto market order did not fill within 30 seconds");
    }
  }

  if (side === "sell") {
    return { alpaca_order_id: orderId, raw: raw as Record<string, unknown> };
  }

  const { price: filledPrice, filledQty } = fill;
  const stopDistance = signalEntryPrice - stopPrice;
  const tpDistance = takeProfitPrice - signalEntryPrice;
  const slFromFill = filledPrice - stopDistance;
  const tpFromFill = filledPrice + tpDistance;
  const { sl, tp } = clampStopTp("buy", slFromFill, tpFromFill, filledPrice);
  const slRounded = roundStopPrice(sl);
  const tpRounded = roundStopPrice(tp);

  const gtc = "gtc";
  const exitSide = "sell";
  // Stop loss: use limit 2% below stop so we get filled when stop triggers (price can gap down)
  const slLimit = roundStopPrice(Math.min(slRounded, slRounded * 0.98));
  await alpacaFetch("POST", "/v2/orders", {
    symbol,
    qty: filledQty,
    side: exitSide,
    type: "stop_limit",
    time_in_force: gtc,
    stop_price: String(slRounded),
    limit_price: String(slLimit),
  });
  await alpacaFetch("POST", "/v2/orders", {
    symbol,
    qty: filledQty,
    side: exitSide,
    type: "limit",
    time_in_force: gtc,
    limit_price: String(tpRounded),
  });

  return { alpaca_order_id: orderId, raw: raw as Record<string, unknown> };
}

async function waitForOrderFill(orderId: string, timeoutMs: number): Promise<FillResult | null> {
  const start = Date.now();
  const pollMs = 500;

  while (Date.now() - start < timeoutMs) {
    const order = await getOrder(orderId);
    const fill = extractFillFromOrder(order);
    if (fill) return fill;
    if (order && ["canceled", "rejected", "expired"].includes(order.status)) {
      const partialFill = extractFillFromOrder(order);
      if (partialFill) return partialFill;
      return null;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
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
  filled_qty?: string;
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
  symbols?: string[];
}): Promise<AlpacaOrder[]> {
  const sp = new URLSearchParams();
  sp.set("status", params?.status ?? "all");
  sp.set("limit", String(params?.limit ?? 50));
  sp.set("direction", "desc");
  if (params?.symbols?.length) sp.set("symbols", params.symbols.join(","));
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

/** Returns asset class for a symbol already in Alpaca format. Used to branch crypto vs equity order flow. */
export async function getAssetClass(symbol: string): Promise<"crypto" | "us_equity" | null> {
  try {
    const data = (await alpacaFetch("GET", `/v2/assets/${encodeURIComponent(symbol)}`)) as { class?: string; asset_class?: string; tradable?: boolean };
    if (data?.tradable !== true) return null;
    const cls = data.class ?? data.asset_class;
    if (cls === "crypto") return "crypto";
    if (cls === "us_equity") return "us_equity";
    return null;
  } catch {
    return null;
  }
}

/** Fetches a single order by ID. */
export async function getOrder(orderId: string): Promise<AlpacaOrder | null> {
  try {
    const data = (await alpacaFetch("GET", `/v2/orders/${encodeURIComponent(orderId)}`)) as AlpacaOrder;
    return data;
  } catch {
    return null;
  }
}

/** Cancels an open order. */
export async function cancelOrder(orderId: string): Promise<boolean> {
  try {
    await alpacaFetch("DELETE", `/v2/orders/${encodeURIComponent(orderId)}`);
    return true;
  } catch {
    return false;
  }
}

/** Returns true if symbol is tradeable on Alpaca. Skips AI when false to save tokens. */
export async function isSymbolTradeable(symbol: string): Promise<boolean> {
  return (await resolveAlpacaSymbol(symbol)) !== null;
}

export type AlpacaClock = {
  timestamp: string; // RFC-3339
  is_open: boolean;
  next_open: string;
  next_close: string;
};

/** Get market clock. Used for equity market hours (crypto is 24/7). */
export async function getClock(): Promise<AlpacaClock> {
  const data = (await alpacaFetch("GET", "/v2/clock")) as AlpacaClock;
  return data;
}

/** True if within N minutes of US equity market close (4 PM ET). Crypto ignores. */
export async function isNearMarketClose(minutesBefore: number): Promise<boolean> {
  const clock = await getClock();
  const nextClose = new Date(clock.next_close).getTime();
  const now = Date.now();
  return nextClose - now <= minutesBefore * 60 * 1000;
}

/** Close a single position (liquidate). Cancels open orders for that symbol first. */
export async function closePosition(symbol: string): Promise<boolean> {
  const openOrders = await getOrders({ status: "open", symbols: [symbol] });
  for (const order of openOrders) {
    await cancelOrder(order.id);
  }
  try {
    await alpacaFetch("DELETE", `/v2/positions/${encodeURIComponent(symbol)}`);
    return true;
  } catch {
    return false;
  }
}

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}

export type AlertRow = {
  id: string;
  received_at: string;
  alert_key: string;
  raw: unknown;
  parsed: unknown;
  ticker: string | null;
  action: string | null;
  price: number | null;
  stop: number | null;
  timeframe: string | null;
};

export type DecisionRow = {
  id: string;
  alert_id: string | null;
  decided_at: string;
  approve: boolean;
  confidence: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  reason: string | null;
  notes: string | null;
  raw_ai: unknown;
  blocked_reason: string | null;
};

export type TradeRow = {
  id: string;
  decision_id: string | null;
  placed_at: string;
  status: string;
  qty: number | null;
  side: string | null;
  symbol: string | null;
  alpaca_order_id: string | null;
  alpaca_raw: unknown;
  error: string | null;
};

export async function insertAlert(data: {
  alert_key: string;
  raw: unknown;
  parsed: unknown;
  ticker: string;
  action: string;
  price: number;
  stop: number;
  timeframe: string;
}): Promise<AlertRow> {
  const sb = getClient();
  const { data: row, error } = await sb
    .from("alerts")
    .insert({
      alert_key: data.alert_key,
      raw: data.raw,
      parsed: data.parsed,
      ticker: data.ticker,
      action: data.action,
      price: data.price,
      stop: data.stop,
      timeframe: data.timeframe,
    })
    .select("id, received_at, alert_key, raw, parsed, ticker, action, price, stop, timeframe")
    .single();

  if (error) throw error;
  return row as AlertRow;
}

export async function getAlertByKey(alert_key: string): Promise<AlertRow | null> {
  const sb = getClient();
  const { data, error } = await sb
    .from("alerts")
    .select("id, received_at, alert_key, raw, parsed, ticker, action, price, stop, timeframe")
    .eq("alert_key", alert_key)
    .maybeSingle();

  if (error) throw error;
  return data as AlertRow | null;
}

export async function insertDecision(data: {
  alert_id: string;
  approve: boolean;
  confidence?: number | null;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  reason?: string | null;
  notes?: string | null;
  raw_ai?: unknown;
  blocked_reason?: string | null;
}): Promise<DecisionRow> {
  const sb = getClient();
  const { data: row, error } = await sb
    .from("decisions")
    .insert({
      alert_id: data.alert_id,
      approve: data.approve,
      confidence: data.confidence ?? null,
      entry: data.entry ?? null,
      stop: data.stop ?? null,
      target: data.target ?? null,
      reason: data.reason ?? null,
      notes: data.notes ?? null,
      raw_ai: data.raw_ai ?? null,
      blocked_reason: data.blocked_reason ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return row as DecisionRow;
}

export async function insertTrade(data: {
  decision_id: string;
  status: string;
  qty: number;
  side: string;
  symbol: string;
  alpaca_order_id?: string | null;
  alpaca_raw?: unknown;
  error?: string | null;
}): Promise<TradeRow> {
  const sb = getClient();
  const { data: row, error } = await sb
    .from("trades")
    .insert({
      decision_id: data.decision_id,
      status: data.status,
      qty: data.qty,
      side: data.side,
      symbol: data.symbol,
      alpaca_order_id: data.alpaca_order_id ?? null,
      alpaca_raw: data.alpaca_raw ?? null,
      error: data.error ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return row as TradeRow;
}

export async function getLastTrade(): Promise<TradeRow | null> {
  const sb = getClient();
  const { data, error } = await sb
    .from("trades")
    .select("id, decision_id, placed_at, status, qty, side, symbol, alpaca_order_id, alpaca_raw, error")
    .order("placed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as TradeRow | null;
}

/** Returns last successful trade for symbol (used for cooldown). Failed/blocked trades do not trigger cooldown. */
export async function getLastTradeForSymbol(symbol: string): Promise<TradeRow | null> {
  const sb = getClient();
  const { data, error } = await sb
    .from("trades")
    .select("id, decision_id, placed_at, status, qty, side, symbol, alpaca_order_id, alpaca_raw, error")
    .eq("symbol", symbol)
    .eq("status", "placed")
    .order("placed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as TradeRow | null;
}

/** Only counts trades with status "placed" (successful orders). Failed/blocked do not count. */
export async function getTradesCountToday(): Promise<number> {
  const sb = getClient();
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startStr = startOfDay.toISOString();

  const { count, error } = await sb
    .from("trades")
    .select("id", { count: "exact", head: true })
    .eq("status", "placed")
    .gte("placed_at", startStr);

  if (error) throw error;
  return count ?? 0;
}

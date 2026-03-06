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

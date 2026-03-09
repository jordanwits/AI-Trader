import { NextRequest, NextResponse } from "next/server";
import { getPositions, getOrders, getAssetClass, closePosition, getClock, cancelOrder } from "@/lib/alpaca";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Single daily cron: (1) closes equity positions before 4 PM ET, (2) cancels orphaned crypto SL/TP orders. */
export async function GET(req: NextRequest) {
  if (env.CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result: { ok: boolean; closed?: number; closed_symbols?: string[]; cancelled?: number; reason?: string } = { ok: true };

    // 1. Close equity positions when 15-90 min before 4 PM ET (works for EST/EDT with single cron)
    const clock = await getClock();
    if (clock.is_open) {
      const nextClose = new Date(clock.next_close).getTime();
      const minsToClose = (nextClose - Date.now()) / (60 * 1000);
      if (minsToClose <= 90 && minsToClose >= 15) {
        const positions = await getPositions();
        const closedSymbols: string[] = [];
        let closed = 0;
        for (const pos of positions) {
          const assetClass = await getAssetClass(pos.symbol);
          if (assetClass !== "us_equity") continue;
          if (await closePosition(pos.symbol)) {
            closed++;
            closedSymbols.push(pos.symbol);
          }
        }
        result.closed = closed;
        result.closed_symbols = closedSymbols;
      } else {
        result.reason = minsToClose > 90 ? `Too early: ${minsToClose.toFixed(0)} min to close` : "Market closing soon or closed";
      }
    }

    // 2. Cancel orphaned crypto SL/TP orders (no open position)
    const positions = await getPositions();
    const symbolsWithPosition = new Set(positions.map((p) => p.symbol));
    const openOrders = await getOrders({ status: "open", limit: 100 });
    let cancelled = 0;
    for (const order of openOrders) {
      if (order.side !== "sell") continue;
      if (symbolsWithPosition.has(order.symbol)) continue;
      const assetClass = await getAssetClass(order.symbol);
      if (assetClass !== "crypto") continue;
      await cancelOrder(order.id);
      cancelled++;
    }
    result.cancelled = cancelled;

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getOrders, getPositions, cancelOrder, getAssetClass } from "@/lib/alpaca";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Cancels orphaned crypto SL/TP orders when position is closed. Call via cron. */
export async function GET(req: NextRequest) {
  if (env.CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
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

    return NextResponse.json({ ok: true, cancelled });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

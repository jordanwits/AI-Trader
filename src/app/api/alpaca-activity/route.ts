import { NextResponse } from "next/server";
import { getOrders, getPositions } from "@/lib/alpaca";

export async function GET() {
  try {
    const [orders, positions] = await Promise.all([
      getOrders({ status: "all", limit: 50 }),
      getPositions(),
    ]);
    return NextResponse.json({ orders, positions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

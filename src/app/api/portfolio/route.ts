import { NextRequest, NextResponse } from "next/server";
import { getAccount, getPortfolioHistory } from "@/lib/alpaca";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const period = (req.nextUrl.searchParams.get("period") as "1D" | "1W" | "1M" | "1A" | null) ?? "1M";
    const timeframe = (req.nextUrl.searchParams.get("timeframe") as "1Min" | "5Min" | "15Min" | "1H" | "1D" | null) ?? undefined;

    const [account, history] = await Promise.all([
      getAccount(),
      getPortfolioHistory({ period, timeframe }),
    ]);

    return NextResponse.json({ account, history });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

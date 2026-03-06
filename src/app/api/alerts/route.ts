import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10)), 100);
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data, error } = await client
      .from("alerts")
      .select("id, received_at, alert_key, ticker, action, price, stop, timeframe, parsed")
      .order("received_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({ alerts: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

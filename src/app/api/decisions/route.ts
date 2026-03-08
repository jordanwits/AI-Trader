import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "30", 10)), 100);
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: decisions, error } = await client
      .from("decisions")
      .select("id, alert_id, decided_at, approve, confidence, reason, blocked_reason")
      .order("decided_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const alertIds = Array.from(new Set((decisions ?? []).map((d: { alert_id: string }) => d.alert_id).filter(Boolean)));
    const { data: alerts } = alertIds.length
      ? await client.from("alerts").select("id, received_at, ticker, action, price, stop, timeframe").in("id", alertIds)
      : { data: [] };

    const alertMap = new Map((alerts ?? []).map((a: { id: string }) => [a.id, a]));
    const enriched = (decisions ?? []).map((d: { alert_id: string }) => ({
      ...d,
      alert: alertMap.get(d.alert_id) ?? null,
    }));

    return NextResponse.json({ decisions: enriched }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

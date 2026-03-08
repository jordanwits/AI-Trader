import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Temporary: verify Supabase connection and latest data. Remove after debugging. */
export async function GET() {
  try {
    const projectRef = new URL(env.SUPABASE_URL).hostname.replace(".supabase.co", "");
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const [alertsRes, decisionsRes] = await Promise.all([
      client.from("alerts").select("id, received_at, ticker").order("received_at", { ascending: false }).limit(3),
      client.from("decisions").select("id, decided_at, approve, alert_id").order("decided_at", { ascending: false }).limit(3),
    ]);

    return NextResponse.json({
      supabase_project: projectRef,
      latest_alerts: alertsRes.data ?? [],
      latest_decisions: decisionsRes.data ?? [],
      alerts_error: alertsRes.error?.message,
      decisions_error: decisionsRes.error?.message,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

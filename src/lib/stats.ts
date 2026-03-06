import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// TODO: Real PnL sync with Alpaca. daily_loss_approx is placeholder.
export async function getTodayStats(): Promise<{
  trades_count: number;
  daily_loss_approx: number;
}> {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startStr = startOfDay.toISOString();

  const { count, error } = await client
    .from("trades")
    .select("id", { count: "exact", head: true })
    .gte("placed_at", startStr);

  if (error) throw error;

  return {
    trades_count: count ?? 0,
    daily_loss_approx: 0, // TODO: sum realized PnL from Alpaca or trades
  };
}

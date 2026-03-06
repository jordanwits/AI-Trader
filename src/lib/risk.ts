import { env } from "./env";
import {
  getLastTrade,
  getTradesCountToday,
} from "./supabaseAdmin";

export type RiskPreCheckParams = {
  price: number;
  stop: number;
};

export type RiskPreCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

// TODO: Real PnL sync with Alpaca for MAX_DAILY_LOSS_DOLLARS enforcement.
// Currently only MAX_TRADES_PER_DAY and COOLDOWN are enforced.

export async function preCheck(params: RiskPreCheckParams): Promise<RiskPreCheckResult> {
  const { price, stop } = params;
  const stopDistance = Math.abs(price - stop);

  if (stopDistance < env.MIN_STOP_DISTANCE) {
    return {
      ok: false,
      reason: `Stop distance ${stopDistance.toFixed(4)} < MIN_STOP_DISTANCE ${env.MIN_STOP_DISTANCE}`,
    };
  }

  const tradesCount = await getTradesCountToday();
  if (tradesCount >= env.MAX_TRADES_PER_DAY) {
    return {
      ok: false,
      reason: `Max trades per day reached: ${tradesCount} >= ${env.MAX_TRADES_PER_DAY}`,
    };
  }

  const lastTrade = await getLastTrade();
  if (lastTrade) {
    const placedAt = new Date(lastTrade.placed_at).getTime();
    const elapsed = (Date.now() - placedAt) / 1000;
    if (elapsed < env.COOLDOWN_SECONDS) {
      return {
        ok: false,
        reason: `Cooldown: ${Math.ceil(env.COOLDOWN_SECONDS - elapsed)}s remaining`,
      };
    }
  }

  return { ok: true };
}

export function computeQty(entry: number, stop: number): number {
  const stopDistance = Math.abs(entry - stop);
  if (stopDistance < env.MIN_STOP_DISTANCE) return 0;
  const qty = Math.floor(env.RISK_PER_TRADE_DOLLARS / stopDistance);
  return Math.max(0, qty);
}

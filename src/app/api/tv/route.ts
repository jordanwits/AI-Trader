import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { parseTvPayload } from "@/lib/validate";
import { hashBody } from "@/lib/ids";
import {
  getAlertByKey,
  insertAlert,
  insertDecision,
  insertTrade,
} from "@/lib/supabaseAdmin";
import { preCheck, computeQty } from "@/lib/risk";
import { decide } from "@/lib/aiDecider";
import { placeMarketOrderWithStopLoss, resolveAlpacaSymbol, getAccount, getAssetClass, isNearMarketClose } from "@/lib/alpaca";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import type { AlertPayload } from "@/lib/validate";

export const maxDuration = 30;

async function processAlertInBackground(
  alert: { id: string },
  parsed: AlertPayload
): Promise<void> {
  try {
    // Resolve symbol early so we can pass it to preCheck (per-symbol cooldown) and match trades table.
    const alpacaSymbol = await resolveAlpacaSymbol(parsed.ticker);
    if (!alpacaSymbol) {
      await insertDecision({
        alert_id: alert.id,
        approve: false,
        blocked_reason: `Symbol ${parsed.ticker} not tradeable on Alpaca`,
      });
      logger.info("Alert blocked: symbol not tradeable", { alert_id: alert.id, symbol: parsed.ticker });
      return;
    }

    // Alpaca crypto is spot-only: no short selling. SELL = open short; block crypto SELL.
    const assetClass = await getAssetClass(alpacaSymbol);
    if (parsed.action === "SELL" && assetClass === "crypto") {
      await insertDecision({
        alert_id: alert.id,
        approve: false,
        blocked_reason: "Alpaca crypto is spot-only; short selling not supported. SELL alerts for crypto are disabled.",
      });
      logger.info("Alert blocked: crypto short not supported", { alert_id: alert.id, symbol: alpacaSymbol });
      return;
    }

    // Block new equity entries near market close - exit planning happens via cron
    if (assetClass === "us_equity") {
      const nearClose = await isNearMarketClose(env.MINUTES_BEFORE_CLOSE_NO_ENTRY);
      if (nearClose) {
        await insertDecision({
          alert_id: alert.id,
          approve: false,
          blocked_reason: `Market closing soon - no new entries within ${env.MINUTES_BEFORE_CLOSE_NO_ENTRY} min of 4 PM ET`,
        });
        logger.info("Alert blocked: near market close", { alert_id: alert.id, symbol: alpacaSymbol });
        return;
      }
    }

    const riskResult = await preCheck({ price: parsed.price, stop: parsed.stop, symbol: alpacaSymbol });
    if (!riskResult.ok) {
      await insertDecision({
        alert_id: alert.id,
        approve: false,
        blocked_reason: riskResult.reason,
      });
      logger.info("Alert blocked by risk", { alert_id: alert.id, reason: riskResult.reason });
      return;
    }

    // Skip AI if entry/stop is nonsensical (would reject anyway)
    const { price: entryPrice, stop: stopPrice, action } = parsed;
    if (action === "BUY" && stopPrice >= entryPrice) {
      await insertDecision({
        alert_id: alert.id,
        approve: false,
        blocked_reason: "Invalid: stop must be below entry for a BUY",
      });
      logger.info("Alert blocked: invalid stop/entry", { alert_id: alert.id });
      return;
    }
    if (action === "SELL" && stopPrice <= entryPrice) {
      await insertDecision({
        alert_id: alert.id,
        approve: false,
        blocked_reason: "Invalid: stop must be above entry for a SELL (short)",
      });
      logger.info("Alert blocked: invalid stop/entry", { alert_id: alert.id });
      return;
    }

    const aiResult = await decide(parsed);

    const decision = await insertDecision({
      alert_id: alert.id,
      approve: aiResult.success ? aiResult.decision.approve : false,
      confidence: aiResult.success ? aiResult.decision.confidence : null,
      entry: aiResult.success ? aiResult.decision.entry : null,
      stop: aiResult.success ? aiResult.decision.stop : null,
      target: aiResult.success ? aiResult.decision.target : null,
      reason: aiResult.success ? aiResult.decision.reason : null,
      notes: aiResult.success ? aiResult.decision.notes : null,
      raw_ai: aiResult.success ? undefined : aiResult.rawAi,
      blocked_reason: aiResult.success ? undefined : aiResult.blockedReason,
    });

    if (!aiResult.success || !aiResult.decision.approve) {
      logger.info("Alert rejected by AI", {
        alert_id: alert.id,
        reason: aiResult.success ? aiResult.decision.reason : aiResult.blockedReason,
      });
      return;
    }

    // For SELL (short), AI sometimes returns stop <= entry (long-style). Use validated parsed values as fallback.
    let entry = aiResult.decision.entry!;
    let stop = aiResult.decision.stop!;
    if (parsed.action === "SELL" && stop <= entry) {
      logger.warn("AI returned invalid stop for SELL (stop <= entry), using parsed payload", {
        alert_id: alert.id,
        ai_entry: entry,
        ai_stop: stop,
        parsed_price: parsed.price,
        parsed_stop: parsed.stop,
      });
      entry = parsed.price;
      stop = parsed.stop;
    }
    const target =
      aiResult.decision.target != null && Number.isFinite(aiResult.decision.target)
        ? aiResult.decision.target
        : parsed.take_profit != null && Number.isFinite(parsed.take_profit)
          ? parsed.take_profit
          : parsed.action === "BUY"
            ? entry + (entry - stop)
            : entry - (stop - entry);

    if (!Number.isFinite(target)) {
      await insertTrade({
        decision_id: decision.id,
        status: "failed",
        qty: 0,
        side: parsed.action.toLowerCase(),
        symbol: alpacaSymbol,
        error: "Could not compute target: AI returned none, payload has no take_profit, and 1:1 R:R failed",
      });
      logger.info("Alert blocked: no valid target", { alert_id: alert.id });
      return;
    }

    let qty = computeQty(entry, stop);

    if (qty <= 0) {
      await insertTrade({
        decision_id: decision.id,
        status: "blocked",
        qty: 0,
        side: parsed.action.toLowerCase(),
        symbol: alpacaSymbol,
        error: "Qty <= 0 from risk compute",
      });
      logger.info("Alert blocked: qty <= 0", { alert_id: alert.id });
      return;
    }

    if (parsed.action === "BUY") {
      const account = await getAccount();
      const assetClass = await getAssetClass(alpacaSymbol);
      const available = assetClass === "crypto" ? Number(account.cash) : Number(account.buying_power);
      // Crypto: use 90% of cash, assume 3% price rise at fill, then 1% qty haircut. Equities: 98%.
      const cashBuffer = assetClass === "crypto" ? 0.90 : 0.98;
      const maxNotional = available * cashBuffer;
      const maxQty = assetClass === "crypto" ? (maxNotional / (entry * 1.03)) * 0.99 : maxNotional / entry;
      if (maxQty < 1e-10) {
        await insertTrade({
          decision_id: decision.id,
          status: "blocked",
          qty: 0,
          side: "buy",
          symbol: alpacaSymbol,
          error: "Insufficient buying power",
        });
        logger.info("Alert blocked: insufficient buying power", { alert_id: alert.id });
        return;
      }
      qty = assetClass === "crypto" ? Math.min(qty, maxQty) : Math.min(qty, Math.floor(maxQty));
      if (qty < 1e-10) {
        await insertTrade({
          decision_id: decision.id,
          status: "blocked",
          qty: 0,
          side: "buy",
          symbol: alpacaSymbol,
          error: "Order size would exceed buying power",
        });
        logger.info("Alert blocked: order exceeds buying power", { alert_id: alert.id });
        return;
      }
    }

    const order = await placeMarketOrderWithStopLoss(
      alpacaSymbol,
      qty,
      parsed.action === "BUY" ? "buy" : "sell",
      stop,
      target,
      entry
    );

    await insertTrade({
      decision_id: decision.id,
      status: "placed",
      qty,
      side: parsed.action.toLowerCase(),
      symbol: alpacaSymbol,
      alpaca_order_id: order.alpaca_order_id,
      alpaca_raw: order.raw,
    });

    logger.info("Trade placed", {
      alert_id: alert.id,
      symbol: alpacaSymbol,
      alpaca_order_id: order.alpaca_order_id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Background processing failed", { alert_id: alert.id, error: msg });
    try {
      const decision = await insertDecision({
        alert_id: alert.id,
        approve: false,
        blocked_reason: `Processing error: ${msg}`,
      });
      await insertTrade({
        decision_id: decision.id,
        status: "failed",
        qty: 0,
        side: parsed.action.toLowerCase(),
        symbol: parsed.ticker,
        error: msg,
      });
    } catch (insertErr) {
      logger.error("Failed to record error", insertErr);
    }
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Webhook secret: if WEBHOOK_SECRET is set, require x-webhook-secret header
  if (env.WEBHOOK_SECRET) {
    const secret = req.headers.get("x-webhook-secret");
    if (secret !== env.WEBHOOK_SECRET) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  // Idempotency: alert_key = alert_id from payload if present, else hash(rawBody)
  let alertKey: string;
  try {
    const parsedForKey = typeof body === "object" && body !== null && "message" in body
      ? JSON.parse((body as { message: string }).message)
      : body;
    alertKey =
      typeof parsedForKey === "object" && parsedForKey !== null && typeof parsedForKey.alert_id === "string"
        ? parsedForKey.alert_id
        : hashBody(rawBody);
  } catch {
    alertKey = hashBody(rawBody);
  }

  const existing = await getAlertByKey(alertKey);
  if (existing) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  let parsed: AlertPayload;
  try {
    parsed = parseTvPayload(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `Validation: ${msg}` }, { status: 400 });
  }

  let alert;
  try {
    alert = await insertAlert({
      alert_key: alertKey,
      raw: body,
      parsed: parsed as object,
      ticker: parsed.ticker,
      action: parsed.action,
      price: parsed.price,
      stop: parsed.stop,
      timeframe: parsed.timeframe,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json({ ok: true, deduped: true });
    }
    logger.error("Insert alert failed", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  // Return 200 immediately so TradingView doesn't timeout. Process in background.
  waitUntil(processAlertInBackground(alert, parsed));

  return NextResponse.json({
    ok: true,
    alert_id: alert.id,
    queued: true,
    message: "Alert received, processing in background",
  });
}

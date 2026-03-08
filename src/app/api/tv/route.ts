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
import { placeMarketOrderWithStopLoss, isSymbolTradeable } from "@/lib/alpaca";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import type { AlertPayload } from "@/lib/validate";

export const maxDuration = 30;

async function processAlertInBackground(
  alert: { id: string },
  parsed: AlertPayload
): Promise<void> {
  try {
    const riskResult = await preCheck({ price: parsed.price, stop: parsed.stop });
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
    const { price: entry, stop, action } = parsed;
    if (action === "BUY" && stop >= entry) {
      await insertDecision({
        alert_id: alert.id,
        approve: false,
        blocked_reason: "Invalid: stop must be below entry for a BUY",
      });
      logger.info("Alert blocked: invalid stop/entry", { alert_id: alert.id });
      return;
    }
    if (action === "SELL" && stop <= entry) {
      await insertDecision({
        alert_id: alert.id,
        approve: false,
        blocked_reason: "Invalid: stop must be above entry for a SELL (short)",
      });
      logger.info("Alert blocked: invalid stop/entry", { alert_id: alert.id });
      return;
    }

    // Skip AI if symbol not tradeable on Alpaca (order would fail anyway)
    const tradeable = await isSymbolTradeable(parsed.ticker);
    if (!tradeable) {
      await insertDecision({
        alert_id: alert.id,
        approve: false,
        blocked_reason: `Symbol ${parsed.ticker} not tradeable on Alpaca`,
      });
      logger.info("Alert blocked: symbol not tradeable", { alert_id: alert.id, symbol: parsed.ticker });
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

    const entry = aiResult.decision.entry!;
    const stop = aiResult.decision.stop!;
    const qty = computeQty(entry, stop);

    if (qty <= 0) {
      await insertTrade({
        decision_id: decision.id,
        status: "blocked",
        qty: 0,
        side: parsed.action.toLowerCase(),
        symbol: parsed.ticker,
        error: "Qty <= 0 from risk compute",
      });
      logger.info("Alert blocked: qty <= 0", { alert_id: alert.id });
      return;
    }

    const order = await placeMarketOrderWithStopLoss(
      parsed.ticker,
      qty,
      parsed.action === "BUY" ? "buy" : "sell",
      stop
    );

    await insertTrade({
      decision_id: decision.id,
      status: "placed",
      qty,
      side: parsed.action.toLowerCase(),
      symbol: parsed.ticker,
      alpaca_order_id: order.alpaca_order_id,
      alpaca_raw: order.raw,
    });

    logger.info("Trade placed", {
      alert_id: alert.id,
      symbol: parsed.ticker,
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

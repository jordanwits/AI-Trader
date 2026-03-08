import OpenAI from "openai";
import { z } from "zod";
import { env } from "./env";
import type { AlertPayload } from "./validate";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const DecisionSchema = z.object({
  approve: z.boolean(),
  confidence: z.number().min(0).max(1),
  entry: z.number().finite(),
  stop: z.number().finite(),
  target: z.number().finite(),
  reason: z.string(),
  notes: z.string(),
});

export type AIDecision = z.infer<typeof DecisionSchema>;

// AI must only decide from payload - no live market fetch.
const SYSTEM_PROMPT = `You are a paper-trading advisor. You receive alert signals (ticker, timeframe, action, price, stop, meta indicators).
Your job: decide whether to approve or reject the trade. For paper trading, FAVOR approving valid signals to gather trade data.

Entry/stop rules (use strict numeric comparison; reject ONLY when violated):
- BUY (long): stop must be BELOW entry. Reject only if stop >= entry. Example: entry=590, stop=589 → APPROVE (589 < 590).
- SELL (short): stop must be ABOVE entry. Reject only if stop <= entry.

Only reject if: (1) the signal is clearly invalid or self-contradictory, (2) entry/stop violates the rules above (strictly).
Use price as entry. Use stop from payload. Set target = entry + (entry - stop) for longs, or entry - (stop - entry) for shorts (1:1 R:R) if not provided.
Output strictly valid JSON with: approve (bool), confidence (0-1), entry, stop, target (numbers), reason, notes (strings).
Do NOT fetch any live market data. Use only the payload.`;

export async function decide(alert: AlertPayload): Promise<
  | { success: true; decision: AIDecision }
  | { success: false; rawAi: string; blockedReason: string }
> {
  const userPrompt = `Signal: ${alert.ticker} ${alert.timeframe} ${alert.action} @ ${alert.price} stop ${alert.stop}. Meta: ${JSON.stringify(alert.meta ?? {})}. Output JSON only.`;

  let rawContent: string;
  try {
    const resp = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
    });
    rawContent = resp.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, rawAi: "", blockedReason: `OpenAI error: ${msg}` };
  }

  // Try to extract JSON from markdown code block if present
  let jsonStr = rawContent;
  const codeMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) jsonStr = codeMatch[1].trim();
  else {
    const brace = rawContent.indexOf("{");
    if (brace >= 0) jsonStr = rawContent.slice(brace);
  }

  const parsed = z.unknown().safeParse(JSON.parse(jsonStr));
  if (!parsed.success) {
    return {
      success: false,
      rawAi: rawContent,
      blockedReason: `Invalid AI JSON: ${parsed.error.message}`,
    };
  }

  const decisionResult = DecisionSchema.safeParse(parsed.data);
  if (!decisionResult.success) {
    return {
      success: false,
      rawAi: rawContent,
      blockedReason: `AI output schema invalid: ${decisionResult.error.message}`,
    };
  }

  return { success: true, decision: decisionResult.data };
}

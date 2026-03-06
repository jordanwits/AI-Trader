import { z } from "zod";

const MetaSchema = z.record(z.union([z.string(), z.number(), z.boolean()])).optional();

export const AlertPayloadSchema = z.object({
  alert_id: z.string().optional(),
  ticker: z.string().min(1),
  timeframe: z.string().min(1),
  action: z.enum(["BUY", "SELL"]),
  price: z.number().finite(),
  stop: z.number().finite(),
  meta: MetaSchema,
});

export const TradingViewWrapperSchema = z.object({
  message: z.string(),
});

export type AlertPayload = z.infer<typeof AlertPayloadSchema>;

export function parseTvPayload(body: unknown): AlertPayload {
  const parsed = z.unknown().safeParse(body);
  if (!parsed.success) {
    throw new Error("Invalid JSON body");
  }
  const raw = parsed.data;

  if (typeof raw === "object" && raw !== null && "message" in raw) {
    const wrapper = TradingViewWrapperSchema.safeParse(raw);
    if (wrapper.success) {
      const inner = JSON.parse(wrapper.data.message) as unknown;
      return AlertPayloadSchema.parse(inner);
    }
  }

  return AlertPayloadSchema.parse(raw);
}

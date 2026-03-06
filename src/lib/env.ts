import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ALPACA_KEY: z.string().min(1),
  ALPACA_SECRET: z.string().min(1),
  ALPACA_BASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  WEBHOOK_SECRET: z.string().optional(),
  ACCOUNT_EQUITY: z.coerce.number().default(100_000),
  RISK_PER_TRADE_DOLLARS: z.coerce.number().default(50),
  MAX_TRADES_PER_DAY: z.coerce.number().default(5),
  MAX_DAILY_LOSS_DOLLARS: z.coerce.number().default(150),
  COOLDOWN_SECONDS: z.coerce.number().default(180),
  MIN_STOP_DISTANCE: z.coerce.number().default(0.05),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const msg = parsed.error.errors
    .map((e) => `${e.path.join(".")}: ${e.message}`)
    .join("; ");
  throw new Error(`Invalid environment: ${msg}`);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;

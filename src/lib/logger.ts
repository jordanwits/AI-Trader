import { env } from "./env";

const REDACT_PATTERNS = [
  env.ALPACA_KEY,
  env.ALPACA_SECRET,
  env.SUPABASE_SERVICE_ROLE_KEY,
  env.WEBHOOK_SECRET,
].filter(Boolean) as string[];

function redact(msg: string): string {
  let out = msg;
  for (const secret of REDACT_PATTERNS) {
    if (secret) out = out.replaceAll(secret, "[REDACTED]");
  }
  return out;
}

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVEL_ORDER[env.LOG_LEVEL];

function shouldLog(level: keyof typeof LEVEL_ORDER): boolean {
  return LEVEL_ORDER[level] >= currentLevel;
}

export const logger = {
  info(msg: string, ...args: unknown[]): void {
    if (shouldLog("info"))
      console.log(redact(msg), ...args.map((a) => (typeof a === "string" ? redact(a) : a)));
  },
  warn(msg: string, ...args: unknown[]): void {
    if (shouldLog("warn"))
      console.warn(redact(msg), ...args.map((a) => (typeof a === "string" ? redact(a) : a)));
  },
  error(msg: string, ...args: unknown[]): void {
    if (shouldLog("error"))
      console.error(redact(msg), ...args.map((a) => (typeof a === "string" ? redact(a) : a)));
  },
  debug(msg: string, ...args: unknown[]): void {
    if (shouldLog("debug"))
      console.debug(redact(msg), ...args.map((a) => (typeof a === "string" ? redact(a) : a)));
  },
};

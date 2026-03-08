import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Debug: returns a fingerprint of Alpaca env vars so you can verify
 * local vs Vercel use the same credentials. Remove this route before production.
 */
export async function GET() {
  const keyHash = createHash("sha256")
    .update(env.ALPACA_KEY + "|" + env.ALPACA_SECRET)
    .digest("hex")
    .slice(0, 16);
  const keyLen = env.ALPACA_KEY.length;
  const secretLen = env.ALPACA_SECRET.length;
  return NextResponse.json({
    alpaca_key_fingerprint: keyHash,
    alpaca_key_length: keyLen,
    alpaca_secret_length: secretLen,
    base_url: env.ALPACA_BASE_URL,
    note: "If local and live show the SAME fingerprint + lengths, credentials match. If not, Vercel env vars differ.",
  });
}

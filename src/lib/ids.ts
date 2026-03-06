import { createHash } from "crypto";

export function generateId(): string {
  return crypto.randomUUID();
}

export function hashBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

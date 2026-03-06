import { NextResponse } from "next/server";
import { getTodayStats } from "@/lib/stats";

export async function GET() {
  try {
    const stats = await getTodayStats();
    return NextResponse.json({ today: stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

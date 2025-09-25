import { NextResponse } from "next/server";
import { updateStatistics } from "@/lib/statistics";

export const runtime = "nodejs";

/**
 * POST /api/statistics/update
 * Forces recomputation of statistics and returns the updated payload.
 */
export async function POST() {
  try {
    const stats = await updateStatistics();
    return NextResponse.json({ ok: true, ...stats });
  } catch (e: any) {
    console.error("[statistics] UPDATE error:", e?.message || e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

/**
 * GET is also allowed for convenience.
 */
export async function GET() {
  return POST();
}

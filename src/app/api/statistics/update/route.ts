import { NextResponse } from "next/server";
import { updateStatistics } from "@/lib/statistics";
import { requireAdminRequest } from "@/lib/server/adminAuth";

export const runtime = "nodejs";

/**
 * POST /api/statistics/update
 * Forces recomputation of statistics and returns the updated payload.
 */
export async function POST(req: Request) {
  try {
    const unauthorized = requireAdminRequest(req);
    if (unauthorized) return unauthorized;

    const stats = await updateStatistics();
    return NextResponse.json({ ok: true, ...stats });
  } catch (e: any) {
    console.error("[statistics] UPDATE error:", e?.message || e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}

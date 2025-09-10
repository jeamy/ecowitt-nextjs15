import { NextResponse } from "next/server";
import { getLastRealtime } from "@/lib/realtimeArchiver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * API route to get the last cached real-time weather data.
 * This provides a fast way for the client to get the latest data without hitting the Ecowitt API directly.
 * @returns {Promise<NextResponse>} A JSON response containing the last cached data, or an error if no data is available yet.
 * @example
 * // GET /api/rt/last
 * // Returns:
 * // {
 * //   "ok": true,
 * //   "updatedAt": "2025-08-15T14:30:00.000Z",
 * //   "data": { ... weather data payload ... }
 * // }
 */
export async function GET() {
  try {
    const last = await getLastRealtime();
    if (!last) {
      return NextResponse.json({ ok: false, error: "no data yet", updatedAt: null }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(last, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

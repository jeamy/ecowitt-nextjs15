import { NextResponse } from "next/server";
import { backfillForecastAnalysis } from "@/instrumentation";

export const runtime = "nodejs";

/**
 * POST /api/forecast/backfill
 * Body: { stationId: string, days?: number }
 * Triggers backfill of forecast analysis for the last N days (default 30).
 */
export async function POST(req: Request) {
  try {
    const { stationId, days } = await req.json();
    if (!stationId) {
      return NextResponse.json({ error: "stationId is required" }, { status: 400 });
    }
    const numDays = typeof days === "number" && Number.isFinite(days) ? days : 30;

    await backfillForecastAnalysis(String(stationId), numDays);

    return NextResponse.json({ ok: true, stationId, days: numDays, ran: "backfillForecastAnalysis" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

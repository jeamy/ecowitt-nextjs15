import { NextResponse } from "next/server";
import { calculateAndStoreDailyAnalysis } from "@/instrumentation";

export const runtime = "nodejs";

/**
 * POST /api/forecast/analyze
 * Body: { stationId: string }
 * Triggers calculation and storage of yesterday's forecast analysis for the station.
 */
export async function POST(req: Request) {
  try {
    const { stationId } = await req.json();
    if (!stationId) {
      return NextResponse.json({ error: "stationId is required" }, { status: 400 });
    }

    await calculateAndStoreDailyAnalysis(String(stationId));

    return NextResponse.json({ ok: true, stationId, ran: "calculateAndStoreDailyAnalysis" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

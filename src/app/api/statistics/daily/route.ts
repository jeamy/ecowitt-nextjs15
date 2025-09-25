import { NextRequest, NextResponse } from "next/server";
import { getDailySeries } from "@/lib/statistics";

export const runtime = "nodejs";

/**
 * GET /api/statistics/daily?year=YYYY
 * Returns daily aggregates (tmax, tmin, tavg, rain_day, wind_max, gust_max, wind_avg)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const yearParam = searchParams.get("year");
    const y = yearParam ? Number(yearParam) : undefined;
    const series = await getDailySeries(Number.isFinite(y as number) ? (y as number) : undefined);
    return NextResponse.json({ ok: true, year: y ?? null, days: series });
  } catch (e: any) {
    console.error("[statistics/daily] GET error:", e?.message || e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

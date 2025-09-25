import { NextRequest, NextResponse } from "next/server";
import { updateStatisticsIfNeeded, getStatisticsMeta } from "@/lib/statistics";

export const runtime = "nodejs";

/**
 * GET /api/statistics
 * Optional query: ?year=YYYY (only return a single year's stats)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const yearParam = searchParams.get("year");
    const debug = searchParams.get("debug");
    const stats = await updateStatisticsIfNeeded();
    const meta = debug ? await getStatisticsMeta() : undefined;

    if (yearParam) {
      const y = Number(yearParam);
      const item = stats.years.find((it) => it.year === y) || null;
      return NextResponse.json({ ok: true, updatedAt: stats.updatedAt, years: item ? [item] : [], meta });
    }

    return NextResponse.json({ ok: true, ...stats, meta });
  } catch (e: any) {
    console.error("[statistics] GET error:", e?.message || e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { parseISODate, queryRangeStats } from "@/lib/aggregation";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = parseISODate(searchParams.get("start"));
    const end = parseISODate(searchParams.get("end"));
    const fields = (searchParams.get("fields") || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!start || !end) {
      return NextResponse.json({ ok: false, error: "start and end are required ISO datetimes" }, { status: 400 });
    }
    if (fields.length === 0) {
      return NextResponse.json({ ok: false, error: "fields is required (comma separated)" }, { status: 400 });
    }
    const data = await queryRangeStats({ start, end, fields });
    return NextResponse.json({ ok: true, ...data });
  } catch (e: any) {
    console.error("[api/series/range-stats] GET error:", e?.message || e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

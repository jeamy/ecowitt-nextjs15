import { NextRequest, NextResponse } from "next/server";
import { ensureMainParquetsInRange } from "@/lib/db/ingest";
import { queryDailyAggregatesInRange, computeStatsFromDaily, type DailyAggregateRow } from "@/lib/statistics";

export const runtime = "nodejs";

function parseDateParam(v: string | null): Date | undefined {
  if (!v) return undefined;
  const s = v.replace("T", " ");
  const d = new Date(s);
  if (isNaN(d.getTime())) return undefined;
  return d;
}

function monthRange(month: string): { start: Date; end: Date } | null {
  if (!/^\d{6}$/.test(month)) return null;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(4, 6));
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 0, 23, 59, 59, 999);
  return { start, end };
}

function toIsoMinute(d: Date) {
  const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function daysInclusive(a: Date, b: Date) {
  const d0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const d1 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  const ms = d1.getTime() - d0.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * GET /api/statistics/range?start=YYYY-MM-DDTHH:MM&end=YYYY-MM-DDTHH:MM
 * Or: /api/statistics/range?month=YYYYMM
 * Returns server-side computed statistics (daily-based) for the selected range.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month");
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");

    let start: Date | undefined;
    let end: Date | undefined;

    if (month) {
      const r = monthRange(month);
      if (!r) return NextResponse.json({ ok: false, error: "Invalid month" }, { status: 400 });
      start = r.start; end = r.end;
    } else {
      start = parseDateParam(startParam);
      end = parseDateParam(endParam);
      if (!start || !end) return NextResponse.json({ ok: false, error: "Missing start or end" }, { status: 400 });
    }

    const parquets = await ensureMainParquetsInRange(start, end);
    if (!parquets.length) return NextResponse.json({ ok: false, error: "No data in range" }, { status: 404 });

    const days: DailyAggregateRow[] = await queryDailyAggregatesInRange(parquets, start, end);
    const { temp, rain, wind, rainDays } = computeStatsFromDaily(days);

    const startIso = toIsoMinute(start!);
    const endIso = toIsoMinute(end!);
    const totalPeriodDays = daysInclusive(start!, end!);

    return NextResponse.json({ ok: true, start: startIso, end: endIso, totalPeriodDays, days, stats: { temp, rain, wind, rainDays } });
  } catch (e: any) {
    console.error("[statistics/range] GET error:", e?.message || e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { ensureAllsensorsParquetsInRange } from "@/lib/db/ingest";
import { sqlNum } from "@/lib/data/columns";

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

function findChannelMetricColumns(allNames: string[], chNum: string) {
  const pref = `CH${chNum} `;
  const tempNames = ["Temperatur", "Temperature"];
  const feelNames = ["Gefühlte Temperatur", "Wärmeindex", "Feels Like", "Heat Index"];
  const humNames = ["Luftfeuchtigkeit", "Humidity", "hum"]; // currently unused for stats

  const findFirst = (cands: string[]) => {
    for (const n of allNames) {
      if (!n.startsWith(pref)) continue;
      for (const m of cands) {
        if (n.startsWith(pref + m)) return n;
      }
    }
    return null as string | null;
  };

  const tempCol = findFirst(tempNames);
  const feelCol = findFirst(feelNames);
  const humCol = findFirst(humNames);
  return { tempCol, feelCol, humCol };
}

/**
 * GET /api/statistics/channels?ch=ch1&start=YYYY-MM-DDTHH:MM&end=YYYY-MM-DDTHH:MM
 * Or: /api/statistics/channels?ch=ch1&month=YYYYMM
 * Returns server-side computed temperature statistics for the selected channel over the range.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ch = (searchParams.get("ch") || "").trim().toLowerCase(); // e.g. ch1
    const month = searchParams.get("month");
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");

    if (!/^ch\d+$/.test(ch)) return NextResponse.json({ ok: false, error: "Invalid channel" }, { status: 400 });
    const chNum = ch.replace(/^ch/, "");

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

    const parquets = await ensureAllsensorsParquetsInRange(start, end);
    if (!parquets.length) return NextResponse.json({ ok: false, error: "No data in range" }, { status: 404 });

    const { withConn } = await import("@/lib/db/duckdb");
    const qp = parquets.map((p) => p.replace(/\\/g, "/"));
    const arr = '[' + qp.map((p) => `\'${p}\'`).join(',') + ']';

    const days = await withConn(async (conn) => {
      // Introspect columns
      const descReader = await conn.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet(${arr}, union_by_name=true)`);
      const cols: any[] = descReader.getRowObjects();
      const allNames = cols.map((r: any) => String(r.column_name || r.ColumnName || r.column || ""));

      const { tempCol, feelCol } = findChannelMetricColumns(allNames, chNum);
      if (!tempCol) throw new Error("No temperature column for channel");

      const whereStart = start ? `ts >= strptime('${toIsoMinute(start).replace('T', ' ')}', ['%Y-%m-%d %H:%M'])` : '1=1';
      const whereEnd = end ? `ts <= strptime('${toIsoMinute(end).replace('T', ' ')}', ['%Y-%m-%d %H:%M'])` : '1=1';

      const tExpr = sqlNum('"' + tempCol.replace(/"/g, '""') + '"');
      const feelExpr = feelCol ? sqlNum('"' + feelCol.replace(/"/g, '""') + '"') : 'NULL';

      const sql = `
        WITH src AS (
          SELECT * FROM read_parquet(${arr}, union_by_name=true)
        ),
        casted AS (
          SELECT ts,
            ${tExpr} AS t,
            ${feelExpr} AS tf
          FROM src
          WHERE ts IS NOT NULL AND ${whereStart} AND ${whereEnd}
        ),
        daily AS (
          SELECT
            date_trunc('day', ts) AS d,
            max(t) AS tmax,
            min(t) AS tmin,
            avg(t) AS tavg,
            max(tf) AS tfmax,
            min(tf) AS tfmin
          FROM casted
          GROUP BY 1
        )
        SELECT strftime(d, '%Y-%m-%d') AS day,
          tmax, tmin, tavg,
          tfmax, tfmin
        FROM daily
        ORDER BY day;
      `;

      const reader = await conn.runAndReadAll(sql);
      return reader.getRowObjects() as Array<{ day: string; tmax: number | null; tmin: number | null; tavg: number | null; tfmax: number | null; tfmin: number | null; }>;
    });

    // Compute stats from daily rows
    let tMax = -Infinity, tMaxDate: string | null = null;
    let tMin = Infinity, tMinDate: string | null = null;
    let tAvgSum = 0, tAvgCnt = 0;
    const over30: { date: string; value: number }[] = [];
    const under0: { date: string; value: number }[] = [];
    for (const r of days) {
      const d = r.day;
      const tx = typeof r.tmax === 'number' && Number.isFinite(r.tmax) ? r.tmax : null;
      const tn = typeof r.tmin === 'number' && Number.isFinite(r.tmin) ? r.tmin : null;
      const ta = typeof r.tavg === 'number' && Number.isFinite(r.tavg) ? r.tavg : null;
      if (tx !== null) { if (tx > tMax) { tMax = tx; tMaxDate = d; } if (tx > 30) over30.push({ date: d, value: tx }); }
      if (tn !== null) { if (tn < tMin) { tMin = tn; tMinDate = d; } if (tn < 0) under0.push({ date: d, value: tn }); }
      if (ta !== null) { tAvgSum += ta; tAvgCnt++; }
    }
    const temp = {
      max: Number.isFinite(tMax) ? tMax : null,
      maxDate: tMaxDate,
      min: Number.isFinite(tMin) ? tMin : null,
      minDate: tMinDate,
      avg: tAvgCnt > 0 ? tAvgSum / tAvgCnt : null,
      over30: { count: over30.length, items: over30 },
      over25: { count: days.filter(d => typeof d.tmax === 'number' && (d.tmax as number) > 25).length, items: days.filter(d => typeof d.tmax === 'number' && (d.tmax as number) > 25).map(d => ({ date: d.day, value: d.tmax as number })) },
      over20: { count: days.filter(d => typeof d.tmax === 'number' && (d.tmax as number) > 20).length, items: days.filter(d => typeof d.tmax === 'number' && (d.tmax as number) > 20).map(d => ({ date: d.day, value: d.tmax as number })) },
      under0: { count: under0.length, items: under0 },
      under10: { count: days.filter(d => typeof d.tmin === 'number' && (d.tmin as number) <= -10).length, items: days.filter(d => typeof d.tmin === 'number' && (d.tmin as number) <= -10).map(d => ({ date: d.day, value: d.tmin as number })) },
    };

    // Feels-like optional
    let feelMax: number | null = null, feelMaxDate: string | null = null;
    let feelMin: number | null = null, feelMinDate: string | null = null;
    if (days.some(d => d.tfmax != null || d.tfmin != null)) {
      for (const r of days) {
        const d = r.day;
        const fx = typeof r.tfmax === 'number' && Number.isFinite(r.tfmax) ? r.tfmax : null;
        const fn = typeof r.tfmin === 'number' && Number.isFinite(r.tfmin) ? r.tfmin : null;
        if (fx !== null && (feelMax == null || fx > (feelMax as number))) { feelMax = fx; feelMaxDate = d; }
        if (fn !== null && (feelMin == null || fn < (feelMin as number))) { feelMin = fn; feelMinDate = d; }
      }
    }

    const totalPeriodDays = Math.floor((end!.getTime() - start!.getTime()) / (24 * 60 * 60 * 1000)) + 1;

    return NextResponse.json({ ok: true, ch, start: toIsoMinute(start!), end: toIsoMinute(end!), totalPeriodDays, days, stats: { temp, feels: { max: feelMax, maxDate: feelMaxDate, min: feelMin, minDate: feelMinDate } } });
  } catch (e: any) {
    console.error("[statistics/channels] GET error:", e?.message || e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

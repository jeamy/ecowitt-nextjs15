import path from "path";
import { promises as fs } from "fs";
import { getDuckConn } from "@/lib/db/duckdb";
import { ensureMainParquetsInRange } from "@/lib/db/ingest";
import { discoverMainColumns, sqlNum, speedExprFor } from "@/lib/data/columns";
import type { StatisticsPayload, YearStats, MonthStats } from "@/types/statistics";

const DATA_DIR = path.join(process.cwd(), "data");
const STATS_PATH = path.join(DATA_DIR, "statistics.json");

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function getDailySeries(year?: number) {
  const parquetFiles = await ensureMainParquetsInRange();
  const rows = await queryDailyAggregates(parquetFiles);
  if (!year) return rows;
  const y = String(year);
  return rows.filter((r: any) => typeof r.day === 'string' && r.day.startsWith(y));
}

/** Daily aggregate row shape returned by range queries */
export interface DailyAggregateRow {
  day: string; // YYYY-MM-DD
  tmax: number | null;
  tmin: number | null;
  tavg: number | null;
  rain_day: number | null;
  wind_max: number | null;
  gust_max: number | null;
  wind_avg: number | null;
  tfmax?: number | null;
  tfmin?: number | null;
}

async function queryDailyAggregates(parquetFiles: string[]) {
  if (!parquetFiles.length) return [] as any[];
  const conn = await getDuckConn();
  const qp = parquetFiles.map((p) => p.replace(/\\/g, "/"));
  const cols = await discoverMainColumns(qp);
  if (!cols.temp) throw new Error("Could not detect outdoor temperature column in main dataset");

  // Read all Parquets in one scan with union_by_name to avoid schema/order mismatches across months
  const arr = '[' + qp.map((p) => `'${p}'`).join(',') + ']';

  // Build COALESCE over all candidate temperature columns for robustness across months
  const mergedTempCandidates = [
    ...(cols.tempCandidates || []),
    ...(cols.dewCandidates || []),
    ...(cols.feelsLikeCandidates || []),
  ];
  if (cols.temp && !mergedTempCandidates.includes(cols.temp)) mergedTempCandidates.unshift(cols.temp);
  if (cols.dew && !mergedTempCandidates.includes(cols.dew)) mergedTempCandidates.push(cols.dew);
  if (cols.feelsLike && !mergedTempCandidates.includes(cols.feelsLike)) mergedTempCandidates.push(cols.feelsLike);
  const tempExprList = (mergedTempCandidates.length ? mergedTempCandidates : (cols.temp ? [cols.temp] : []))
    .map((c) => sqlNum('"' + String(c).replace(/"/g, '""') + '"'));
  const tExpr = tempExprList.length ? `COALESCE(${tempExprList.join(', ')})` : 'NULL';
  // Feels-like expression (optional)
  const feelsList = (cols.feelsLikeCandidates && cols.feelsLikeCandidates.length ? cols.feelsLikeCandidates : (cols.feelsLike ? [cols.feelsLike] : []))
    .map((c) => sqlNum('"' + String(c).replace(/"/g, '""') + '"'));
  const feelsExpr = feelsList.length ? `COALESCE(${feelsList.join(', ')})` : 'NULL';
  // Build rain expressions per family to support fallback (daily cumulative vs hourly/generic sums)
  const rainDailyExprList = (cols.dailyRainCandidates.length ? cols.dailyRainCandidates : [])
    .map((c) => sqlNum('"' + String(c).replace(/"/g, '""') + '"'));
  const rainHourlyExprList = (cols.hourlyRainCandidates.length ? cols.hourlyRainCandidates : [])
    .map((c) => sqlNum('"' + String(c).replace(/"/g, '""') + '"'));
  const rainGenericExprList = (cols.genericRainCandidates.length ? cols.genericRainCandidates : [])
    .map((c) => sqlNum('"' + String(c).replace(/"/g, '""') + '"'));
  const rainDailyExpr = rainDailyExprList.length ? `COALESCE(${rainDailyExprList.join(', ')})` : 'NULL';
  const rainHourlyExpr = rainHourlyExprList.length ? `COALESCE(${rainHourlyExprList.join(', ')})` : 'NULL';
  const rainGenericExpr = rainGenericExprList.length ? `COALESCE(${rainGenericExprList.join(', ')})` : 'NULL';
  const windExprList = (cols.windCandidates && cols.windCandidates.length ? cols.windCandidates : (cols.wind ? [cols.wind] : []))
    .map((c) => speedExprFor(c));
  const gustExprList = (cols.gustCandidates && cols.gustCandidates.length ? cols.gustCandidates : (cols.gust ? [cols.gust] : []))
    .map((c) => speedExprFor(c));
  const windExpr = windExprList.length ? `COALESCE(${windExprList.join(', ')})` : 'NULL';
  const gustExpr = gustExprList.length ? `COALESCE(${gustExprList.join(', ')})` : 'NULL';
  const rainAgg = cols.rainMode === "daily" ? "max(rain_day)" : "sum(rain_day)";

  const sql = `
    WITH src AS (
      SELECT * FROM read_parquet(${arr}, union_by_name=true)
    ),
    casted AS (
      SELECT ts,
        ${tExpr} AS t,
        ${feelsExpr} AS tf,
        ${rainDailyExpr} AS rain_d,
        ${rainHourlyExpr} AS rain_h,
        ${rainGenericExpr} AS rain_g,
        ${windExpr} AS wind,
        ${gustExpr} AS gust
      FROM src
      WHERE ts IS NOT NULL
    ),
    daily AS (
      SELECT
        date_trunc('day', ts) + INTERVAL '12 hours' AS d,
        max(t) AS tmax,
        min(t) AS tmin,
        avg(t) AS tavg,
        max(tf) AS tfmax,
        min(tf) AS tfmin,
        max(rain_d) AS rdaily,
        sum(rain_h) AS rhourly,
        sum(rain_g) AS rgeneric,
        max(wind) AS wind_max,
        max(gust) AS gust_max,
        avg(wind) AS wind_avg
      FROM casted
      GROUP BY 1
    )
    SELECT strftime(d, '%Y-%m-%d %H:%M:%S') AS day,
      tmax, tmin, tavg,
      tfmax, tfmin,
      COALESCE(rdaily, rhourly, rgeneric) AS rain_day,
      wind_max, gust_max, wind_avg
    FROM daily
    ORDER BY day;
  `;

  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjects();
}

/** Query daily aggregates for a specific time range (inclusive) */
export async function queryDailyAggregatesInRange(
  parquetFiles: string[],
  start?: Date,
  end?: Date
): Promise<DailyAggregateRow[]> {
  if (!parquetFiles.length) return [] as any[];
  const conn = await getDuckConn();
  const qp = parquetFiles.map((p) => p.replace(/\\/g, "/"));
  const cols = await discoverMainColumns(qp);
  if (!cols.temp) throw new Error("Could not detect outdoor temperature column in main dataset");

  const arr = '[' + qp.map((p) => `'${p}'`).join(',') + ']';

  const mergedTempCandidates = [
    ...(cols.tempCandidates || []),
    ...(cols.dewCandidates || []),
    ...(cols.feelsLikeCandidates || []),
  ];
  if (cols.temp && !mergedTempCandidates.includes(cols.temp)) mergedTempCandidates.unshift(cols.temp);
  if (cols.dew && !mergedTempCandidates.includes(cols.dew)) mergedTempCandidates.push(cols.dew);
  if (cols.feelsLike && !mergedTempCandidates.includes(cols.feelsLike)) mergedTempCandidates.push(cols.feelsLike);
  const tempExprList = (mergedTempCandidates.length ? mergedTempCandidates : (cols.temp ? [cols.temp] : []))
    .map((c) => sqlNum('"' + String(c).replace(/"/g, '""') + '"'));
  const tExpr = tempExprList.length ? `COALESCE(${tempExprList.join(', ')})` : 'NULL';
  
  // Feels-like expression (optional)
  const feelsList = (cols.feelsLikeCandidates && cols.feelsLikeCandidates.length ? cols.feelsLikeCandidates : (cols.feelsLike ? [cols.feelsLike] : []))
    .map((c) => sqlNum('"' + String(c).replace(/"/g, '""') + '"'));
  const feelsExpr = feelsList.length ? `COALESCE(${feelsList.join(', ')})` : 'NULL';

  const rainDailyExprList = (cols.dailyRainCandidates.length ? cols.dailyRainCandidates : [])
    .map((c) => sqlNum('"' + String(c).replace(/"/g, '""') + '"'));
  const rainHourlyExprList = (cols.hourlyRainCandidates.length ? cols.hourlyRainCandidates : [])
    .map((c) => sqlNum('"' + String(c).replace(/"/g, '""') + '"'));
  const rainGenericExprList = (cols.genericRainCandidates.length ? cols.genericRainCandidates : [])
    .map((c) => sqlNum('"' + String(c).replace(/"/g, '""') + '"'));
  const rainDailyExpr = rainDailyExprList.length ? `COALESCE(${rainDailyExprList.join(', ')})` : 'NULL';
  const rainHourlyExpr = rainHourlyExprList.length ? `COALESCE(${rainHourlyExprList.join(', ')})` : 'NULL';
  const rainGenericExpr = rainGenericExprList.length ? `COALESCE(${rainGenericExprList.join(', ')})` : 'NULL';
  const windExprList = (cols.windCandidates && cols.windCandidates.length ? cols.windCandidates : (cols.wind ? [cols.wind] : []))
    .map((c) => speedExprFor(c));
  const gustExprList = (cols.gustCandidates && cols.gustCandidates.length ? cols.gustCandidates : (cols.gust ? [cols.gust] : []))
    .map((c) => speedExprFor(c));
  const windExpr = windExprList.length ? `COALESCE(${windExprList.join(', ')})` : 'NULL';
  const gustExpr = gustExprList.length ? `COALESCE(${gustExprList.join(', ')})` : 'NULL';

  const whereStart = start ? `ts >= strptime('${formatDuck(start)}', ['%Y-%m-%d %H:%M'])` : '1=1';
  const whereEnd = end ? `ts <= strptime('${formatDuck(end)}', ['%Y-%m-%d %H:%M'])` : '1=1';

  const sql = `
    WITH src AS (
      SELECT * FROM read_parquet(${arr}, union_by_name=true)
    ),
    casted AS (
      SELECT ts,
        ${tExpr} AS t,
        ${feelsExpr} AS tf,
        ${rainDailyExpr} AS rain_d,
        ${rainHourlyExpr} AS rain_h,
        ${rainGenericExpr} AS rain_g,
        ${windExpr} AS wind,
        ${gustExpr} AS gust
      FROM src
      WHERE ts IS NOT NULL AND ${whereStart} AND ${whereEnd}
    ),
    daily AS (
      SELECT
        date_trunc('day', ts) + INTERVAL '12 hours' AS d,
        max(t) AS tmax,
        min(t) AS tmin,
        avg(t) AS tavg,
        max(tf) AS tfmax,
        min(tf) AS tfmin,
        max(rain_d) AS rdaily,
        sum(rain_h) AS rhourly,
        sum(rain_g) AS rgeneric,
        max(wind) AS wind_max,
        max(gust) AS gust_max,
        avg(wind) AS wind_avg
      FROM casted
      GROUP BY 1
    )
    SELECT strftime(d, '%Y-%m-%d %H:%M:%S') AS day,
      tmax, tmin, tavg,
      tfmax, tfmin,
      COALESCE(rdaily, rhourly, rgeneric) AS rain_day,
      wind_max, gust_max, wind_avg
    FROM daily
    ORDER BY day;
  `;

  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjects() as unknown as DailyAggregateRow[];
}

function formatDuck(d: Date) {
  const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function computeStatsFromDaily(rows: DailyAggregateRow[]): {
  temp: YearStats["temperature"]; rain: YearStats["precipitation"]; wind: YearStats["wind"]; feels?: { max: number | null; maxDate: string | null; min: number | null; minDate: string | null }; rainDays: number;
} {
  const toNum = (v: any): number | null => {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim().replace('−', '-').replace(',', '.').replace(/[^0-9+\-\.]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  let tMax = Number.NEGATIVE_INFINITY; let tMaxDate: string | null = null;
  let tMin = Number.POSITIVE_INFINITY; let tMinDate: string | null = null;
  let tAvgSum = 0; let tAvgCnt = 0;
  const over30: { date: string; value: number }[] = [];
  const over25: { date: string; value: number }[] = [];
  const over20: { date: string; value: number }[] = [];
  const under0: { date: string; value: number }[] = [];
  const under10: { date: string; value: number }[] = [];

  let rainTotal = 0; let rainCnt = 0; let rainMax = Number.NEGATIVE_INFINITY; let rainMaxDate: string | null = null;
  let rainMin = Number.POSITIVE_INFINITY; let rainMinDate: string | null = null;
  const rainOver20: { date: string; value: number }[] = [];
  const rainOver30: { date: string; value: number }[] = [];
  let rainDays = 0;

  let windMax = Number.NEGATIVE_INFINITY; let windMaxDate: string | null = null;
  let gustMax = Number.NEGATIVE_INFINITY; let gustMaxDate: string | null = null;
  let windAvgSum = 0; let windAvgCnt = 0;

  let feltMax = Number.NEGATIVE_INFINITY; let feltMaxDate: string | null = null;
  let feltMin = Number.POSITIVE_INFINITY; let feltMinDate: string | null = null;

  for (const r of rows) {
    const d = r.day;
    const tx = toNum(r.tmax);
    const tn = toNum(r.tmin);
    const ta = toNum(r.tavg);
    if (tx !== null) {
      if (tx > tMax) { tMax = tx; tMaxDate = d; }
      if (tx > 30) over30.push({ date: d, value: tx });
      if (tx > 25) over25.push({ date: d, value: tx });
      if (tx > 20) over20.push({ date: d, value: tx });
    }
    if (tn !== null) {
      if (tn < tMin) { tMin = tn; tMinDate = d; }
      if (tn < 0) under0.push({ date: d, value: tn });
      if (tn <= -10) under10.push({ date: d, value: tn });
    }
    if (ta !== null) { tAvgSum += ta; tAvgCnt++; }

    const rd = toNum(r.rain_day);
    if (rd !== null && Number.isFinite(rd)) {
      rainCnt++;
      if (rd > 0) rainDays++;
      rainTotal += rd;
      if (rd > rainMax) { rainMax = rd; rainMaxDate = d; }
      if (rd < rainMin) { rainMin = rd; rainMinDate = d; }
      if (rd >= 20) rainOver20.push({ date: d, value: rd });
      if (rd >= 30) rainOver30.push({ date: d, value: rd });
    }

    const wmx = toNum(r.wind_max);
    const gmx = toNum(r.gust_max);
    const wav = toNum(r.wind_avg);
    if (wmx !== null && wmx > windMax) { windMax = wmx; windMaxDate = d; }
    if (gmx !== null && gmx > gustMax) { gustMax = gmx; gustMaxDate = d; }
    if (wav !== null) { windAvgSum += wav; windAvgCnt++; }

    const fmx = toNum((r as any).tfmax);
    const fmn = toNum((r as any).tfmin);
    if (fmx !== null && fmx > feltMax) { feltMax = fmx; feltMaxDate = d; }
    if (fmn !== null && fmn < feltMin) { feltMin = fmn; feltMinDate = d; }
  }

  const temp = {
    max: Number.isFinite(tMax) ? tMax : null,
    maxDate: tMaxDate,
    min: Number.isFinite(tMin) ? tMin : null,
    minDate: tMinDate,
    avg: tAvgCnt > 0 ? tAvgSum / tAvgCnt : null,
    over30: { count: over30.length, items: over30 },
    over25: { count: over25.length, items: over25 },
    over20: { count: over20.length, items: over20 },
    under0: { count: under0.length, items: under0 },
    under10: { count: under10.length, items: under10 },
  } as YearStats["temperature"];

  const rain = {
    total: rainCnt > 0 && Number.isFinite(rainTotal) ? rainTotal : null,
    maxDay: rainCnt > 0 && Number.isFinite(rainMax) ? rainMax : null,
    maxDayDate: rainCnt > 0 ? rainMaxDate : null,
    minDay: rainCnt > 0 && Number.isFinite(rainMin) ? rainMin : null,
    minDayDate: rainCnt > 0 ? rainMinDate : null,
    over20mm: { count: rainOver20.length, items: rainOver20 },
    over30mm: { count: rainOver30.length, items: rainOver30 },
  } as YearStats["precipitation"];

  const wind = {
    max: Number.isFinite(windMax) ? windMax : null,
    maxDate: windMaxDate,
    gustMax: Number.isFinite(gustMax) ? gustMax : null,
    gustMaxDate: gustMaxDate,
    avg: windAvgCnt > 0 ? windAvgSum / windAvgCnt : null,
  } as YearStats["wind"];

  const feels = (Number.isFinite(feltMax) || Number.isFinite(feltMin)) ? {
    max: Number.isFinite(feltMax) ? feltMax : null,
    maxDate: feltMaxDate,
    min: Number.isFinite(feltMin) ? feltMin : null,
    minDate: feltMinDate,
  } : undefined;

  return { temp, rain, wind, feels, rainDays };
}

function buildYearAndMonthStats(rows: any[]): StatisticsPayload {
  interface DayRow {
    day: string; // YYYY-MM-DD
    tmax: number | null;
    tmin: number | null;
    tavg: number | null;
    rain_day: number | null;
    wind_max: number | null;
    gust_max: number | null;
    wind_avg: number | null;
  }
  const days: DayRow[] = rows.map((r: any) => ({
    day: String(r.day),
    tmax: r.tmax ?? null,
    tmin: r.tmin ?? null,
    tavg: r.tavg ?? null,
    rain_day: r.rain_day ?? null,
    wind_max: r.wind_max ?? null,
    gust_max: r.gust_max ?? null,
    wind_avg: r.wind_avg ?? null,
  }));

  const byYear = new Map<number, DayRow[]>();
  for (const d of days) {
    if (!d.day || typeof d.day !== "string" || d.day.length < 10) continue;
    const y = Number(d.day.slice(0, 4));
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(d);
  }

  const years: YearStats[] = [];

  const toNum = (v: any): number | null => {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim().replace('−', '-').replace(',', '.').replace(/[^0-9+\-\.]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const computeBlock = (rows: DayRow[]): { temp: YearStats["temperature"], rain: YearStats["precipitation"], wind: YearStats["wind"] } => {
    let tMax = Number.NEGATIVE_INFINITY;
    let tMaxDate: string | null = null;
    let tMin = Number.POSITIVE_INFINITY;
    let tMinDate: string | null = null;
    let tAvgSum = 0;
    let tAvgCnt = 0;
    const over30: { date: string; value: number }[] = [];
    const over25: { date: string; value: number }[] = [];
    const over20: { date: string; value: number }[] = [];
    const under0: { date: string; value: number }[] = [];
    const under10: { date: string; value: number }[] = [];

    let rainTotal = 0;
    let rainCnt = 0;
    let rainMax = Number.NEGATIVE_INFINITY; let rainMaxDate: string | null = null;
    let rainMin = Number.POSITIVE_INFINITY; let rainMinDate: string | null = null;
    const rainOver20: { date: string; value: number }[] = [];
    const rainOver30: { date: string; value: number }[] = [];

    let windMax = Number.NEGATIVE_INFINITY; let windMaxDate: string | null = null;
    let gustMax = Number.NEGATIVE_INFINITY; let gustMaxDate: string | null = null;
    let windAvgSum = 0; let windAvgCnt = 0;

    for (const r of rows) {
      const d = r.day;
      const tx = toNum(r.tmax);
      const tn = toNum(r.tmin);
      const ta = toNum(r.tavg);

      if (tx !== null) {
        if (tx > tMax) { tMax = tx; tMaxDate = d; }
        if (tx > 30) over30.push({ date: d, value: tx });
        if (tx > 25) over25.push({ date: d, value: tx });
        if (tx > 20) over20.push({ date: d, value: tx });
      }
      if (tn !== null) {
        if (tn < tMin) { tMin = tn; tMinDate = d; }
        if (tn < 0) under0.push({ date: d, value: tn });
        if (tn <= -10) under10.push({ date: d, value: tn });
      }
      if (ta !== null) { tAvgSum += ta; tAvgCnt++; }

      const rd = toNum(r.rain_day);
      if (rd !== null && Number.isFinite(rd)) {
        rainCnt++;
        rainTotal += rd;
        if (rd > rainMax) { rainMax = rd; rainMaxDate = d; }
        if (rd < rainMin) { rainMin = rd; rainMinDate = d; }
        if (rd >= 20) rainOver20.push({ date: d, value: rd });
        if (rd >= 30) rainOver30.push({ date: d, value: rd });
      }

      const wmx = toNum(r.wind_max);
      const gmx = toNum(r.gust_max);
      const wav = toNum(r.wind_avg);
      if (wmx !== null && wmx > windMax) { windMax = wmx; windMaxDate = d; }
      if (gmx !== null && gmx > gustMax) { gustMax = gmx; gustMaxDate = d; }
      if (wav !== null) { windAvgSum += wav; windAvgCnt++; }
    }

    const temp = {
      max: Number.isFinite(tMax) ? tMax : null,
      maxDate: tMaxDate,
      min: Number.isFinite(tMin) ? tMin : null,
      minDate: tMinDate,
      avg: tAvgCnt > 0 ? tAvgSum / tAvgCnt : null,
      over30: { count: over30.length, items: over30 },
      over25: { count: over25.length, items: over25 },
      over20: { count: over20.length, items: over20 },
      under0: { count: under0.length, items: under0 },
      under10: { count: under10.length, items: under10 },
    } as YearStats["temperature"];

    const rain = {
      total: rainCnt > 0 && Number.isFinite(rainTotal) ? rainTotal : null,
      maxDay: rainCnt > 0 && Number.isFinite(rainMax) ? rainMax : null,
      maxDayDate: rainCnt > 0 ? rainMaxDate : null,
      minDay: rainCnt > 0 && Number.isFinite(rainMin) ? rainMin : null,
      minDayDate: rainCnt > 0 ? rainMinDate : null,
      over20mm: { count: rainOver20.length, items: rainOver20 },
      over30mm: { count: rainOver30.length, items: rainOver30 },
    } as YearStats["precipitation"];

    const wind = {
      max: Number.isFinite(windMax) ? windMax : null,
      maxDate: windMaxDate,
      gustMax: Number.isFinite(gustMax) ? gustMax : null,
      gustMaxDate: gustMaxDate,
      avg: windAvgCnt > 0 ? windAvgSum / windAvgCnt : null,
    } as YearStats["wind"];

    return { temp, rain, wind };
  };

  for (const [year, list] of Array.from(byYear.entries()).sort((a, b) => b[0] - a[0])) {
    const { temp, rain, wind } = computeBlock(list);

    // Months
    const monthsMap = new Map<number, DayRow[]>();
    for (const r of list) {
      const m = Number(r.day.slice(5, 7));
      if (!monthsMap.has(m)) monthsMap.set(m, []);
      monthsMap.get(m)!.push(r);
    }
    const months: MonthStats[] = [];
    for (const [month, rowsM] of Array.from(monthsMap.entries()).sort((a, b) => a[0] - b[0])) {
      const { temp: tempM, rain: rainM, wind: windM } = computeBlock(rowsM);
      months.push({ year, month, temperature: tempM, precipitation: rainM, wind: windM });
    }

    years.push({ year, temperature: temp, precipitation: rain, wind, months });
  }

  return { updatedAt: new Date().toISOString(), years };
}

export async function computeStatistics(): Promise<StatisticsPayload> {
  const parquetFiles = await ensureMainParquetsInRange();
  if (!parquetFiles.length) throw new Error("No main Parquet files found to compute statistics");
  const rows = await queryDailyAggregates(parquetFiles);
  return buildYearAndMonthStats(rows);
}

export async function readStatistics(): Promise<StatisticsPayload | null> {
  try {
    const txt = await fs.readFile(STATS_PATH, "utf8");
    return JSON.parse(txt) as StatisticsPayload;
  } catch {
    return null;
  }
}

export async function writeStatistics(stats: StatisticsPayload): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(STATS_PATH, JSON.stringify(stats, null, 2), "utf8");
}

export async function updateStatistics(): Promise<StatisticsPayload> {
  const stats = await computeStatistics();
  await writeStatistics(stats);
  return stats;
}

export async function updateStatisticsIfNeeded(maxAgeMs = 24 * 60 * 60 * 1000): Promise<StatisticsPayload> {
  const existing = await readStatistics();
  if (existing && existing.updatedAt) {
    const age = Date.now() - new Date(existing.updatedAt).getTime();
    if (age < maxAgeMs) return existing;
  }
  return updateStatistics();
}

export async function getStatisticsMeta() {
  const parquetFiles = await ensureMainParquetsInRange();
  const qp = parquetFiles.map((p) => p.replace(/\\/g, "/"));
  const cols = await discoverMainColumns(qp);
  return {
    parquetCount: qp.length,
    columns: {
      temperature: cols.temp,
      rain: cols.rainDay,
      rainMode: cols.rainMode,
      wind: cols.wind,
      gust: cols.gust,
    },
  };
}

export async function getDailyDebug(year?: number) {
  const parquetFiles = await ensureMainParquetsInRange();
  const rows = await queryDailyAggregates(parquetFiles);
  const list = year ? rows.filter((r: any) => typeof r.day === 'string' && r.day.startsWith(String(year))) : rows;
  const totalDays = list.length;
  let daysWithTemp = 0;
  let daysWithRain = 0;
  let tminOverall = Number.POSITIVE_INFINITY;
  let tminDate: string | null = null;
  for (const r of list) {
    const tmin = Number.isFinite(r.tmin as any) ? Number(r.tmin) : null;
    const tmax = Number.isFinite(r.tmax as any) ? Number(r.tmax) : null;
    const rain = Number.isFinite(r.rain_day as any) ? Number(r.rain_day) : null;
    if (tmin !== null || tmax !== null) daysWithTemp++;
    if (rain !== null) daysWithRain++;
    if (tmin !== null && tmin < tminOverall) { tminOverall = tmin; tminDate = r.day; }
  }
  const first = list.slice(0, 5);
  const last = list.slice(Math.max(0, list.length - 5));
  return {
    year: year || null,
    totalDays,
    daysWithTemp,
    daysWithRain,
    tminOverall: Number.isFinite(tminOverall) ? tminOverall : null,
    tminDate,
    sample: { first, last },
  };
}

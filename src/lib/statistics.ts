import path from "path";
import { promises as fs } from "fs";
import { getDuckConn } from "@/lib/db/duckdb";
import { ensureMainParquetsInRange } from "@/lib/db/ingest";
import type { StatisticsPayload, YearStats, MonthStats } from "@/types/statistics";

const DATA_DIR = path.join(process.cwd(), "data");
const STATS_PATH = path.join(DATA_DIR, "statistics.json");

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

type RainMode = "daily" | "sum"; // 'sum' for hourly/generic accumulation

interface ColumnMap {
  temp: string | null;
  rainDay: string | null;
  rainMode: RainMode;
  dailyRainCandidates: string[];
  hourlyRainCandidates: string[];
  genericRainCandidates: string[];
  wind: string | null;
  gust: string | null;
}

async function discoverMainColumns(parquets: string[]): Promise<ColumnMap> {
  const conn = await getDuckConn();
  const arr = '[' + parquets.map(p => `'${p.replace(/\\/g, "/")}'`).join(',') + ']';
  const sql = `DESCRIBE SELECT * FROM read_parquet(${arr}, union_by_name=true)`;
  const reader = await conn.runAndReadAll(sql);
  const cols: any[] = reader.getRowObjects();
  const names = cols.map((r: any) => String(r.column_name || r.ColumnName || r.column || ""));
  const normEntries = names.map((n) => ({ n, k: normalizeName(n) }));

  const pick = (preds: RegExp[]): string | null => {
    for (const { n, k } of normEntries) {
      if (preds.some((rx) => rx.test(k))) return n;
    }
    return null;
  };

  // Prefer outdoor temperature column
  const temp = pick([
    /temperatur[aä]uss(en)?/,
    /outdoor.*temp/,
    /outside.*temp/,
    /^temp(erature)?a(o|u)ssen/,
    /^temperatur.*a(o|u)ssen/,
    /^temperatur/,
  ]) || (names.includes("Temperatur Aussen(℃)") ? "Temperatur Aussen(℃)" : null);

  // Rain selection aligned with Dashboard pickRain():
  // Prefer daily cumulative ("tag"/"daily"/"24h"); then hourly; then generic (exclude rate/year/month/week)
  let rainCol: string | null = null;
  let rainMode: RainMode = "sum";
  const dailyRainCandidates: string[] = [];
  const hourlyRainCandidates: string[] = [];
  const genericRainCandidates: string[] = [];
  const isRainish = (k: string) => k.includes("rain") || k.includes("regen") || k.includes("niederschlag") || k.includes("rainfall");
  const hasAny = (k: string, arr: string[]) => arr.some((tok) => k.includes(tok));
  const dailyTokens = ["daily", "tag", "24h", "24", "today", "heute", "tages", "tagesgesamt", "tagessumme"];
  const hourlyTokens = ["hour", "stunde", "hourly"];
  const excludeTokens = ["rate", "year", "jahr", "month", "monat", "week", "woche", "weekly", "monthly", "yearly"];

  // daily
  for (const { n, k } of normEntries) {
    if (!isRainish(k)) continue;
    if (!hasAny(k, dailyTokens)) continue;
    if (hasAny(k, excludeTokens)) continue;
    dailyRainCandidates.push(n);
    if (!rainCol) { rainCol = n; rainMode = "daily"; }
  }
  // hourly
  if (!rainCol) {
    for (const { n, k } of normEntries) {
      if (!isRainish(k)) continue;
      if (!hasAny(k, hourlyTokens)) continue;
      if (k.includes("rate")) continue;
      hourlyRainCandidates.push(n);
      if (!rainCol) { rainCol = n; rainMode = "sum"; }
    }
  }
  // generic
  if (!rainCol) {
    for (const { n, k } of normEntries) {
      if (!isRainish(k)) continue;
      if (hasAny(k, excludeTokens)) continue;
      genericRainCandidates.push(n);
      if (!rainCol) { rainCol = n; rainMode = "sum"; }
    }
  }

  const gust = pick([
    /b[oö]e/, // Böe(km/h)
    /gust/,
  ]) || (names.includes("Böe(km/h)") ? "Böe(km/h)" : null);

  const wind = pick([
    /^wind/,
    /wind\(kmh\)/,
  ]) || (names.includes("Wind(km/h)") ? "Wind(km/h)" : null);

  return { temp, rainDay: rainCol, rainMode, dailyRainCandidates, hourlyRainCandidates, genericRainCandidates, wind, gust };
}

function sqlNum(colId: string): string {
  // Robust numeric conversion:
  // - handle ',', '--', '-', 'N/A', '', 'null', 'NaN'
  // - strip units like 'mm', '°C', and any non-numeric chars except sign and dot
  // - trim whitespace
  return `CASE
    WHEN CAST(${colId} AS VARCHAR) IS NULL THEN NULL
    WHEN lower(trim(CAST(${colId} AS VARCHAR))) IN ('--','-','n/a','', 'null', 'nan') THEN NULL
    ELSE TRY_CAST(
      REGEXP_REPLACE(
        REPLACE(TRIM(CAST(${colId} AS VARCHAR)), ',', '.'),
        '[^0-9\-\.]+',
        ''
      ) AS DOUBLE
    )
  END`;
}

async function queryDailyAggregates(parquetFiles: string[]) {
  if (!parquetFiles.length) return [] as any[];
  const conn = await getDuckConn();
  const qp = parquetFiles.map((p) => p.replace(/\\/g, "/"));
  const cols = await discoverMainColumns(qp);
  if (!cols.temp) throw new Error("Could not detect outdoor temperature column in main dataset");

  // Read all Parquets in one scan with union_by_name to avoid schema/order mismatches across months
  const arr = '[' + qp.map((p) => `'${p}'`).join(',') + ']';

  const tId = '"' + String(cols.temp).replace(/"/g, '""') + '"';
  // Build COALESCE over all candidate rain columns for robustness across months
  const rainCandidates = cols.rainMode === "daily"
    ? (cols.dailyRainCandidates.length ? cols.dailyRainCandidates : (cols.hourlyRainCandidates.length ? cols.hourlyRainCandidates : cols.genericRainCandidates))
    : (cols.hourlyRainCandidates.length ? cols.hourlyRainCandidates : (cols.genericRainCandidates.length ? cols.genericRainCandidates : cols.dailyRainCandidates));
  const rainExprList = rainCandidates.map((c) => sqlNum('"' + String(c).replace(/"/g, '""') + '"'));
  const rainExpr = rainExprList.length ? `COALESCE(${rainExprList.join(', ')})` : "NULL";
  const windId = cols.wind ? '"' + String(cols.wind).replace(/"/g, '""') + '"' : null;
  const gustId = cols.gust ? '"' + String(cols.gust).replace(/"/g, '""') + '"' : null;

  const tExpr = sqlNum(tId);
  // rainExpr already set above
  const windExpr = windId ? sqlNum(windId) : "NULL";
  const gustExpr = gustId ? sqlNum(gustId) : "NULL";
  const rainAgg = cols.rainMode === "daily" ? "max(rain_day)" : "sum(rain_day)";

  const sql = `
    WITH src AS (
      SELECT * FROM read_parquet(${arr}, union_by_name=true)
    ),
    casted AS (
      SELECT ts,
        ${tExpr} AS t,
        ${rainExpr} AS rain_day,
        ${windExpr} AS wind,
        ${gustExpr} AS gust
      FROM src
      WHERE ts IS NOT NULL
    ),
    daily AS (
      SELECT
        date_trunc('day', ts) AS d,
        max(t) AS tmax,
        min(t) AS tmin,
        avg(t) AS tavg,
        ${rainAgg} AS rain_day,
        max(wind) AS wind_max,
        max(gust) AS gust_max,
        avg(wind) AS wind_avg
      FROM casted
      GROUP BY 1
    )
    SELECT strftime(d, '%Y-%m-%d') AS day,
      tmax, tmin, tavg,
      rain_day,
      wind_max, gust_max, wind_avg
    FROM daily
    ORDER BY day;
  `;

  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjects();
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

  const computeBlock = (rows: DayRow[]): { temp: YearStats["temperature"], rain: YearStats["precipitation"], wind: YearStats["wind"] } => {
    let tMax = Number.NEGATIVE_INFINITY;
    let tMaxDate: string | null = null;
    let tMin = Number.POSITIVE_INFINITY;
    let tMinDate: string | null = null;
    let tAvgSum = 0;
    let tAvgCnt = 0;
    const over30: string[] = [];
    const over25: string[] = [];
    const over20: string[] = [];
    const under0: string[] = [];
    const under10: string[] = [];

    let rainTotal = 0;
    let rainCnt = 0;
    let rainMax = Number.NEGATIVE_INFINITY; let rainMaxDate: string | null = null;
    let rainMin = Number.POSITIVE_INFINITY; let rainMinDate: string | null = null;
    const rainOver20: string[] = [];
    const rainOver30: string[] = [];

    let windMax = Number.NEGATIVE_INFINITY; let windMaxDate: string | null = null;
    let gustMax = Number.NEGATIVE_INFINITY; let gustMaxDate: string | null = null;
    let windAvgSum = 0; let windAvgCnt = 0;

    for (const r of rows) {
      const d = r.day;
      const tx = Number.isFinite(r.tmax as any) ? Number(r.tmax) : null;
      const tn = Number.isFinite(r.tmin as any) ? Number(r.tmin) : null;
      const ta = Number.isFinite(r.tavg as any) ? Number(r.tavg) : null;

      if (tx !== null) {
        if (tx > tMax) { tMax = tx; tMaxDate = d; }
        if (tx > 30) over30.push(d);
        if (tx > 25) over25.push(d);
        if (tx > 20) over20.push(d);
      }
      if (tn !== null) {
        if (tn < tMin) { tMin = tn; tMinDate = d; }
        if (tn < 0) under0.push(d);
        if (tn < -10) under10.push(d);
      }
      if (ta !== null) { tAvgSum += ta; tAvgCnt++; }

      const rd = Number.isFinite(r.rain_day as any) ? Number(r.rain_day) : null;
      if (rd !== null && Number.isFinite(rd)) {
        rainCnt++;
        rainTotal += rd;
        if (rd > rainMax) { rainMax = rd; rainMaxDate = d; }
        if (rd < rainMin) { rainMin = rd; rainMinDate = d; }
        if (rd >= 20) rainOver20.push(d);
        if (rd >= 30) rainOver30.push(d);
      }

      const wmx = Number.isFinite(r.wind_max as any) ? Number(r.wind_max) : null;
      const gmx = Number.isFinite(r.gust_max as any) ? Number(r.gust_max) : null;
      const wav = Number.isFinite(r.wind_avg as any) ? Number(r.wind_avg) : null;
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
      over30: { count: over30.length, dates: over30 },
      over25: { count: over25.length, dates: over25 },
      over20: { count: over20.length, dates: over20 },
      under0: { count: under0.length, dates: under0 },
      under10: { count: under10.length, dates: under10 },
    } as YearStats["temperature"];

    const rain = {
      total: rainCnt > 0 && Number.isFinite(rainTotal) ? rainTotal : null,
      maxDay: rainCnt > 0 && Number.isFinite(rainMax) ? rainMax : null,
      maxDayDate: rainCnt > 0 ? rainMaxDate : null,
      minDay: rainCnt > 0 && Number.isFinite(rainMin) ? rainMin : null,
      minDayDate: rainCnt > 0 ? rainMinDate : null,
      over20mm: { count: rainOver20.length, dates: rainOver20 },
      over30mm: { count: rainOver30.length, dates: rainOver30 },
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

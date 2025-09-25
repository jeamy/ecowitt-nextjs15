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
  // Transliterate common German characters and strip degree symbol before normalizing
  const map: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss" };
  s = s.replace(/[äöüÄÖÜß]/g, (ch) => map[ch] || ch);
  s = s.replace(/°/g, "");
  // Remove other diacritics
  try { s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch {}
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
  tempCandidates: string[];
  windCandidates: string[];
  gustCandidates: string[];
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

  // Prefer outdoor temperature columns (German/English variants) and collect candidates
  // Use normalized keys so that 'Außen/Aussen' both match as 'aussen'
  const tempCandidates: string[] = [];
  let temp: string | null = null;
  for (const { n, k } of normEntries) {
    const isOutdoorTemp = (k.includes("temperatur") && (k.includes("aussen") || k.includes("draussen"))) ||
                          (k.includes("outdoor") && k.includes("temp")) ||
                          (k.includes("outside") && k.includes("temp"));
    if (isOutdoorTemp) {
      tempCandidates.push(n);
      if (!temp) temp = n;
    }
  }
  if (!temp) {
    // Fallback: any 'temperatur' not tagged as indoor/inside
    for (const { n, k } of normEntries) {
      if (k.includes("temperatur") && !(k.includes("innen") || k.includes("indoor") || k.includes("inside"))) {
        temp = n; tempCandidates.push(n); break;
      }
    }
  }
  if (!temp && names.includes("Temperatur Aussen(℃)")) { temp = "Temperatur Aussen(℃)"; tempCandidates.push(temp); }
  if (names.includes("Outdoor Temperature(℃)") && !tempCandidates.includes("Outdoor Temperature(℃)")) tempCandidates.push("Outdoor Temperature(℃)");

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

  // Wind/Gust candidates (exclude direction)
  const windCandidates: string[] = [];
  const gustCandidates: string[] = [];
  let wind: string | null = null;
  let gust: string | null = null;
  for (const { n, k } of normEntries) {
    const isGust = k.includes("gust") || k.includes("boe") || k.includes("b\u00f6e");
    const isWind = k.includes("wind") && !k.includes("direction") && !k.includes("richtung") && !k.includes("dir") && !isGust;
    if (isGust) { gustCandidates.push(n); if (!gust) gust = n; }
    else if (isWind) { windCandidates.push(n); if (!wind) wind = n; }
  }
  if (!wind && names.includes("Wind(km/h)")) { wind = "Wind(km/h)"; windCandidates.push(wind); }
  if (!gust && names.includes("Böe(km/h)")) { gust = "Böe(km/h)"; gustCandidates.push(gust); }

  return { temp, rainDay: rainCol, rainMode, dailyRainCandidates, hourlyRainCandidates, genericRainCandidates, tempCandidates, windCandidates, gustCandidates, wind, gust };
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

  // Build COALESCE over all candidate temperature columns for robustness across months
  const tempExprList = (cols.tempCandidates && cols.tempCandidates.length ? cols.tempCandidates : (cols.temp ? [cols.temp] : []))
    .map((c) => sqlNum('"' + String(c).replace(/"/g, '""') + '"'));
  const tExpr = tempExprList.length ? `COALESCE(${tempExprList.join(', ')})` : 'NULL';
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
  // Wind/Gust with unit conversion (m/s -> km/h)
  const needsMsFactor = (name: string) => /m\/?s/i.test(name) || normalizeName(name).includes("ms");
  const speedExprFor = (name: string) => {
    const q = '"' + String(name).replace(/"/g, '""') + '"';
    const base = sqlNum(q);
    return needsMsFactor(name) ? `(${base}) * 3.6` : base;
  };
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
        date_trunc('day', ts) AS d,
        max(t) AS tmax,
        min(t) AS tmin,
        avg(t) AS tavg,
        max(rain_d) AS rdaily,
        sum(rain_h) AS rhourly,
        sum(rain_g) AS rgeneric,
        max(wind) AS wind_max,
        max(gust) AS gust_max,
        avg(wind) AS wind_avg
      FROM casted
      GROUP BY 1
    )
    SELECT strftime(d, '%Y-%m-%d') AS day,
      tmax, tmin, tavg,
      COALESCE(NULLIF(rdaily, 0), NULLIF(rhourly, 0), rhourly, rgeneric) AS rain_day,
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

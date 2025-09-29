import { getDuckConn } from "@/lib/db/duckdb";

export function normalizeName(s: string): string {
  const map: Record<string, string> = {
    "ä": "ae",
    "ö": "oe",
    "ü": "ue",
    "Ä": "Ae",
    "Ö": "Oe",
    "Ü": "Ue",
    "ß": "ss",
  };
  s = s.replace(/[äöüÄÖÜß]/g, (ch) => map[ch] || ch);
  s = s.replace(/°/g, "");
  try {
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  } catch {}
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type RainMode = "daily" | "sum";

export interface ColumnMap {
  temp: string | null;
  tempCandidates: string[];
  dew: string | null;
  dewCandidates: string[];
  feelsLike: string | null;
  feelsLikeCandidates: string[];
  rainDay: string | null;
  rainMode: RainMode;
  dailyRainCandidates: string[];
  hourlyRainCandidates: string[];
  genericRainCandidates: string[];
  windCandidates: string[];
  gustCandidates: string[];
  wind: string | null;
  gust: string | null;
}

function needsMsFactor(name: string) {
  return /m\/?s/i.test(name) || normalizeName(name).includes("ms");
}

export function sqlNum(colId: string): string {
  return `CASE\n    WHEN CAST(${colId} AS VARCHAR) IS NULL THEN NULL\n    WHEN lower(trim(CAST(${colId} AS VARCHAR))) IN ('--','-','n/a','', 'null', 'nan') THEN NULL\n    ELSE TRY_CAST(\n      REGEXP_REPLACE(\n        REPLACE(REPLACE(TRIM(CAST(${colId} AS VARCHAR)), ',', '.'), '−', '-'),\n        '[^0-9\\\-\\.]+' ,\n        ''\n      ) AS DOUBLE\n    )\n  END`;
}

export function speedExprFor(name: string) {
  const q = '"' + String(name).replace(/"/g, '""') + '"';
  const base = sqlNum(q);
  return needsMsFactor(name) ? `(${base}) * 3.6` : base;
}

export async function discoverMainColumns(parquets: string[]): Promise<ColumnMap> {
  const conn = await getDuckConn();
  const arr = '[' + parquets.map((p) => `'${p.replace(/\\/g, "/")}'`).join(',') + ']';
  const sql = `DESCRIBE SELECT * FROM read_parquet(${arr}, union_by_name=true)`;
  const reader = await conn.runAndReadAll(sql);
  const cols: any[] = reader.getRowObjects();
  const names = cols.map((r: any) => String(r.column_name || r.ColumnName || r.column || ""));
  const normEntries = names.map((n) => ({ n, k: normalizeName(n) }));

  const tempCandidates: string[] = [];
  const dewCandidates: string[] = [];
  const feelsLikeCandidates: string[] = [];
  let temp: string | null = null;
  let dew: string | null = null;
  let feelsLike: string | null = null;
  for (const { n, k } of normEntries) {
    const isOutdoorTemp =
      (k.includes("temperatur") && (k.includes("aussen") || k.includes("draussen"))) ||
      (k.includes("outdoor") && k.includes("temp")) ||
      (k.includes("outside") && k.includes("temp"));
    if (isOutdoorTemp) {
      tempCandidates.push(n);
      if (!temp) temp = n;
    }
  }
  if (!temp) {
    for (const { n, k } of normEntries) {
      if (k.includes("temperatur") && !(k.includes("innen") || k.includes("indoor") || k.includes("inside"))) {
        temp = n;
        tempCandidates.push(n);
        break;
      }
    }
  }
  if (!temp && names.includes("Temperatur Aussen(℃)")) {
    temp = "Temperatur Aussen(℃)";
    tempCandidates.push(temp);
  }
  if (names.includes("Outdoor Temperature(℃)")) {
    const ot = "Outdoor Temperature(℃)";
    const filtered = tempCandidates.filter((c) => c !== ot);
    filtered.unshift(ot);
    tempCandidates.length = 0;
    tempCandidates.push(...filtered);
    temp = ot;
  }

  // Dew point detection (Taupunkt / Dew Point)
  for (const { n, k } of normEntries) {
    const isDew = k.includes("taupunkt") || k.includes("dewpoint") || k.includes("dewtemp");
    if (!isDew) continue;
    dewCandidates.push(n);
    if (!dew) dew = n;
  }
  // Ensure known German/English defaults
  if (!dew && names.includes("Taupunkt(℃)")) {
    dew = "Taupunkt(℃)";
    dewCandidates.push(dew);
  }
  // Only add to candidates if it actually exists in the data
  if (names.includes("Taupunkt(℃)") && !dewCandidates.includes("Taupunkt(℃)")) {
    dewCandidates.push("Taupunkt(℃)");
  }
  if (!dew && names.includes("Dew Point(℃)")) {
    dew = "Dew Point(℃)";
    dewCandidates.push(dew);
  }
  // Only add to candidates if it actually exists in the data
  if (names.includes("Dew Point(℃)") && !dewCandidates.includes("Dew Point(℃)")) {
    dewCandidates.push("Dew Point(℃)");
  }

  // Feels-like detection (Gefühlte Temperatur / Feels Like / Heat Index)
  for (const { n, k } of normEntries) {
    const isFeels = k.includes("gefuhlte") || k.includes("feelslike") || k.includes("heatindex") || k.includes("realfeel");
    if (!isFeels) continue;
    feelsLikeCandidates.push(n);
    if (!feelsLike) feelsLike = n;
  }
  if (!feelsLike && names.includes("Gefühlte Temperatur(℃)")) {
    feelsLike = "Gefühlte Temperatur(℃)";
    feelsLikeCandidates.push(feelsLike);
  }
  // Only add to candidates if it actually exists in the data
  if (names.includes("Gefühlte Temperatur(℃)") && !feelsLikeCandidates.includes("Gefühlte Temperatur(℃)")) {
    feelsLikeCandidates.push("Gefühlte Temperatur(℃)");
  }
  // Check spaced version first since that's what exists in the data
  if (!feelsLike && names.includes("Feels Like (℃)")) {
    feelsLike = "Feels Like (℃)";
    feelsLikeCandidates.push(feelsLike);
  }
  // Only add to candidates if it actually exists in the data
  if (names.includes("Feels Like (℃)") && !feelsLikeCandidates.includes("Feels Like (℃)")) {
    feelsLikeCandidates.push("Feels Like (℃)");
  }
  if (!feelsLike && names.includes("Feels Like(℃)")) {
    feelsLike = "Feels Like(℃)";
    feelsLikeCandidates.push(feelsLike);
  }
  // Only add to candidates if it actually exists in the data
  if (names.includes("Feels Like(℃)") && !feelsLikeCandidates.includes("Feels Like(℃)")) {
    feelsLikeCandidates.push("Feels Like(℃)");
  }
  if (!feelsLike && names.includes("Heat Index(℃)")) {
    feelsLike = "Heat Index(℃)";
    feelsLikeCandidates.push(feelsLike);
  }
  // Only add to candidates if it actually exists in the data
  if (names.includes("Heat Index(℃)") && !feelsLikeCandidates.includes("Heat Index(℃)")) {
    feelsLikeCandidates.push("Heat Index(℃)");
  }

  const isRainish = (k: string) =>
    k.includes("rain") || k.includes("regen") || k.includes("niederschlag") || k.includes("rainfall");
  const hasAny = (k: string, arr: string[]) => arr.some((tok) => k.includes(tok));
  const dailyTokens = ["daily", "tag", "24h", "24", "today", "heute", "tages", "tagesgesamt", "tagessumme"];
  const hourlyTokens = ["hour", "stunde", "hourly"];
  const minuteTokens = ["min", "minute", "minuten", "5min", "5 min", "10min", "10 min", "1min", "1 min"];
  const excludeTokens = ["rate", "year", "jahr", "month", "monat", "week", "woche", "weekly", "monthly", "yearly"];

  let rainCol: string | null = null;
  let rainMode: RainMode = "sum";
  const dailyRainCandidates: string[] = [];
  const hourlyRainCandidates: string[] = [];
  const genericRainCandidates: string[] = [];

  if (names.includes("Daily Rain(mm)")) {
    if (!dailyRainCandidates.includes("Daily Rain(mm)")) dailyRainCandidates.unshift("Daily Rain(mm)");
    if (!rainCol) {
      rainCol = "Daily Rain(mm)";
      rainMode = "daily";
    }
  }
  if (names.includes("Regen/Tag(mm)")) {
    if (!dailyRainCandidates.includes("Regen/Tag(mm)")) dailyRainCandidates.unshift("Regen/Tag(mm)");
    if (!rainCol) {
      rainCol = "Regen/Tag(mm)";
      rainMode = "daily";
    }
  }
  for (const { n, k } of normEntries) {
    if (!isRainish(k)) continue;
    if (!hasAny(k, dailyTokens)) continue;
    if (hasAny(k, excludeTokens)) continue;
    dailyRainCandidates.push(n);
    if (!rainCol) {
      rainCol = n;
      rainMode = "daily";
    }
  }
  if (!rainCol) {
    for (const { n, k } of normEntries) {
      if (!isRainish(k)) continue;
      if (!(hasAny(k, hourlyTokens) || hasAny(k, minuteTokens))) continue;
      if (k.includes("rate")) continue;
      hourlyRainCandidates.push(n);
      if (!rainCol) {
        rainCol = n;
        rainMode = "sum";
      }
    }
  }
  if (!rainCol && names.includes("Regen/Stunde(mm)")) {
    if (!hourlyRainCandidates.includes("Regen/Stunde(mm)")) hourlyRainCandidates.unshift("Regen/Stunde(mm)");
    rainCol = "Regen/Stunde(mm)";
    rainMode = "sum";
  }
  if (!rainCol) {
    for (const { n, k } of normEntries) {
      if (!isRainish(k)) continue;
      if (hasAny(k, excludeTokens)) continue;
      genericRainCandidates.push(n);
      if (!rainCol) {
        rainCol = n;
        rainMode = "sum";
      }
    }
  }

  const windCandidates: string[] = [];
  const gustCandidates: string[] = [];
  let wind: string | null = null;
  let gust: string | null = null;
  for (const { n, k } of normEntries) {
    const isGust = k.includes("gust") || k.includes("boe") || k.includes("böe");
    const isWind = k.includes("wind") && !k.includes("direction") && !k.includes("richtung") && !k.includes("dir") && !isGust;
    if (isGust) {
      gustCandidates.push(n);
      if (!gust) gust = n;
    } else if (isWind) {
      windCandidates.push(n);
      if (!wind) wind = n;
    }
  }
  if (!wind && names.includes("Wind(km/h)")) {
    wind = "Wind(km/h)";
    windCandidates.push(wind);
  }
  if (!gust && names.includes("Böe(km/h)")) {
    gust = "Böe(km/h)";
    gustCandidates.push(gust);
  }


  return {
    temp,
    tempCandidates,
    dew,
    dewCandidates,
    feelsLike,
    feelsLikeCandidates,
    rainDay: rainCol,
    rainMode,
    dailyRainCandidates,
    hourlyRainCandidates,
    genericRainCandidates,
    windCandidates,
    gustCandidates,
    wind,
    gust,
  };
}

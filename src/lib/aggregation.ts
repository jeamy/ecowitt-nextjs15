import { getDuckConn } from "@/lib/db/duckdb";
import { ensureMainParquetsInRange } from "@/lib/db/ingest";

export type Resolution = "minute" | "hour" | "day";

export function parseISODate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function normalizeName(s: string): string {
  const map: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss" };
  s = s.replace(/[äöüÄÖÜß]/g, (ch) => map[ch] || ch);
  s = s.replace(/°/g, "");
  try { s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch {}
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function sqlNum(colId: string): string {
  // Robust numeric conversion similar to src/lib/statistics.ts
  return `CASE
    WHEN CAST(${colId} AS VARCHAR) IS NULL THEN NULL
    WHEN lower(trim(CAST(${colId} AS VARCHAR))) IN ('--','-','n/a','', 'null', 'nan') THEN NULL
    ELSE TRY_CAST(
      REGEXP_REPLACE(
        REPLACE(REPLACE(TRIM(CAST(${colId} AS VARCHAR)), ',', '.'), '−', '-'),
        '[^0-9\-\.]+',
        ''
      ) AS DOUBLE
    )
  END`;
}

export async function describeColumns(parquets: string[]): Promise<string[]> {
  const conn = await getDuckConn();
  const arr = '[' + parquets.map(p => `'${p.replace(/\\/g, "/")}'`).join(',') + ']';
  const sql = `DESCRIBE SELECT * FROM read_parquet(${arr}, union_by_name=true)`;
  const reader = await conn.runAndReadAll(sql);
  const rows: any[] = reader.getRowObjects();
  return rows.map((r) => String(r.column_name || r.ColumnName || r.column || ""));
}

export function findBestColumn(requestKey: string, columns: string[]): string | null {
  const req = normalizeName(requestKey);
  // Exact display-name match first
  if (columns.includes(requestKey)) return requestKey;
  // Normalized contains
  let best: string | null = null;
  for (const c of columns) {
    const k = normalizeName(c);
    if (k.includes(req)) { best = c; break; }
  }
  // Some simple aliases
  if (!best) {
    const aliases: Record<string, string[]> = {
      temp_outdoor: ["outdoor", "aussen", "draussen"],
      temp_indoor: ["indoor", "innen"],
      humidity_outdoor: ["humidity", "feuchte", "outdoor", "aussen"],
      humidity_indoor: ["humidity", "feuchte", "indoor", "innen"],
      wind: ["wind"],
      gust: ["gust", "boe", "b\u00f6e"],
      rain_daily: ["daily", "tag", "24h", "regen", "rain"],
      rain_hourly: ["hour", "stunde", "regen", "rain"],
      pressure_rel: ["pressure", "druck", "rel"],
      pressure_abs: ["pressure", "druck", "abs"],
      solar: ["solar"],
      uv: ["uv"],
    };
    // Dynamic channel mapping: temp_ch1..8, humidity_ch1..8
    const mTemp = req.match(/^tempch(\d{1,2})$/);
    const mHum = req.match(/^humiditych(\d{1,2})$/);
    const channelIdx = mTemp ? mTemp[1] : (mHum ? mHum[1] : null);
    if (channelIdx) {
      const toksBase = mTemp ? ["temp", "temperatur"] : ["humidity", "feuchte"];
      const chToks = [
        `ch${channelIdx}`,
        `kanal${channelIdx}`,
        `channel${channelIdx}`,
      ];
      for (const c of columns) {
        const k = normalizeName(c);
        if (toksBase.some(tb => k.includes(tb)) && chToks.some(ct => k.includes(ct))) {
          best = c; break;
        }
      }
      if (best) return best;
    }
    for (const [key, toks] of Object.entries(aliases)) {
      if (!req.includes(key.replace(/[^a-z0-9]+/g, ""))) continue;
      for (const c of columns) {
        const k = normalizeName(c);
        if (toks.every((t) => k.includes(t))) { best = c; break; }
      }
      if (best) break;
    }
  }
  return best;
}

export async function querySeries({
  start,
  end,
  resolution,
  fields,
}: {
  start: Date;
  end: Date;
  resolution: Resolution;
  fields: string[];
}) {
  const parquetFiles = await ensureMainParquetsInRange();
  if (parquetFiles.length === 0) return { points: [], meta: { fields: [] as string[] } };
  const qp = parquetFiles.map((p) => p.replace(/\\/g, "/"));
  const conn = await getDuckConn();

  // Discover columns and map requested fields -> best columns
  const columns = await describeColumns(qp);
  const mapped: { req: string; col: string }[] = [];
  for (const f of fields) {
    const match = findBestColumn(f, columns);
    if (match) mapped.push({ req: f, col: match });
  }
  if (mapped.length === 0) return { points: [], meta: { fields: [], available: columns } };

  const arr = '[' + qp.map((p) => `'${p}'`).join(',') + ']';
  const resKey = resolution === 'minute' ? 'minute' : resolution === 'hour' ? 'hour' : 'day';

  const casts = mapped
    .map(({ col, req }) => `${sqlNum('"' + col.replace(/"/g, '""') + '"')} AS "${req.replace(/"/g, '""')}"`)
    .join(',\n        ');
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const sql = `
    WITH src AS (
      SELECT ts, ${casts}
      FROM read_parquet(${arr}, union_by_name=true)
      WHERE ts >= TIMESTAMP '${startIso}' AND ts <= TIMESTAMP '${endIso}'
    ),
    grp AS (
      SELECT date_trunc('${resKey}', ts) AS t,
        ${mapped.map(({ req }) => `avg("${req.replace(/"/g, '""')}") AS "${req.replace(/"/g, '""')}"`).join(', ')}
      FROM src
      GROUP BY 1
      ORDER BY 1
    )
    SELECT strftime(t, '%Y-%m-%d %H:%M:%S') AS t,
      ${mapped.map(({ req }) => `"${req.replace(/"/g, '""')}"`).join(', ')}
    FROM grp
    ORDER BY t;
  `;
  const reader = await conn.runAndReadAll(sql);
  const rows = reader.getRowObjects();
  return { points: rows, meta: { fields: mapped.map(m => m.req) } };
}

export async function queryRangeStats({
  start,
  end,
  fields,
}: {
  start: Date;
  end: Date;
  fields: string[];
}) {
  const parquetFiles = await ensureMainParquetsInRange();
  if (parquetFiles.length === 0) return { stats: {}, available: [] as string[] };
  const qp = parquetFiles.map((p) => p.replace(/\\/g, "/"));
  const conn = await getDuckConn();
  const columns = await describeColumns(qp);

  const mapped: { req: string; col: string }[] = [];
  for (const f of fields) {
    const match = findBestColumn(f, columns);
    if (match) mapped.push({ req: f, col: match });
  }
  if (mapped.length === 0) return { stats: {}, available: columns };

  const arr = '[' + qp.map((p) => `'${p}'`).join(',') + ']';
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const casts = mapped
    .map(({ col, req }) => `${sqlNum('"' + col.replace(/"/g, '""') + '"')} AS "${req.replace(/"/g, '""')}"`)
    .join(',\n        ');

  const aggCols = mapped
    .map(({ req }) => `min("${req}") AS "${req}__min", max("${req}") AS "${req}__max", avg("${req}") AS "${req}__avg", sum("${req}") AS "${req}__sum"`)
    .join(',\n        ');

  const sql = `
    WITH src AS (
      SELECT ts, ${casts}
      FROM read_parquet(${arr}, union_by_name=true)
      WHERE ts >= TIMESTAMP '${startIso}' AND ts <= TIMESTAMP '${endIso}'
    )
    SELECT ${aggCols}
    FROM src;
  `;
  const reader = await conn.runAndReadAll(sql);
  const rows = reader.getRowObjects();
  const one = rows[0] || {};
  const coerce = (v: any): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(v as any);
    return Number.isFinite(n) ? n : null;
  };
  const stats: Record<string, { min: number|null; max: number|null; avg: number|null; sum: number|null }> = {};
  for (const m of mapped) {
    stats[m.req] = {
      min: coerce(one[`${m.req}__min`]),
      max: coerce(one[`${m.req}__max`]),
      avg: coerce(one[`${m.req}__avg`]),
      sum: coerce(one[`${m.req}__sum`]),
    };
  }
  return { stats };
}

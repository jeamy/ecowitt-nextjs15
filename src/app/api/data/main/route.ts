import { NextResponse } from "next/server";
import path from "path";
import { readCsvFile, parseCsv, aggregateRows } from "@/lib/csv";
import { getMainFilename, getMainFilesInRange } from "@/lib/files";
import { parseTimestamp, type Resolution } from "@/lib/time";
import { getDuckConn } from "@/lib/db/duckdb";
import { ensureMainParquetForMonth, ensureMainParquetsInRange } from "@/lib/db/ingest";
import { discoverMainColumns, sqlNum, speedExprFor } from "@/lib/data/columns";

export const runtime = "nodejs";

/**
 * API route to get aggregated 'main' sensor data.
 * This function handles GET requests to /api/data/main.
 * It can filter data by month or by a time range, and aggregate it by minute, hour, or day.
 * It first attempts to use a fast path with DuckDB and Parquet files, and falls back to parsing CSV files if that fails.
 *
 * @param {Request} req - The incoming request object.
 * @returns {Promise<NextResponse>} A JSON response containing the aggregated data, or an error message.
 *
 * @example
 * // Get data for a specific month with daily resolution
 * GET /api/data/main?month=202508&resolution=day
 *
 * @example
 * // Get data for a specific time range with hourly resolution
 * GET /api/data/main?start=2025-08-01T00:00:00&end=2025-08-15T23:59:59&resolution=hour
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") || undefined; // e.g., 202508
    const resolution = (searchParams.get("resolution") as Resolution) || "minute";
    const startStr = searchParams.get("start") || undefined; // ISO or YYYY/M/D H:MM
    const endStr = searchParams.get("end") || undefined;

    // Try DuckDB + Parquet fast path first
    try {
      let parquetFiles: string[] = [];
      let fileLabel = "";
      if (month) {
        const pq = await ensureMainParquetForMonth(month);
        if (!pq) throw new Error("No Main (A) file found");
        parquetFiles = [pq];
        fileLabel = path.basename(pq);
      } else {
        const start = startStr ? (parseTimestamp(startStr) || new Date(startStr)) : undefined;
        const end = endStr ? (parseTimestamp(endStr) || new Date(endStr)) : undefined;
        parquetFiles = await ensureMainParquetsInRange(start, end);
        if (!parquetFiles.length) throw new Error("No Main (A) files in range");
        fileLabel = parquetFiles.map((p) => path.basename(p)).join(",");
      }

      const parquetPaths = parquetFiles.map((p) => p.replace(/\\/g, "/"));
      const colsHints = await discoverMainColumns(parquetPaths);
      const conn = await getDuckConn();
      const arr = '[' + parquetPaths.map((p) => `'${p}'`).join(',') + ']';
      const describeSql = `DESCRIBE SELECT * FROM read_parquet(${arr}, union_by_name=true)`;
      const descReader = await conn.runAndReadAll(describeSql);
      const cols: any[] = descReader.getRowObjects();
      const allNames = cols.map((r: any) => String(r.column_name || r.ColumnName || r.column || ""));
      const typedNumericCols = cols
        .filter((r: any) => {
          const t = String(r.column_type || r.Type || r.type || "").toUpperCase();
          return t && !t.includes("VARCHAR") && !t.includes("BOOLEAN") && t !== "";
        })
        .map((r: any) => String(r.column_name || r.ColumnName || r.column || ""))
        .filter((c) => c && c !== "ts" && c !== "Time" && c !== "Zeit");

      const seen = new Set<string>();
      const orderedCols: string[] = [];
      const pushCol = (name?: string | null) => {
        if (!name) return;
        if (!allNames.includes(name)) return;
        if (seen.has(name)) return;
        seen.add(name);
        orderedCols.push(name);
      };

      pushCol(colsHints.temp);
      for (const c of typedNumericCols) pushCol(c);
      const candidateGroups: (string | null)[] = [
        colsHints.rainDay,
        ...colsHints.dailyRainCandidates,
        ...colsHints.hourlyRainCandidates,
        ...colsHints.genericRainCandidates,
        colsHints.temp,
        ...colsHints.tempCandidates,
        colsHints.dew,
        ...colsHints.dewCandidates,
        colsHints.feelsLike,
        ...colsHints.feelsLikeCandidates,
        colsHints.wind,
        ...colsHints.windCandidates,
        colsHints.gust,
        ...colsHints.gustCandidates,
      ];
      for (const c of candidateGroups) pushCol(c);

      // Build aggregation over bucket
      const bucketExpr =
        resolution === "day" ? "date_trunc('day', ts)" :
        resolution === "hour" ? "date_trunc('hour', ts)" :
        "date_trunc('minute', ts)";
      const avgList = orderedCols.map((c) => {
        const escaped = c.replace(/"/g, '""');
        const isWind = colsHints.wind === c || colsHints.windCandidates.includes(c);
        const isGust = colsHints.gust === c || colsHints.gustCandidates.includes(c);
        const numericExpr = isWind || isGust ? speedExprFor(c) : sqlNum('"' + escaped + '"');
        return `avg(${numericExpr}) AS "${escaped}"`;
      }).join(",\n          ");
      const unionSources = parquetPaths.map((p) => `SELECT * FROM read_parquet('${p}')`).join("\nUNION ALL\n");
      const whereStart = startStr ? `(ts >= strptime('${startStr.replace("T", " ")}', ['%Y-%m-%d %H:%M','%Y/%m/%d %H:%M']))` : "1=1";
      const whereEnd = endStr ? `(ts <= strptime('${endStr.replace("T", " ")}', ['%Y-%m-%d %H:%M','%Y/%m/%d %H:%M']))` : "1=1";
      const sql = `
        WITH src AS (
          ${unionSources}
        ),
        filt AS (
          SELECT * FROM src WHERE ts IS NOT NULL AND ${whereStart} AND ${whereEnd}
        )
        SELECT
          strftime(${bucketExpr}, '%Y-%m-%d %H:%M') AS time
          ${avgList ? ",\n          " + avgList : ""}
        FROM filt
        GROUP BY 1
        ORDER BY 1
      `;
      const reader = await conn.runAndReadAll(sql);
      let outRows: any[] = reader.getRowObjects();
      outRows = outRows.map((r: any) => ({ key: r.time, ...r }));
      const header = ["time", ...orderedCols];
      return NextResponse.json({ file: fileLabel, header, rows: outRows }, { status: 200 });
    } catch (e) {
      // Fallback to CSV path below
    }

    let header: string[] = [];
    let rows: any[] = [];
    let fileLabel = "";
    if (month) {
      const file = await getMainFilename(month);
      if (!file) return NextResponse.json({ error: "No Main (A) file found" }, { status: 404 });
      const rel = path.join("DNT", file);
      const content = await readCsvFile(rel);
      const parsed = parseCsv(content);
      header = parsed.header;
      rows = parsed.rows;
      fileLabel = file;
    } else {
      const start = startStr ? (parseTimestamp(startStr) || new Date(startStr)) : undefined;
      const end = endStr ? (parseTimestamp(endStr) || new Date(endStr)) : undefined;
      const files = await getMainFilesInRange(start, end);
      if (!files.length) return NextResponse.json({ error: "No Main (A) files in range" }, { status: 404 });
      fileLabel = files.join(",");
      for (const f of files) {
        const rel = path.join("DNT", f);
        const content = await readCsvFile(rel);
        const parsed = parseCsv(content);
        if (!header.length) header = parsed.header;
        rows.push(...parsed.rows);
      }
    }

    const start = startStr ? (parseTimestamp(startStr) || new Date(startStr)) : undefined;
    const end = endStr ? (parseTimestamp(endStr) || new Date(endStr)) : undefined;

    const agg = aggregateRows(rows, resolution, start, end);

    return NextResponse.json({ file: fileLabel, header, rows: agg }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import path from "path";
import { readCsvFile, parseCsv, aggregateRows } from "@/lib/csv";
import { getAllsensorsFilename, getAllsensorsFilesInRange } from "@/lib/files";
import { parseTimestamp, type Resolution } from "@/lib/time";
import { getDuckConn } from "@/lib/db/duckdb";
import { ensureAllsensorsParquetForMonth, ensureAllsensorsParquetsInRange } from "@/lib/db/ingest";
import { discoverMainColumns as discoverColumns, sqlNum, speedExprFor } from "@/lib/data/columns";

export const runtime = "nodejs";

/**
 * API route to get aggregated 'allsensors' data.
 * This function handles GET requests to /api/data/allsensors.
 * It can filter data by month or by a time range, and aggregate it by minute, hour, or day.
 * It first attempts to use a fast path with DuckDB and Parquet files, and falls back to parsing CSV files if that fails.
 *
 * @param {Request} req - The incoming request object.
 * @returns {Promise<NextResponse>} A JSON response containing the aggregated data, or an error message.
 *
 * @example
 * // Get data for a specific month with hourly resolution
 * GET /api/data/allsensors?month=202508&resolution=hour
 *
 * @example
 * // Get data for a specific time range with daily resolution
 * GET /api/data/allsensors?start=2025-08-01T00:00:00&end=2025-08-15T23:59:59&resolution=day
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
        const pq = await ensureAllsensorsParquetForMonth(month);
        if (!pq) throw new Error("No Allsensors file found");
        parquetFiles = [pq];
        fileLabel = path.basename(pq);
      } else {
        const start = startStr ? (parseTimestamp(startStr) || new Date(startStr)) : undefined;
        const end = endStr ? (parseTimestamp(endStr) || new Date(endStr)) : undefined;
        parquetFiles = await ensureAllsensorsParquetsInRange(start, end);
        if (!parquetFiles.length) throw new Error("No Allsensors files in range");
        fileLabel = parquetFiles.map((p) => path.basename(p)).join(",");
      }

      const parquetPaths = parquetFiles.map((p) => p.replace(/\\/g, "/"));
      const conn = await getDuckConn();
      const arr = '[' + parquetPaths.map((p) => `'${p}'`).join(',') + ']';
      const describeSql = `DESCRIBE SELECT * FROM read_parquet(${arr}, union_by_name=true)`;
      const descReader = await conn.runAndReadAll(describeSql);
      const cols: any[] = descReader.getRowObjects();
      const allNames = cols.map((r: any) => String(r.column_name || r.ColumnName || r.column || ""));

      const hints = await discoverColumns(parquetPaths);

      const seen = new Set<string>();
      const numericCols: string[] = [];
      const pushCol = (name?: string | null) => {
        if (!name) return;
        if (!allNames.includes(name)) return;
        if (seen.has(name)) return;
        seen.add(name);
        numericCols.push(name);
      };

      const typedNumeric = cols
        .filter((r: any) => {
          const t = String(r.column_type || r.Type || r.type || "").toUpperCase();
          return t && !t.includes("VARCHAR") && !t.includes("BOOLEAN") && t !== "";
        })
        .map((r: any) => String(r.column_name || r.ColumnName || r.column || ""))
        .filter((c) => c && c !== "ts" && c !== "Time" && c !== "Zeit");
      for (const c of typedNumeric) pushCol(c);

      const candidates: (string | null)[] = [
        hints.temp,
        ...hints.tempCandidates,
        hints.dew,
        ...hints.dewCandidates,
        hints.feelsLike,
        ...hints.feelsLikeCandidates,
        hints.wind,
        ...hints.windCandidates,
        hints.gust,
        ...hints.gustCandidates,
        hints.rainDay,
        ...hints.dailyRainCandidates,
        ...hints.hourlyRainCandidates,
        ...hints.genericRainCandidates,
      ];
      for (const c of candidates) pushCol(c);

      // Build select list: bucket + avg(numeric cols)
      const bucketExpr =
        resolution === "day" ? "date_trunc('day', ts)" :
        resolution === "hour" ? "date_trunc('hour', ts)" :
        "date_trunc('minute', ts)";
      const avgList = numericCols.map((c) => {
        const escaped = c.replace(/"/g, '""');
        const isWind = hints.wind === c || hints.windCandidates.includes(c);
        const isGust = hints.gust === c || hints.gustCandidates.includes(c);
        const expr = isWind || isGust ? speedExprFor(c) : sqlNum('"' + escaped + '"');
        return `avg(${expr}) AS "${escaped}"`;
      }).join(",\n      ");
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
      // Header: ensure 'time' first + discovered numeric columns
      const header = ["time", ...numericCols];
      return NextResponse.json({ file: fileLabel, header, rows: outRows }, { status: 200 });
    } catch (e) {
      // Fallback to CSV path
    }

    // CSV fallback path (existing behavior)
    let header: string[] = [];
    let rows: any[] = [];
    let fileLabel = "";
    if (month) {
      const file = await getAllsensorsFilename(month);
      if (!file) return NextResponse.json({ error: "No Allsensors file found" }, { status: 404 });
      const rel = path.join("DNT", file);
      const content = await readCsvFile(rel);
      const parsed = parseCsv(content);
      header = parsed.header;
      rows = parsed.rows;
      fileLabel = file;
    } else {
      const start = startStr ? (parseTimestamp(startStr) || new Date(startStr)) : undefined;
      const end = endStr ? (parseTimestamp(endStr) || new Date(endStr)) : undefined;
      const files = await getAllsensorsFilesInRange(start, end);
      if (!files.length) return NextResponse.json({ error: "No Allsensors files in range" }, { status: 404 });
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

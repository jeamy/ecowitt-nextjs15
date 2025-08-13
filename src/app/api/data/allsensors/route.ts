import { NextResponse } from "next/server";
import path from "path";
import { readCsvFile, parseCsv, aggregateRows } from "@/lib/csv";
import { getAllsensorsFilename, getAllsensorsFilesInRange } from "@/lib/files";
import { parseTimestamp, type Resolution } from "@/lib/time";
import { getDuckConn } from "@/lib/db/duckdb";
import { ensureAllsensorsParquetForMonth, ensureAllsensorsParquetsInRange } from "@/lib/db/ingest";

export const runtime = "nodejs";

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

      const conn = await getDuckConn();
      const first = parquetFiles[0].replace(/\\/g, "/");
      // Introspect columns from Parquet to decide which to AVG
      const describeSql = `DESCRIBE SELECT * FROM read_parquet('${first}')`;
      const descReader = await conn.runAndReadAll(describeSql);
      const cols: any[] = descReader.getRowObjects();
      const numericCols = cols
        .filter((r: any) => {
          const t = String(r.column_type || r.Type || r.type || "").toUpperCase();
          // Keep numeric-like columns only
          return t && !t.includes("VARCHAR") && !t.includes("BOOLEAN") && t !== "";
        })
        .map((r: any) => String(r.column_name || r.ColumnName || r.column || ""))
        .filter((c) => c && c !== "ts" && c !== "Time" && c !== "Zeit");

      // Build select list: bucket + avg(numeric cols)
      const bucketExpr =
        resolution === "day" ? "date_trunc('day', ts)" :
        resolution === "hour" ? "date_trunc('hour', ts)" :
        "date_trunc('minute', ts)";
      const avgList = numericCols.map((c) => `avg(CAST("${c.replace(/"/g, '"')}" AS DOUBLE)) AS "${c.replace(/"/g, '"')}"`).join(",\n      ");
      const unionSources = parquetFiles.map((p) => `SELECT * FROM read_parquet('${p.replace(/\\/g, "/")}')`).join("\nUNION ALL\n");
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
      // Header: take from first Parquet + ensure 'time' first
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

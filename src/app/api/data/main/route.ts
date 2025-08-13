import { NextResponse } from "next/server";
import path from "path";
import { readCsvFile, parseCsv, aggregateRows } from "@/lib/csv";
import { getMainFilename, getMainFilesInRange } from "@/lib/files";
import { parseTimestamp, type Resolution } from "@/lib/time";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") || undefined; // e.g., 202508
    const resolution = (searchParams.get("resolution") as Resolution) || "minute";
    const startStr = searchParams.get("start") || undefined; // ISO or YYYY/M/D H:MM
    const endStr = searchParams.get("end") || undefined;

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

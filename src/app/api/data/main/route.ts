import { NextResponse } from "next/server";
import path from "path";
import { readCsvFile, parseCsv, aggregateRows } from "@/lib/csv";
import { getMainFilename } from "@/lib/files";
import { parseTimestamp, type Resolution } from "@/lib/time";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") || undefined; // e.g., 202508
    const resolution = (searchParams.get("resolution") as Resolution) || "minute";
    const startStr = searchParams.get("start") || undefined; // ISO or YYYY/M/D H:MM
    const endStr = searchParams.get("end") || undefined;

    const file = await getMainFilename(month);
    if (!file) return NextResponse.json({ error: "No Main (A) file found" }, { status: 404 });

    const rel = path.join("DNT", file);
    const content = await readCsvFile(rel);
    const { header, rows } = parseCsv(content);

    const start = startStr ? (parseTimestamp(startStr) || new Date(startStr)) : undefined;
    const end = endStr ? (parseTimestamp(endStr) || new Date(endStr)) : undefined;

    const agg = aggregateRows(rows, resolution, start, end);

    return NextResponse.json({ file, header, rows: agg }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

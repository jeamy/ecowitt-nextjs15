import { NextResponse } from "next/server";
import path from "path";
import { readCsvFile, parseCsv } from "@/lib/csv";
import { getAllsensorsFilesInRange, getMainFilesInRange } from "@/lib/files";
import { parseTimestamp } from "@/lib/time";

export const runtime = "nodejs";

function toIsoMinute(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export async function GET() {
  try {
    const mainFiles = await getMainFilesInRange();
    const allFiles = await getAllsensorsFilesInRange();
    const all = [...new Set([...mainFiles, ...allFiles])].sort();
    if (!all.length) return NextResponse.json({ error: "No CSV files found" }, { status: 404 });

    const firstFile = all[0];
    const lastFile = all[all.length - 1];

    async function firstTimeOf(file: string): Promise<Date | null> {
      const content = await readCsvFile(path.join("DNT", file));
      const { rows } = parseCsv(content);
      for (const r of rows) {
        const d = parseTimestamp(r.time);
        if (d) return d;
      }
      return null;
    }
    async function lastTimeOf(file: string): Promise<Date | null> {
      const content = await readCsvFile(path.join("DNT", file));
      const { rows } = parseCsv(content);
      for (let i = rows.length - 1; i >= 0; i--) {
        const d = parseTimestamp(rows[i].time);
        if (d) return d;
      }
      return null;
    }

    const [dMin, dMax] = await Promise.all([firstTimeOf(firstFile), lastTimeOf(lastFile)]);
    if (!dMin || !dMax) return NextResponse.json({ error: "Could not determine extent" }, { status: 500 });

    return NextResponse.json({ min: toIsoMinute(dMin), max: toIsoMinute(dMax) }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

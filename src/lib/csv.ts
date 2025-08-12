import { promises as fs } from "fs";
import path from "path";
import { parseTimestamp, floorToResolution, keyForResolution, type Resolution } from "@/lib/time";

export type Row = { [key: string]: string | number | null } & { time: string };

export async function readCsvFile(relPath: string): Promise<string> {
  const base = process.cwd();
  const abs = path.join(base, relPath);
  return fs.readFile(abs, "utf8");
}

export function parseCsv(content: string): { header: string[]; rows: Row[] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split(",").map((s) => s.trim());
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length === 0) continue;
    const row: Row = { time: "" } as Row;
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      const valRaw = cols[c] ?? "";
      const val = valRaw.trim();
      if (c === 0 && (key === "Zeit" || key === "Time")) {
        row.time = val;
      } else {
        if (val === "--" || val === "") row[key] = null;
        else if (!isNaN(Number(val))) row[key] = Number(val);
        else row[key] = val;
      }
    }
    if (row.time) rows.push(row);
  }
  return { header, rows };
}

export function aggregateRows(rows: Row[], resolution: Resolution, start?: Date, end?: Date): Array<Row & { key: string }> {
  // Group by floored time
  const map = new Map<string, { t: Date; acc: Record<string, number>; cnt: Record<string, number> }>();
  for (const r of rows) {
    const dt = parseTimestamp(r.time);
    if (!dt) continue;
    if (start && dt < start) continue;
    if (end && dt > end) continue;
    const bucket = floorToResolution(dt, resolution);
    const k = keyForResolution(bucket, resolution);
    let entry = map.get(k);
    if (!entry) {
      entry = { t: bucket, acc: {}, cnt: {} };
      map.set(k, entry);
    }
    for (const [k2, v] of Object.entries(r)) {
      if (k2 === "time") continue;
      if (typeof v === "number") {
        entry.acc[k2] = (entry.acc[k2] ?? 0) + v;
        entry.cnt[k2] = (entry.cnt[k2] ?? 0) + 1;
      }
    }
  }
  // Build aggregated rows (averages)
  const out: (Row & { key: string })[] = [];
  for (const [k, e] of Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const row: Row & { key: string } = { key: k, time: k } as any;
    for (const [col, sum] of Object.entries(e.acc)) {
      const n = e.cnt[col] ?? 1;
      row[col] = sum / n;
    }
    out.push(row);
  }
  return out;
}

export function inferAllsensorKeys(header: string[]): { temp: string[]; hum: string[]; dew: string[]; heat: string[] } {
  const temp: string[] = [];
  const hum: string[] = [];
  const dew: string[] = [];
  const heat: string[] = [];
  for (const h of header) {
    if (/^CH\d+ Temperature/.test(h)) temp.push(h);
    else if (/^CH\d+ Luftfeuchtigkeit/.test(h) || /^WN35CH\d+hum/.test(h)) hum.push(h);
    else if (/^CH\d+ Taupunkt/.test(h)) dew.push(h);
    else if (/^CH\d+ Wärmeindex/.test(h)) heat.push(h);
  }
  return { temp, hum, dew, heat };
}

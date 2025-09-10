import { promises as fs } from "fs";
import path from "path";
import { parseTimestamp, floorToResolution, keyForResolution, type Resolution } from "@/lib/time";

/**
 * Represents a row of data from a CSV file.
 * The `time` property is always a string, while other properties can be strings, numbers, or null.
 */
export type Row = { [key: string]: string | number | null } & { time: string };

/**
 * Reads a CSV file from a relative path.
 * @param {string} relPath - The relative path to the CSV file.
 * @returns {Promise<string>} A promise that resolves with the content of the file as a string.
 */
export async function readCsvFile(relPath: string): Promise<string> {
  const base = process.cwd();
  const abs = path.join(base, relPath);
  return fs.readFile(abs, "utf8");
}

/**
 * Parses a CSV string into a header array and an array of row objects.
 * @param {string} content - The CSV content as a string.
 * @returns {{ header: string[]; rows: Row[] }} An object containing the header and rows.
 */
export function parseCsv(content: string): { header: string[]; rows: Row[] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  // Strip potential UTF-8 BOM
  if (lines[0].charCodeAt(0) === 0xfeff) {
    lines[0] = lines[0].slice(1);
  }
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
      // Always treat first column as time; header may vary or include BOM
      if (c === 0) {
        row.time = val;
        continue;
      }
      if (val === "--" || val === "") row[key] = null;
      else if (!isNaN(Number(val))) row[key] = Number(val);
      else row[key] = val;
    }
    if (row.time) rows.push(row);
  }
  return { header, rows };
}

/**
 * Aggregates rows of data by a given time resolution.
 * @param {Row[]} rows - The array of rows to aggregate.
 * @param {Resolution} resolution - The time resolution to group by (e.g., "minute", "hour", "day").
 * @param {Date} [start] - An optional start date to filter the rows.
 * @param {Date} [end] - An optional end date to filter the rows.
 * @returns {Array<Row & { key: string }>} An array of aggregated rows, with an added `key` property for the time bucket.
 */
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

/**
 * Infers the keys for temperature, humidity, dew point, and heat index from a CSV header.
 * @param {string[]} header - The array of header strings.
 * @returns {{ temp: string[]; hum: string[]; dew: string[]; heat: string[] }} An object containing arrays of keys for each metric.
 */
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

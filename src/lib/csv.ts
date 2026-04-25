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
  const header = parseCsvLine(lines[0]).map((s) => s.trim());
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
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

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      cols.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cols.push(current);
  return cols;
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
  const map = new Map<string, {
    t: Date;
    acc: Record<string, number>;
    cnt: Record<string, number>;
    max: Record<string, number>;
    dirSin: Record<string, number>;
    dirCos: Record<string, number>;
  }>();
  for (const r of rows) {
    const dt = parseTimestamp(r.time);
    if (!dt) continue;
    if (start && dt < start) continue;
    if (end && dt > end) continue;
    const bucket = floorToResolution(dt, resolution);
    const k = keyForResolution(bucket, resolution);
    let entry = map.get(k);
    if (!entry) {
      entry = { t: bucket, acc: {}, cnt: {}, max: {}, dirSin: {}, dirCos: {} };
      map.set(k, entry);
    }
    for (const [k2, v] of Object.entries(r)) {
      if (k2 === "time") continue;
      if (typeof v === "number") {
        if (isDirectionColumn(k2)) {
          const rad = (v * Math.PI) / 180;
          entry.dirSin[k2] = (entry.dirSin[k2] ?? 0) + Math.sin(rad);
          entry.dirCos[k2] = (entry.dirCos[k2] ?? 0) + Math.cos(rad);
        }
        entry.acc[k2] = (entry.acc[k2] ?? 0) + v;
        entry.cnt[k2] = (entry.cnt[k2] ?? 0) + 1;
        entry.max[k2] = Math.max(entry.max[k2] ?? Number.NEGATIVE_INFINITY, v);
      }
    }
  }
  // Build aggregated rows (averages)
  const out: (Row & { key: string })[] = [];
  for (const [k, e] of Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const row: Row & { key: string } = { key: k, time: k } as any;
    for (const [col, sum] of Object.entries(e.acc)) {
      const n = e.cnt[col] ?? 1;
      if (isDirectionColumn(col)) {
        const deg = (Math.atan2(e.dirSin[col] ?? 0, e.dirCos[col] ?? 0) * 180) / Math.PI;
        row[col] = (deg + 360) % 360;
      } else if (isDailyRainColumn(col)) {
        row[col] = e.max[col];
      } else if (isIntervalRainColumn(col)) {
        row[col] = sum;
      } else {
        row[col] = sum / n;
      }
    }
    out.push(row);
  }
  return out;
}

function normalizedColumnName(name: string) {
  return name.toLowerCase().replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[^a-z0-9]+/g, "");
}

function isDirectionColumn(name: string) {
  const k = normalizedColumnName(name);
  return k.includes("windrichtung") || k.includes("winddirection") || k === "direction";
}

function isDailyRainColumn(name: string) {
  const k = normalizedColumnName(name);
  return (k.includes("regen") || k.includes("rain")) && (k.includes("tag") || k.includes("daily") || k.includes("today"));
}

function isIntervalRainColumn(name: string) {
  const k = normalizedColumnName(name);
  if (!(k.includes("regen") || k.includes("rain"))) return false;
  if (k.includes("rate") || k.includes("jahr") || k.includes("year") || k.includes("monat") || k.includes("month") || k.includes("woche") || k.includes("week")) return false;
  return k.includes("stunde") || k.includes("hour") || k.includes("minute") || k.includes("min");
}

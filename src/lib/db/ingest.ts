import path from "path";
import { promises as fs } from "fs";
import {
  getAllsensorsFilename,
  getAllsensorsFilesInRange,
  getMainFilename,
  getMainFilesInRange,
} from "@/lib/files";

/**
 * Checks if a file exists at the given path.
 * @param {string} p - The path to the file.
 * @returns {Promise<boolean>} A promise that resolves to true if the file exists, false otherwise.
 * @private
 */
async function fileExists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Gets the modification time of a file in milliseconds.
 * @param {string} p - The path to the file.
 * @returns {Promise<number>} A promise that resolves to the modification time in milliseconds.
 * @private
 */
async function mtimeMs(p: string): Promise<number> {
  const st = await fs.stat(p);
  return st.mtimeMs;
}

/**
 * Ensures that the directory for 'allsensors' Parquet files exists.
 * @returns {Promise<string>} A promise that resolves to the absolute path of the directory.
 */
export async function ensureParquetDir(): Promise<string> {
  const dir = path.join(process.cwd(), "data", "parquet", "allsensors");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Ensures that the directory for 'main' Parquet files exists.
 * @returns {Promise<string>} A promise that resolves to the absolute path of the directory.
 */
export async function ensureMainParquetDir(): Promise<string> {
  const dir = path.join(process.cwd(), "data", "parquet", "main");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Extracts the month (YYYYMM) from a filename.
 * @param {string} file - The filename.
 * @returns {Promise<string | null>} A promise that resolves to the month string, or null if not found.
 */
export async function monthFromFilename(file: string): Promise<string | null> {
  // Expect leading YYYYMM... in filename
  const m = file.match(/(\d{6})/);
  return m ? m[1] : null;
}

/**
 * Selects the most likely time column name from a list of column descriptions.
 * @param {any[]} descRows - An array of row objects from a `DESCRIBE` query.
 * @returns {string | null} The name of the time column, or null if not found.
 * @private
 */
function selectTimeColumnName(descRows: any[]): string | null {
  const names = descRows.map((r: any) => String(r.column_name || r.ColumnName || r.column || ""));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const candidates = names
    .map((n: string) => ({ n, k: norm(n) }))
    .filter(({ k }) => k.includes("datetime") || k.includes("datetimeutc") || k === "time" || k === "zeit" || k.includes("timestamp") || k === "date" || k === "datum" || k.includes("zeitstempel") || k === "dateutc");
  if (candidates.length) return candidates[0].n;
  // fallback common names if present
  if (names.includes("Time")) return "Time";
  if (names.includes("Zeit")) return "Zeit";
  return null;
}

/**
 * Ensures that a Parquet file for the 'allsensors' data of a given month exists and is up-to-date.
 * If the Parquet file doesn't exist or is older than the corresponding CSV file, it is created.
 * @param {string} month - The month in YYYYMM format.
 * @returns {Promise<string | null>} A promise that resolves to the path of the Parquet file, or null if the CSV file is not found.
 */
export async function ensureAllsensorsParquetForMonth(month: string): Promise<string | null> {
  const csvFile = await getAllsensorsFilename(month);
  if (!csvFile) return null;
  const csvAbs = path.join(process.cwd(), "DNT", csvFile);
  const outDir = await ensureParquetDir();
  const pqAbs = path.join(outDir, `${month}.parquet`);

  const needBuild = !(await fileExists(pqAbs)) || (await mtimeMs(pqAbs)) < (await mtimeMs(csvAbs));
  if (!needBuild) return pqAbs;

  const { withConn } = await import("@/lib/db/duckdb");
  await withConn(async (conn) => {
    // Introspect to find time column name
    const desc = await conn.runAndReadAll(`DESCRIBE SELECT * FROM read_csv_auto('${csvAbs.replace(/\\/g, '/')}', header=true, union_by_name=true, ignore_errors=true)`);
    const cols = desc.getRowObjects();
    const tsCol = selectTimeColumnName(cols);
    if (!tsCol) throw new Error(`No time column found in ${path.basename(csvAbs)}`);
    const tsId = '"' + tsCol.replace(/"/g, '""') + '"';
    // Normalize timestamp column 'ts'
    const sql = `
      CREATE OR REPLACE TEMP VIEW v_src AS
      SELECT
        strptime(CAST(${tsId} AS VARCHAR),
          ['%Y-%m-%d %H:%M','%Y/%m/%d %H:%M','%Y-%m-%dT%H:%M','%Y-%m-%d %H:%M:%S','%Y/%m/%d %H:%M:%S','%Y-%m-%dT%H:%M:%S','%d.%m.%Y %H:%M','%d.%m.%Y %H:%M:%S']
        ) AS ts,
        *
      FROM read_csv_auto('${csvAbs.replace(/\\/g, '/')}', header=true, union_by_name=true, ignore_errors=true);
      COPY (SELECT * FROM v_src) TO '${pqAbs.replace(/\\/g, '/')}' (FORMAT PARQUET, COMPRESSION ZSTD);
    `;
    await conn.run(sql);
  });
  return pqAbs;
}

/**
 * Ensures that all 'allsensors' Parquet files for a given date range exist.
 * @param {Date} [start] - The start date of the range.
 * @param {Date} [end] - The end date of the range.
 * @returns {Promise<string[]>} A promise that resolves to an array of paths to the Parquet files.
 */
export async function ensureAllsensorsParquetsInRange(start?: Date, end?: Date): Promise<string[]> {
  const files = await getAllsensorsFilesInRange(start, end);
  const months = Array.from(new Set(await Promise.all(files.map(monthFromFilename)))).filter(Boolean) as string[];
  const out: string[] = [];
  for (const m of months) {
    const p = await ensureAllsensorsParquetForMonth(m);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Ensures that a Parquet file for the 'main' data of a given month exists and is up-to-date.
 * If the Parquet file doesn't exist or is older than the corresponding CSV file, it is created.
 * @param {string} month - The month in YYYYMM format.
 * @returns {Promise<string | null>} A promise that resolves to the path of the Parquet file, or null if the CSV file is not found.
 */
export async function ensureMainParquetForMonth(month: string): Promise<string | null> {
  const csvFile = await getMainFilename(month);
  if (!csvFile) return null;
  const csvAbs = path.join(process.cwd(), "DNT", csvFile);
  const outDir = await ensureMainParquetDir();
  const pqAbs = path.join(outDir, `${month}.parquet`);

  const needBuild = !(await fileExists(pqAbs)) || (await mtimeMs(pqAbs)) < (await mtimeMs(csvAbs));
  if (!needBuild) return pqAbs;

  const { withConn } = await import("@/lib/db/duckdb");
  await withConn(async (conn) => {
    // Introspect to find time column name
    const desc2 = await conn.runAndReadAll(`DESCRIBE SELECT * FROM read_csv_auto('${csvAbs.replace(/\\/g, '/')}', header=true, union_by_name=true, ignore_errors=true)`);
    const cols2 = desc2.getRowObjects();
    const tsCol2 = selectTimeColumnName(cols2);
    if (!tsCol2) throw new Error(`No time column found in ${path.basename(csvAbs)}`);
    const tsId2 = '"' + tsCol2.replace(/"/g, '""') + '"';
    // Normalize timestamp column 'ts'
    const sql = `
      CREATE OR REPLACE TEMP VIEW v_src AS
      SELECT
        strptime(CAST(${tsId2} AS VARCHAR),
          ['%Y-%m-%d %H:%M','%Y/%m/%d %H:%M','%Y-%m-%dT%H:%M','%Y-%m-%d %H:%M:%S','%Y/%m/%d %H:%M:%S','%Y-%m-%dT%H:%M:%S','%d.%m.%Y %H:%M','%d.%m.%Y %H:%M:%S']
        ) AS ts,
        *
      FROM read_csv_auto('${csvAbs.replace(/\\/g, '/')}', header=true, union_by_name=true, ignore_errors=true);
      COPY (SELECT * FROM v_src) TO '${pqAbs.replace(/\\/g, '/')}' (FORMAT PARQUET, COMPRESSION ZSTD);
    `;
    await conn.run(sql);
  });
  return pqAbs;
}

/**
 * Ensures that all 'main' Parquet files for a given date range exist.
 * @param {Date} [start] - The start date of the range.
 * @param {Date} [end] - The end date of the range.
 * @returns {Promise<string[]>} A promise that resolves to an array of paths to the Parquet files.
 */
export async function ensureMainParquetsInRange(start?: Date, end?: Date): Promise<string[]> {
  const files = await getMainFilesInRange(start, end);
  const months = Array.from(new Set(await Promise.all(files.map(monthFromFilename)))).filter(Boolean) as string[];
  const out: string[] = [];
  for (const m of months) {
    const p = await ensureMainParquetForMonth(m);
    if (p) out.push(p);
  }
  return out;
}

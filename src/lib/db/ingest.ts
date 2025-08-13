import path from "path";
import { promises as fs } from "fs";
import { getDuckConn } from "@/lib/db/duckdb";
import {
  getAllsensorsFilename,
  getAllsensorsFilesInRange,
  getMainFilename,
  getMainFilesInRange,
} from "@/lib/files";

async function fileExists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function mtimeMs(p: string): Promise<number> {
  const st = await fs.stat(p);
  return st.mtimeMs;
}

export async function ensureParquetDir(): Promise<string> {
  const dir = path.join(process.cwd(), "data", "parquet", "allsensors");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function ensureMainParquetDir(): Promise<string> {
  const dir = path.join(process.cwd(), "data", "parquet", "main");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function monthFromFilename(file: string): Promise<string | null> {
  // Expect leading YYYYMM... in filename
  const m = file.match(/(\d{6})/);
  return m ? m[1] : null;
}

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

export async function ensureAllsensorsParquetForMonth(month: string): Promise<string | null> {
  const csvFile = await getAllsensorsFilename(month);
  if (!csvFile) return null;
  const csvAbs = path.join(process.cwd(), "DNT", csvFile);
  const outDir = await ensureParquetDir();
  const pqAbs = path.join(outDir, `${month}.parquet`);

  const needBuild = !(await fileExists(pqAbs)) || (await mtimeMs(pqAbs)) < (await mtimeMs(csvAbs));
  if (!needBuild) return pqAbs;

  const conn = await getDuckConn();
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
  return pqAbs;
}

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

export async function ensureMainParquetForMonth(month: string): Promise<string | null> {
  const csvFile = await getMainFilename(month);
  if (!csvFile) return null;
  const csvAbs = path.join(process.cwd(), "DNT", csvFile);
  const outDir = await ensureMainParquetDir();
  const pqAbs = path.join(outDir, `${month}.parquet`);

  const needBuild = !(await fileExists(pqAbs)) || (await mtimeMs(pqAbs)) < (await mtimeMs(csvAbs));
  if (!needBuild) return pqAbs;

  const conn = await getDuckConn();
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
  return pqAbs;
}

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

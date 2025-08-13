import path from "path";
import { promises as fs } from "fs";
import { getDuckConn } from "@/lib/db/duckdb";
import { getAllsensorsFilename, getAllsensorsFilesInRange } from "@/lib/files";

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

export async function monthFromFilename(file: string): Promise<string | null> {
  // Expect leading YYYYMM... in filename
  const m = file.match(/(\d{6})/);
  return m ? m[1] : null;
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
  // Normalize timestamp column 'ts'
  const sql = `
    CREATE OR REPLACE TEMP VIEW v_src AS
    SELECT
      COALESCE(
        strptime(Time, ['%Y-%m-%d %H:%M','%Y/%m/%d %H:%M','%Y-%m-%dT%H:%M']),
        strptime(Zeit, ['%Y-%m-%d %H:%M','%Y/%m/%d %H:%M','%Y-%m-%dT%H:%M'])
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

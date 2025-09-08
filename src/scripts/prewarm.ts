import path from "path";
import { promises as fs } from "fs";
import {
  getAllsensorsFilesInRange,
  getMainFilesInRange,
} from "../lib/files";
import {
  ensureParquetDir as ensureAllsensorsParquetDir,
  ensureMainParquetDir,
  ensureAllsensorsParquetForMonth,
  ensureMainParquetForMonth,
} from "../lib/db/ingest";

async function fileExists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}
async function mtimeMs(p: string): Promise<number> {
  const st = await fs.stat(p); return st.mtimeMs;
}

function ymFromFilename(file: string): string | null {
  const m = file.match(/(\d{6})/);
  return m ? m[1] : null;
}

async function prewarmDataset(
  label: "Allsensors" | "Main",
  files: string[],
  ensureDir: () => Promise<string>,
  ensureMonth: (month: string) => Promise<string | null>,
) {
  const months = Array.from(new Set(files.map(ymFromFilename).filter(Boolean))) as string[];
  if (!months.length) {
    console.log(`[prewarm] ${label}: no CSV files found.`);
    return;
  }
  console.log(`[prewarm] ${label}: found ${months.length} month(s).`);
  const outDir = await ensureDir();
  let built = 0;
  for (const m of months) {
    // pick the csv file for this month
    const csv = files.find((f) => f.startsWith(m));
    if (!csv) {
      console.warn(`[prewarm] ${label} ${m}: CSV not found, skipping.`);
      continue;
    }
    const csvAbs = path.join(process.cwd(), "DNT", csv);
    const pqAbs = path.join(outDir, `${m}.parquet`);
    const need = !(await fileExists(pqAbs)) || (await mtimeMs(pqAbs)) < (await mtimeMs(csvAbs));
    if (need) {
      try {
        const out = await ensureMonth(m);
        if (out) {
          console.log(`[prewarm] ${label} ${m}: built ${path.relative(process.cwd(), out)}`);
          built++;
        } else {
          console.warn(`[prewarm] ${label} ${m}: no source CSV, skipped.`);
        }
      } catch (e: any) {
        console.error(`[prewarm] ${label} ${m}: ERROR ${e?.message || e}`);
      }
    } else {
      console.log(`[prewarm] ${label} ${m}: up-to-date (${path.relative(process.cwd(), pqAbs)})`);
    }
  }
  console.log(`[prewarm] ${label}: ${built} built, ${months.length - built} up-to-date.`);
}

async function main() {
  try {
    console.log("[prewarm] Scanning DNT/ for new CSV files and materializing Parquet via DuckDB...");
    const allFiles = await getAllsensorsFilesInRange();
    const mainFiles = await getMainFilesInRange();

    await prewarmDataset("Allsensors", allFiles, ensureAllsensorsParquetDir, ensureAllsensorsParquetForMonth);
    await prewarmDataset("Main", mainFiles, ensureMainParquetDir, ensureMainParquetForMonth);

    console.log("[prewarm] Done.");
  } catch (e: any) {
    console.error("[prewarm] Error:", e?.message || e);
    process.exitCode = 1;
  }
}

// Invoke
main();

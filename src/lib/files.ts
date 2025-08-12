import { promises as fs } from "fs";
import path from "path";

export const DNT_DIR = path.join(process.cwd(), "DNT");

export async function listDntFiles(): Promise<string[]> {
  const items = await fs.readdir(DNT_DIR);
  return items.filter((f) => f.toLowerCase().endsWith(".csv"));
}

export async function latestFileMatching(rx: RegExp): Promise<string | null> {
  const files = await listDntFiles();
  const m = files.filter((f) => rx.test(f)).sort();
  return m.length ? m[m.length - 1] : null;
}

export async function getAllsensorsFilename(month?: string): Promise<string | null> {
  if (month && /^\d{6}$/.test(month)) {
    const f = `${month}Allsensors_A.CSV`;
    try {
      await fs.access(path.join(DNT_DIR, f));
      return f;
    } catch {}
  }
  return latestFileMatching(/^\d{6}Allsensors_A\.CSV$/);
}

export async function getMainFilename(month?: string): Promise<string | null> {
  if (month && /^\d{6}$/.test(month)) {
    const f = `${month}A.CSV`;
    try {
      await fs.access(path.join(DNT_DIR, f));
      return f;
    } catch {}
  }
  return latestFileMatching(/^\d{6}A\.CSV$/);
}

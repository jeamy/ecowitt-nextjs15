import { promises as fs } from "fs";
import path from "path";

/**
 * The absolute path to the DNT directory where CSV files are stored.
 */
export const DNT_DIR = path.join(process.cwd(), "DNT");

/**
 * Lists all CSV files in the DNT directory.
 * @returns {Promise<string[]>} A promise that resolves to an array of CSV filenames.
 */
export async function listDntFiles(): Promise<string[]> {
  const items = await fs.readdir(DNT_DIR);
  return items.filter((f) => f.toLowerCase().endsWith(".csv"));
}

/**
 * Converts a Date object to a YYYYMM number.
 * @param {Date} [d] - The date to convert.
 * @returns {number | null} The date as a YYYYMM number, or null if the date is not provided.
 * @private
 */
function ymOf(d?: Date): number | null {
  if (!d) return null;
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}

/**
 * Gets all 'allsensors' CSV files within a given date range.
 * @param {Date} [start] - The start date of the range.
 * @param {Date} [end] - The end date of the range.
 * @returns {Promise<string[]>} A promise that resolves to an array of filenames.
 */
export async function getAllsensorsFilesInRange(start?: Date, end?: Date): Promise<string[]> {
  const files = await listDntFiles();
  // match case-insensitively: 202501Allsensors_A.csv / .CSV
  const list = files
    .filter((f) => /^\d{6}allsensors_a\.csv$/.test(f.toLowerCase()))
    .sort();
  const ys = ymOf(start);
  const ye = ymOf(end);
  if (!ys && !ye) return list;
  return list.filter((f) => {
    const ym = Number(f.slice(0, 6));
    if (ys && ym < ys) return false;
    if (ye && ym > ye) return false;
    return true;
  });
}

/**
 * Gets all 'main' CSV files within a given date range.
 * @param {Date} [start] - The start date of the range.
 * @param {Date} [end] - The end date of the range.
 * @returns {Promise<string[]>} A promise that resolves to an array of filenames.
 */
export async function getMainFilesInRange(start?: Date, end?: Date): Promise<string[]> {
  const files = await listDntFiles();
  // match case-insensitively: 202501A.csv / .CSV
  const list = files
    .filter((f) => /^\d{6}a\.csv$/.test(f.toLowerCase()))
    .sort();
  const ys = ymOf(start);
  const ye = ymOf(end);
  if (!ys && !ye) return list;
  return list.filter((f) => {
    const ym = Number(f.slice(0, 6));
    if (ys && ym < ys) return false;
    if (ye && ym > ye) return false;
    return true;
  });
}

/**
 * Finds the latest file in the DNT directory that matches a regular expression.
 * @param {RegExp} rxLower - The regular expression to match against lowercase filenames.
 * @returns {Promise<string | null>} A promise that resolves to the filename, or null if no match is found.
 */
export async function latestFileMatching(rxLower: RegExp): Promise<string | null> {
  const files = await listDntFiles();
  const m = files.filter((f) => rxLower.test(f.toLowerCase())).sort();
  return m.length ? m[m.length - 1] : null;
}

/**
 * Gets the 'allsensors' filename for a specific month, or the latest one if no month is provided.
 * @param {string} [month] - The month in YYYYMM format.
 * @returns {Promise<string | null>} A promise that resolves to the filename, or null if not found.
 */
export async function getAllsensorsFilename(month?: string): Promise<string | null> {
  const files = await listDntFiles();
  if (month && /^\d{6}$/.test(month)) {
    const targetLower = `${month}allsensors_a.csv`;
    const found = files.find((f) => f.toLowerCase() === targetLower);
    if (found) return found;
  }
  return latestFileMatching(/^\d{6}allsensors_a\.csv$/);
}

/**
 * Gets the 'main' filename for a specific month, or the latest one if no month is provided.
 * @param {string} [month] - The month in YYYYMM format.
 * @returns {Promise<string | null>} A promise that resolves to the filename, or null if not found.
 */
export async function getMainFilename(month?: string): Promise<string | null> {
  const files = await listDntFiles();
  if (month && /^\d{6}$/.test(month)) {
    const targetLower = `${month}a.csv`;
    const found = files.find((f) => f.toLowerCase() === targetLower);
    if (found) return found;
  }
  return latestFileMatching(/^\d{6}a\.csv$/);
}

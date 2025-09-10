/**
 * Represents the time resolution for data aggregation.
 */
export type Resolution = "minute" | "hour" | "day";

/**
 * Parses a timestamp string into a Date object.
 * Handles formats like "YYYY/M/D H:mm" or "YYYY-M-DTH:mm:ss".
 * @param {string} ts - The timestamp string to parse.
 * @returns {Date | null} A Date object, or null if parsing fails.
 */
export function parseTimestamp(ts: string): Date | null {
  // Expected like: 2025/8/1 0:03 (no zero padding guaranteed)
  if (!ts) return null;
  const [datePart, timePart] = ts.trim().split(/[\sT]+/);
  if (!datePart) return null;
  const dateSep = datePart.includes("-") ? "-" : "/";
  const [y, m, d] = datePart.split(dateSep).map((s) => Number(s));
  let hh = 0, mm = 0, ss = 0;
  if (timePart) {
    const [h, m2, s2] = timePart.split(":");
    hh = Number(h ?? 0);
    mm = Number(m2 ?? 0);
    ss = Number(s2 ?? 0);
  }
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, (m || 1) - 1, d || 1, hh, mm, ss, 0);
}

/**
 * Floors a date to the specified resolution.
 * @param {Date} dt - The date to floor.
 * @param {Resolution} res - The resolution ("minute", "hour", or "day").
 * @returns {Date} The floored date.
 */
export function floorToResolution(dt: Date, res: Resolution): Date {
  const d = new Date(dt.getTime());
  if (res === "day") {
    d.setHours(0, 0, 0, 0);
  } else if (res === "hour") {
    d.setMinutes(0, 0, 0);
  } else {
    d.setSeconds(0, 0);
  }
  return d;
}

/**
 * Creates a string key for a date based on the specified resolution.
 * @param {Date} dt - The date to create a key for.
 * @param {Resolution} res - The resolution.
 * @returns {string} The formatted key string.
 */
export function keyForResolution(dt: Date, res: Resolution): string {
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;
  const d = dt.getDate();
  const hh = dt.getHours();
  const mm = dt.getMinutes();
  if (res === "day") return `${y}-${pad(m)}-${pad(d)}`;
  if (res === "hour") return `${y}-${pad(m)}-${pad(d)} ${pad(hh)}:00`;
  return `${y}-${pad(m)}-${pad(d)} ${pad(hh)}:${pad(mm)}`;
}

/**
 * Pads a number with a leading zero if it is less than 10.
 * @param {number} n - The number to pad.
 * @returns {string} The padded string.
 * @private
 */
function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }

/**
 * Converts a Date object to an ISO string, adjusted for the local timezone.
 * @param {Date} dt - The date to convert.
 * @returns {string} The ISO string.
 */
export function iso(dt: Date): string {
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString();
}

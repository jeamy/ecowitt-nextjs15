export type Resolution = "minute" | "hour" | "day";

export function parseTimestamp(ts: string): Date | null {
  // Expected like: 2025/8/1 0:03 (no zero padding guaranteed)
  if (!ts) return null;
  const [datePart, timePart] = ts.trim().split(/[\sT]+/);
  if (!datePart) return null;
  const [y, m, d] = datePart.split("/").map((s) => Number(s));
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

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }

export function iso(dt: Date): string {
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString();
}

import "server-only";
import EcoCon from "eco";
import { promises as fs } from "fs";
import path from "path";

function buildParams(all: boolean) {
  const eco = EcoCon.getInstance().getConfig();
  const params = new URLSearchParams({
    mac: eco.mac,
    api_key: eco.apiKey,
    application_key: eco.applicationKey,
    method: "device/real_time",
    call_back: all ? "all" : "indoor.temperature,outdoor.temperature",
    temp_unitid: "1",
    pressure_unitid: "3",
    wind_speed_unitid: "7",
    rainfall_unitid: "12",
    solar_irradiance_unitid: "16"
  });
  return params;
}

export function buildTargetUrl(all: boolean) {
  const eco = EcoCon.getInstance().getConfig();
  const baseUrl = `https://${eco.server}/api/v3/device/real_time`;
  const qs = buildParams(all);
  return `${baseUrl}?${qs.toString()}`;
}

function yyyymm(d: Date) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const mm = m < 10 ? `0${m}` : String(m);
  return `${y}${mm}`;
}

function timeString(d: Date) {
  // Format: 2025/08/13 12:03 (with leading zeros)
  const y = d.getFullYear();
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const H = d.getHours();
  const Min = d.getMinutes();
  
  // Add leading zeros
  const mm = M < 10 ? `0${M}` : String(M);
  const dd = D < 10 ? `0${D}` : String(D);
  const hh = H < 10 ? `0${H}` : String(H);
  const min = Min < 10 ? `0${Min}` : String(Min);
  
  return `${y}/${mm}/${dd} ${hh}:${min}`;
}

function tryRead(obj: any, dotted: string): any {
  return dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? (k in o ? o[k] : undefined) : undefined), obj);
}

function numVal(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return isNaN(Number(v)) ? null : Number(v);
  if (typeof v === "object" && v) {
    const x = (v as any).value;
    if (x == null) return null;
    if (typeof x === "number") return Number.isFinite(x) ? x : null;
    if (typeof x === "string") return isNaN(Number(x)) ? null : Number(x);
  }
  return null;
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function appendCsv(abs: string, header: string[], row: (string | number | null)[]) {
  let exists = true;
  try { await fs.access(abs); } catch { exists = false; }
  const lines: string[] = [];
  if (!exists) {
    lines.push(header.join(","));
  }
  const body = row.map((v) => (v == null ? "" : String(v))).join(",");
  lines.push(body);
  await fs.appendFile(abs, lines.join("\n") + "\n", "utf8");
}

export async function writeLiveToDNT(payload: any) {
  const now = new Date();
  const ym = yyyymm(now);
  const dnt = path.join(process.cwd(), "DNT");
  await ensureDir(dnt);

  // Allsensors_A (channels)
  const allsFile = path.join(dnt, `${ym}Allsensors_A.CSV`);
  const allsHeader: string[] = ["Time"];
  const allsRow: (string | number | null)[] = [timeString(now)];
  for (let i = 1; i <= 8; i++) {
    const ch = tryRead(payload, `ch${i}`) ?? tryRead(payload, `temp_and_humidity_ch${i}`);
    allsHeader.push(`CH${i} Temperature`, `CH${i} Luftfeuchtigkeit`, `CH${i} Taupunkt`);
    const t = numVal(ch?.temperature);
    const h = numVal(ch?.humidity);
    const d = numVal(ch?.dew_point);
    allsRow.push(t, h, d);
  }
  await appendCsv(allsFile, allsHeader, allsRow);

  // Main A (station)
  const mainFile = path.join(dnt, `${ym}A.CSV`);
  const mainHeader = [
    "Time",
    "Outdoor Temperature",
    "Outdoor Humidity",
    "Indoor Temperature",
    "Indoor Humidity",
    "Pressure Relative",
    "Pressure Absolute",
    "Wind Speed",
    "Wind Gust",
    "Wind Direction",
    "Wind Direction 10min",
    "Rain Rate",
    "Rain Hourly",
    "Rain Daily",
    "Rain Weekly",
    "Rain Monthly",
    "Rain Yearly",
    "Solar",
    "UVI"
  ];
  const mainRow: (string | number | null)[] = [timeString(now)];
  mainRow.push(
    numVal(tryRead(payload, "outdoor.temperature")),
    numVal(tryRead(payload, "outdoor.humidity")),
    numVal(tryRead(payload, "indoor.temperature")),
    numVal(tryRead(payload, "indoor.humidity")),
    numVal(tryRead(payload, "pressure.relative") ?? tryRead(payload, "barometer.relative") ?? tryRead(payload, "barometer.rel")),
    numVal(tryRead(payload, "pressure.absolute") ?? tryRead(payload, "barometer.absolute") ?? tryRead(payload, "barometer.abs")),
    numVal(tryRead(payload, "wind.wind_speed")),
    numVal(tryRead(payload, "wind.wind_gust")),
    numVal(tryRead(payload, "wind.wind_direction")),
    numVal(tryRead(payload, "wind.10_minute_average_wind_direction")),
    numVal(tryRead(payload, "rainfall.rain_rate") ?? tryRead(payload, "rain.rate")),
    numVal(tryRead(payload, "rainfall.hourly")),
    numVal(tryRead(payload, "rainfall.daily")),
    numVal(tryRead(payload, "rainfall.weekly")),
    numVal(tryRead(payload, "rainfall.monthly")),
    numVal(tryRead(payload, "rainfall.yearly")),
    numVal(tryRead(payload, "solar_and_uvi.solar")),
    numVal(tryRead(payload, "solar_and_uvi.uvi"))
  );
  await appendCsv(mainFile, mainHeader, mainRow);
}

function cachePath() {
  return path.join(process.cwd(), "DNT", "rt-last.json");
}

export async function setLastRealtime(rec: { ok: boolean; updatedAt: string; data?: any; error?: string }) {
  const dnt = path.join(process.cwd(), "DNT");
  await ensureDir(dnt);
  try {
    await fs.writeFile(cachePath(), JSON.stringify(rec), "utf8");
  } catch (e) {
    // best-effort; ignore
  }
}

export async function getLastRealtime(): Promise<{ ok: boolean; updatedAt: string; data?: any; error?: string } | null> {
  try {
    const txt = await fs.readFile(cachePath(), "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export async function fetchAndArchive(all: boolean = true) {
  const target = buildTargetUrl(all);
  const res = await fetch(target, { cache: "no-store" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Upstream ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const payload = (data && (data.data || (data as any).payload || data)) as any;
  if (payload && typeof payload === "object") {
    await writeLiveToDNT(payload);
    // Log success with ISO timestamp
    try {
      console.log(`[rt] update ok: ${new Date().toISOString()}`);
    } catch {}
    await setLastRealtime({ ok: true, updatedAt: new Date().toISOString(), data: payload });
  }
  return data;
}

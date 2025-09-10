import "server-only";
import EcoCon from "eco";
import { promises as fs } from "fs";
import path from "path";
import { updateTempMinMax } from "./temp-minmax";

/**
 * Builds the URL parameters for the Ecowitt API request.
 * @param {boolean} all - Whether to fetch all data or a subset.
 * @returns {URLSearchParams} The URL parameters.
 * @private
 */
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

/**
 * Builds the full target URL for the Ecowitt API request.
 * @param {boolean} all - Whether to fetch all data or a subset.
 * @returns {string} The full URL.
 */
export function buildTargetUrl(all: boolean) {
  const eco = EcoCon.getInstance().getConfig();
  const baseUrl = `https://${eco.server}/api/v3/device/real_time`;
  const qs = buildParams(all);
  return `${baseUrl}?${qs.toString()}`;
}

/**
 * Formats a date into a YYYYMM string.
 * @param {Date} d - The date to format.
 * @returns {string} The formatted date string.
 * @private
 */
function yyyymm(d: Date) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const mm = m < 10 ? `0${m}` : String(m);
  return `${y}${mm}`;
}

/**
 * Formats a date into a "YYYY/MM/DD HH:mm" string.
 * @param {Date} d - The date to format.
 * @returns {string} The formatted time string.
 * @private
 */
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

/**
 * Safely reads a nested property from an object using a dotted string path.
 * @param {any} obj - The object to read from.
 * @param {string} dotted - The dotted string path (e.g., "outdoor.temperature").
 * @returns {any} The value of the property, or undefined if not found.
 * @private
 */
function tryRead(obj: any, dotted: string): any {
  return dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? (k in o ? o[k] : undefined) : undefined), obj);
}

/**
 * Converts a value to a number, handling various input types.
 * @param {any} v - The value to convert.
 * @returns {number | null} The numeric value, or null if conversion is not possible.
 * @private
 */
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

/**
 * Calculates the dew point from temperature and humidity.
 * @param {number | null} temperature - The temperature in Celsius.
 * @param {number | null} humidity - The relative humidity in percent.
 * @returns {number | null} The dew point in Celsius, or null if inputs are invalid.
 * @private
 */
function calculateDewPoint(temperature: number | null, humidity: number | null): number | null {
  if (temperature === null || humidity === null) return null;
  
  // Magnus-Formel für Taupunktberechnung
  const a = 17.27;
  const b = 237.7;
  
  const alpha = ((a * temperature) / (b + temperature)) + Math.log(humidity / 100.0);
  const dewPoint = (b * alpha) / (a - alpha);
  
  return Number.isFinite(dewPoint) ? Math.round(dewPoint * 10) / 10 : null;
}

/**
 * Calculates the heat index from temperature and humidity.
 * @param {number | null} temperature - The temperature in Celsius.
 * @param {number | null} humidity - The relative humidity in percent.
 * @returns {number | null} The heat index in Celsius, or null if inputs are invalid.
 * @private
 */
function calculateHeatIndex(temperature: number | null, humidity: number | null): number | null {
  if (temperature === null || humidity === null) return null;
  
  // Vereinfachte Formel für den Wärmeindex (Heat Index)
  if (temperature < 20) {
    // Bei niedrigen Temperaturen ist der Wärmeindex gleich der Temperatur
    return temperature;
  }
  
  // Standardformel für Wärmeindex
  const t = temperature;
  const rh = humidity;
  
  // Koeffizienten für die Rothfusz-Gleichung
  const c1 = -8.78469475556;
  const c2 = 1.61139411;
  const c3 = 2.33854883889;
  const c4 = -0.14611605;
  const c5 = -0.012308094;
  const c6 = -0.0164248277778;
  const c7 = 0.002211732;
  const c8 = 0.00072546;
  const c9 = -0.000003582;
  
  const heatIndex = c1 + (c2 * t) + (c3 * rh) + (c4 * t * rh) + (c5 * t * t) +
                   (c6 * rh * rh) + (c7 * t * t * rh) + (c8 * t * rh * rh) + (c9 * t * t * rh * rh);
  
  return Number.isFinite(heatIndex) ? Math.round(heatIndex * 10) / 10 : temperature;
}

/**
 * Ensures that a directory exists, creating it if necessary.
 * @param {string} p - The path to the directory.
 * @private
 */
async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

/**
 * Appends a row to a CSV file, creating the file and header if it doesn't exist.
 * @param {string} abs - The absolute path to the CSV file.
 * @param {string[]} header - The header row.
 * @param {(string | number | null)[]} row - The data row to append.
 * @private
 */
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

/**
 * Writes the live weather data payload to the appropriate monthly CSV files.
 * @param {any} payload - The data payload from the Ecowitt API.
 */
export async function writeLiveToDNT(payload: any) {
  const now = new Date();
  const ym = yyyymm(now);
  const dnt = path.join(process.cwd(), "DNT");
  await ensureDir(dnt);

  // Allsensors_A (channels)
  const allsFile = path.join(dnt, `${ym}Allsensors_A.CSV`);
  const allsHeader: string[] = ["Zeit"];
  const allsRow: (string | number | null)[] = [timeString(now)];
  for (let i = 1; i <= 8; i++) {
    const ch = tryRead(payload, `ch${i}`) ?? tryRead(payload, `temp_and_humidity_ch${i}`);
    allsHeader.push(
      `CH${i} Temperature(℃)`, 
      `CH${i} Taupunkt(℃)`, 
      `CH${i} Wärmeindex(℃)`, 
      `CH${i} Luftfeuchtigkeit(%)`
    );
    const t = numVal(ch?.temperature);
    const h = numVal(ch?.humidity);
    
    // Berechne Taupunkt und Wärmeindex, falls sie nicht in der API-Antwort vorhanden sind
    let d = numVal(ch?.dew_point);
    let hi = numVal(ch?.feels_like);
    
    // Falls Taupunkt fehlt, aber Temperatur und Luftfeuchtigkeit vorhanden sind, berechne ihn
    if (d === null && t !== null && h !== null) {
      d = calculateDewPoint(t, h);
    }
    
    // Falls Wärmeindex fehlt, aber Temperatur und Luftfeuchtigkeit vorhanden sind, berechne ihn
    if (hi === null && t !== null && h !== null) {
      hi = calculateHeatIndex(t, h);
    }
    
    allsRow.push(t, d, hi, h);
  }
  await appendCsv(allsFile, allsHeader, allsRow);

  // Main A (station)
  const mainFile = path.join(dnt, `${ym}A.CSV`);
  const mainHeader = [
    "Zeit",
    "Temperatur Innen(℃)",
    "Luftfeuchtigkeit Innen(%)",
    "Temperatur Aussen(℃)",
    "Luftfeuchtigkeit Aussen(%)",
    "Taupunkt(℃)",
    "Gefühlte Temperatur(℃)",
    "Wind(km/h)",
    "Böe(km/h)",
    "Windrichtung(°)",
    "Abs. Luftdruck(hpa)",
    "Rel. Luftdruck(hpa)",
    "Sonneneinstrahlung(w/m2)",
    "UVI",
    "Regen/Stunde(mm)",
    "Regen Event(mm)",
    "Regen/Tag(mm)",
    "Regen/Wochen(mm)",
    "Regen/Monat(mm)",
    "Regen/Jahre(mm)",
    "Pm2.5(ug/m3)"
  ];
  const mainRow: (string | number | null)[] = [timeString(now)];
  mainRow.push(
    numVal(tryRead(payload, "indoor.temperature")),
    numVal(tryRead(payload, "indoor.humidity")),
    numVal(tryRead(payload, "outdoor.temperature")),
    numVal(tryRead(payload, "outdoor.humidity")),
    numVal(tryRead(payload, "outdoor.dew_point")),
    numVal(tryRead(payload, "outdoor.feels_like")),
    numVal(tryRead(payload, "wind.wind_speed")),
    numVal(tryRead(payload, "wind.wind_gust")),
    numVal(tryRead(payload, "wind.wind_direction")),
    numVal(tryRead(payload, "pressure.absolute") ?? tryRead(payload, "barometer.absolute") ?? tryRead(payload, "barometer.abs")),
    numVal(tryRead(payload, "pressure.relative") ?? tryRead(payload, "barometer.relative") ?? tryRead(payload, "barometer.rel")),
    numVal(tryRead(payload, "solar_and_uvi.solar")),
    numVal(tryRead(payload, "solar_and_uvi.uvi")),
    numVal(tryRead(payload, "rainfall.hourly")),
    numVal(tryRead(payload, "rainfall.rain_event")),
    numVal(tryRead(payload, "rainfall.daily")),
    numVal(tryRead(payload, "rainfall.weekly")),
    numVal(tryRead(payload, "rainfall.monthly")),
    numVal(tryRead(payload, "rainfall.yearly")),
    numVal(tryRead(payload, "pm25.pm25"))
  );
  await appendCsv(mainFile, mainHeader, mainRow);
}

/**
 * Gets the path to the realtime data cache file.
 * @returns {string} The cache file path.
 * @private
 */
function cachePath() {
  return path.join(process.cwd(), "DNT", "rt-last.json");
}

/**
 * Caches the latest realtime data record to a file.
 * @param {{ ok: boolean; updatedAt: string; data?: any; error?: string }} rec - The record to cache.
 */
export async function setLastRealtime(rec: { ok: boolean; updatedAt: string; data?: any; error?: string }) {
  const dnt = path.join(process.cwd(), "DNT");
  await ensureDir(dnt);
  try {
    await fs.writeFile(cachePath(), JSON.stringify(rec), "utf8");
  } catch (e) {
    // best-effort; ignore
  }
}

/**
 * Retrieves the last cached realtime data record.
 * @returns {Promise<{ ok: boolean; updatedAt: string; data?: any; error?: string } | null>} A promise that resolves to the cached record, or null if not found.
 */
export async function getLastRealtime(): Promise<{ ok: boolean; updatedAt: string; data?: any; error?: string } | null> {
  try {
    const txt = await fs.readFile(cachePath(), "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/**
 * Fetches the latest data from the Ecowitt API, archives it to CSV, and caches it.
 * @param {boolean} [all=true] - Whether to fetch all data or a subset.
 * @returns {Promise<any>} A promise that resolves to the JSON response from the API.
 */
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
    // Update temperature min/max tracking
    updateTempMinMax(payload);
    // Log success with ISO timestamp
    try {
      console.log(`[rt] update ok: ${new Date().toISOString()}`);
    } catch {}
    await setLastRealtime({ ok: true, updatedAt: new Date().toISOString(), data: payload });
  }
  return data;
}

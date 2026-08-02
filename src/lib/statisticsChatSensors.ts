import { ensureAllsensorsParquetsInRange } from "@/lib/db/ingest";
import { normalizeName, parquetListLiteral, quoteIdent, sqlNum } from "@/lib/data/columns";
import channelConfig from "@/config/channels.json";
import type { StatisticsChatFacts, StatisticsChatIntent, StatisticsChatPeriod } from "@/types/statisticsChat";

type SensorRow = { day: string; avg: number | null; max: number | null };
type SensorKind = NonNullable<StatisticsChatIntent["measurement"]>;

const H: Record<SensorKind, { terms: string[]; unit: string }> = {
  temperature: { terms: ["temperatur", "temperature", "temp"], unit: "°C" },
  humidity: { terms: ["feuchtigkeit", "humidity", "humid"], unit: "%" },
  pressure: { terms: ["druck", "pressure", "barometer"], unit: "hPa" },
  wind: { terms: ["wind", "geschwindigkeit"], unit: "km/h" },
  gust: { terms: ["boe", "gust"], unit: "km/h" },
  precipitation: { terms: ["regen", "rain", "niederschlag"], unit: "mm" },
  solar: { terms: ["solar", "strahlung", "radiation"], unit: "W/m²" },
  uv: { terms: ["ultraviolett", "uv"], unit: "UV" },
  pm: { terms: ["pm25", "pm10", "feinstaub"], unit: "µg/m³" },
  co2: { terms: ["co2", "kohlendioxid"], unit: "ppm" },
  battery: { terms: ["batterie", "battery"], unit: "%" },
  soil_moisture: { terms: ["bodenfeuchte", "soilmoisture", "soil"], unit: "%" },
};

export function extractSensorQuestion(message: string): Pick<StatisticsChatIntent, "measurement" | "channel"> | null {
  const q = normalizeName(message);
  const match = q.match(/(?:ch|kanal|channel)(\d+)/);
  const alias = Object.entries(channelConfig).find(([, entry]) => typeof entry?.name === "string" && q.includes(normalizeName(entry.name)));
  const channel = match ? `ch${match[1]}` : alias?.[0];
  let measurement: SensorKind | undefined;
  if (/feuchtigkeit|humidity|humid/.test(q)) measurement = "humidity";
  else if (/druck|pressure|barometer/.test(q)) measurement = "pressure";
  else if (/boe|gust/.test(q)) measurement = "gust";
  else if (/wind|geschwindigkeit/.test(q)) measurement = "wind";
  else if (/solar|strahlung|radiation/.test(q)) measurement = "solar";
  else if (/ultraviolett|uv/.test(q)) measurement = "uv";
  else if (/pm25|pm10|feinstaub/.test(q)) measurement = "pm";
  else if (/co2|kohlendioxid/.test(q)) measurement = "co2";
  else if (/batterie|battery/.test(q)) measurement = "battery";
  else if (/bodenfeuchte|soilmoisture|soil/.test(q)) measurement = "soil_moisture";
  else if (channel && /temperatur|temperature|temp|warm|heiss|grad/.test(q)) measurement = "temperature";
  else if (channel && /regen|rain|niederschlag/.test(q)) measurement = "precipitation";
  else return channel ? { channel } : null;
  return { measurement, channel };
}

const inside = (rows: SensorRow[], p: StatisticsChatPeriod) => rows.filter((r) => r.day.slice(0, 10) >= p.start && r.day.slice(0, 10) <= p.end);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const rnd = (v: number | null) => v === null ? null : Math.round(v * 100) / 100;

async function pickColumn(files: string[], intent: StatisticsChatIntent) {
  const { withConn } = await import("@/lib/db/duckdb");
  const arr = parquetListLiteral(files.map((f) => f.replace(/\\/g, "/")));
  return withConn(async (conn) => {
    const d = await conn.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet(${arr}, union_by_name=true)`);
    const names = d.getRowObjects().map((r: any) => String(r.column_name || r.ColumnName || r.column || ""));
    const h = H[intent.measurement || "temperature"];
    const ch = intent.channel ? normalizeName(intent.channel) : "";
    return names.map((name) => {
      const q = normalizeName(name);
      const kind = h.terms.some((term) => q.includes(normalizeName(term)));
      const channel = !ch || q.includes(ch) || q.includes(`channel${ch.slice(2)}`);
      let score = kind ? 10 : 0;
      if (channel) score += 20;
      if (!ch && /outdoor|aussen|outside/.test(q)) score += 5;
      if (/daily|year|jahr|month|monat/.test(q)) score -= 8;
      return { name, score, kind, channel };
    }).filter((x) => x.kind && x.channel).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))[0]?.name || null;
  });
}

async function queryDaily(files: string[], column: string, start: Date, end: Date) {
  const { withConn } = await import("@/lib/db/duckdb");
  const arr = parquetListLiteral(files.map((f) => f.replace(/\\/g, "/")));
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sql = `WITH s AS (SELECT * FROM read_parquet(${arr}, union_by_name=true)), c AS (SELECT ts, ${sqlNum(quoteIdent(column))} AS value FROM s WHERE ts IS NOT NULL AND ts >= strptime('${iso(start)}', ['%Y-%m-%d %H:%M']) AND ts <= strptime('${iso(end)}', ['%Y-%m-%d %H:%M'])) SELECT strftime(date_trunc('day', ts), '%Y-%m-%d') AS day, avg(value) AS avg, max(value) AS max FROM c GROUP BY 1 ORDER BY 1;`;
  return withConn(async (conn) => (await conn.runAndReadAll(sql)).getRowObjects() as SensorRow[]);
}

export async function computeSensorStatisticsChatFacts(intent: StatisticsChatIntent): Promise<StatisticsChatFacts> {
  const start = new Date(`${intent.periods[0].start}T00:00:00`);
  const end = new Date(`${intent.periods[intent.periods.length - 1].end}T23:59:59`);
  const files = await ensureAllsensorsParquetsInRange(start, end);
  if (!files.length) throw new Error("NO_STATISTICS_DATA");
  const column = await pickColumn(files, intent);
  if (!column) throw new Error("STATISTICS_SENSOR_METRIC_NOT_FOUND");
  const rows = await queryDaily(files, column, start, end);
  const unit = intent.unit || H[intent.measurement || "temperature"].unit;
  const warnings = [`Verwendete Messspalte: ${column}.`];

  if (intent.operation === "threshold_days" || intent.operation === "top_days" || intent.operation === "extreme_day") {
    const all = inside(rows, intent.periods[0]).map((r) => ({ date: r.day.slice(0, 10), value: num(r.max), unit })).filter((x): x is { date: string; value: number; unit: string } => x.value !== null);
    const selected = intent.operation === "threshold_days"
      ? all.filter((x) => intent.operator === "<" ? x.value < (intent.value || 0) : intent.operator === ">=" ? x.value >= (intent.value || 0) : x.value > (intent.value || 0)).sort((a, b) => a.date.localeCompare(b.date))
      : all.sort((a, b) => b.value - a.value || a.date.localeCompare(b.date));
    return { operation: intent.operation, metric: column, unit, dataset: "allsensors", periods: intent.periods, count: intent.operation === "threshold_days" ? selected.length : selected.length ? 1 : 0, items: selected.slice(0, intent.limit || (intent.operation === "top_days" ? 5 : 100)), warnings };
  }

  const values = intent.periods.map((p) => {
    const all = inside(rows, p);
    const valid = all.map((r) => num(r.avg)).filter((v): v is number => v !== null);
    const value = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    return { label: p.label, value: rnd(value), unit, validDays: valid.length, availableDays: all.length };
  });
  const valid = values.filter((x): x is typeof values[number] & { value: number } => x.value !== null).sort((a, b) => b.value - a.value);
  const differenceAbsolute = valid.length > 1 ? rnd(valid[0].value - valid[1].value) : null;
  return { operation: intent.operation, metric: column, unit, dataset: "allsensors", periods: intent.periods, values, winner: valid[0]?.label || null, differenceAbsolute, differenceRelativePercent: differenceAbsolute !== null && valid[1]?.value !== 0 ? rnd((differenceAbsolute / Math.abs(valid[1].value)) * 100) : null, warnings };
}

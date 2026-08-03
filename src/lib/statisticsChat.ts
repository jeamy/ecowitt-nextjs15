import { createHash } from "node:crypto";
import { ensureMainParquetsInRange } from "@/lib/db/ingest";
import {
  queryDailyAggregatesInRange,
  readStatistics,
  type DailyAggregateRow,
} from "@/lib/statistics";
import { computeSensorStatisticsChatFacts, extractSensorQuestion } from "@/lib/statisticsChatSensors";
import type {
  StatisticsChatFacts,
  StatisticsChatIntent,
  StatisticsChatPeriod,
} from "@/types/statisticsChat";

function yearPeriod(year: number): StatisticsChatPeriod {
  return {
    label: String(year),
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

const MONTHS: Record<string, number> = {
  januar: 1,
  jan: 1,
  jaenner: 1,
  jänner: 1,
  january: 1,
  februar: 2,
  feb: 2,
  february: 2,
  maerz: 3,
  maer: 3,
  märz: 3,
  mär: 3,
  march: 3,
  april: 4,
  apr: 4,
  mai: 5,
  may: 5,
  juni: 6,
  jun: 6,
  june: 6,
  juli: 7,
  jul: 7,
  july: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  october: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
  december: 12,
};

const SEASONS: Record<string, { label: string; startMonth: number; startDay: number; endMonth: number; endDay: number }> = {
  fruehling: { label: "Frühling", startMonth: 3, startDay: 1, endMonth: 5, endDay: 31 },
  frühling: { label: "Frühling", startMonth: 3, startDay: 1, endMonth: 5, endDay: 31 },
  spring: { label: "Frühling", startMonth: 3, startDay: 1, endMonth: 5, endDay: 31 },
  sommer: { label: "Sommer", startMonth: 6, startDay: 1, endMonth: 8, endDay: 31 },
  summer: { label: "Sommer", startMonth: 6, startDay: 1, endMonth: 8, endDay: 31 },
  herbst: { label: "Herbst", startMonth: 9, startDay: 1, endMonth: 11, endDay: 30 },
  autumn: { label: "Herbst", startMonth: 9, startDay: 1, endMonth: 11, endDay: 30 },
  fall: { label: "Herbst", startMonth: 9, startDay: 1, endMonth: 11, endDay: 30 },
  winter: { label: "Winter", startMonth: 12, startDay: 1, endMonth: 2, endDay: 28 },
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function localIsoDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function monthPeriod(year: number, month: number): StatisticsChatPeriod {
  const endDay = new Date(year, month, 0).getDate();
  const label = `${year}-${pad2(month)}`;
  return {
    label,
    start: `${year}-${pad2(month)}-01`,
    end: `${year}-${pad2(month)}-${pad2(endDay)}`,
  };
}

function dayPeriod(date: string, label = date): StatisticsChatPeriod {
  return { label, start: date, end: date };
}

function validIsoDay(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function normalizeQuestion(message: string) {
  return message
    .normalize("NFKC")
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .replace(/[?!.,;:]+/g, "")
    .trim();
}

function extractYears(message: string) {
  const years = new Set(Array.from(message.matchAll(/\b(?:19|20)\d{2}\b/g), (m) => Number(m[0])));
  for (const match of message.matchAll(/\b((?:19|20)\d{2})\s*(?:-|–|—|bis|to)\s*((?:19|20)\d{2})\b/gi)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 30) {
      for (let year = start; year <= end; year += 1) years.add(year);
    }
  }
  for (const match of message.matchAll(/zwischen\s+((?:19|20)\d{2})\s+und\s+((?:19|20)\d{2})/gi)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 30) {
      for (let year = start; year <= end; year += 1) years.add(year);
    }
  }
  return Array.from(years).sort((a, b) => a - b);
}

function extractThreshold(message: string): number | null {
  const match = message.match(/(?:mehr als|groesser als|größer als|ueber|über|mindestens|ab|unter|weniger als|kleiner als|[<>]=?)\s*(-?\d+(?:[,.]\d+)?)/i);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function thresholdOperator(message: string): StatisticsChatIntent["operator"] {
  if (/(?:unter|weniger als|kleiner als|<)\s*-?\d/i.test(message)) return "<";
  if (/(?:höchstens|hoechstens|maximal|<=)\s*-?\d/i.test(message)) return "<=";
  if (/(?:mindestens|ab|>=)\s*-?\d/i.test(message)) return ">=";
  return ">";
}

function yearPeriods(years: number[]) {
  return years.map(yearPeriod);
}

function monthPeriods(year: number) {
  return Array.from({ length: 12 }, (_, index) => monthPeriod(year, index + 1));
}

function inclusiveRange(years: number[]): StatisticsChatPeriod {
  const first = years[0];
  const last = years[years.length - 1];
  return {
    label: `${first}-${last}`,
    start: `${first}-01-01`,
    end: `${last}-12-31`,
  };
}

function extractMonthPeriod(message: string, years: number[]): StatisticsChatPeriod | null {
  if (!years.length) return null;
  const normalized = normalizeQuestion(message);
  const found = Object.entries(MONTHS).find(([name]) => normalized.includes(name));
  if (!found) return null;
  return monthPeriod(years[0], found[1]);
}

function extractSeasonPeriod(message: string, years: number[]): StatisticsChatPeriod | null {
  if (!years.length) return null;
  const normalized = normalizeQuestion(message);
  const found = Object.entries(SEASONS).find(([name]) => normalized.includes(name));
  if (!found) return null;
  const [year] = years;
  const season = found[1];
  const endYear = season.endMonth < season.startMonth ? year + 1 : year;
  const endDay = season.endMonth === 2 ? new Date(endYear, 2, 0).getDate() : season.endDay;
  return {
    label: `${season.label} ${year}`,
    start: `${year}-${pad2(season.startMonth)}-${pad2(season.startDay)}`,
    end: `${endYear}-${pad2(season.endMonth)}-${pad2(endDay)}`,
  };
}

function defaultPeriod(message: string, years: number[]) {
  const month = extractMonthPeriod(message, years);
  if (month) return month;
  const season = extractSeasonPeriod(message, years);
  if (season) return season;
  return years.length ? inclusiveRange(years) : { label: "alle verfügbaren Daten", start: "1900-01-01", end: "2999-12-31" };
}

function extractDayPeriod(message: string, now = new Date()): StatisticsChatPeriod | null {
  const normalized = normalizeQuestion(message);
  const relativeDays: Array<{ pattern: RegExp; offset: number; label: string }> = [
    { pattern: /\bvorgestern\b|day before yesterday/, offset: -2, label: "vorgestern" },
    { pattern: /\bgestern\b|yesterday/, offset: -1, label: "gestern" },
    { pattern: /\bheute\b|today/, offset: 0, label: "heute" },
  ];
  const relative = relativeDays.find((item) => item.pattern.test(normalized));
  if (relative) {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + relative.offset);
    return dayPeriod(localIsoDate(date), `${relative.label} (${localIsoDate(date)})`);
  }

  const isoMatch = message.match(/\b((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const date = validIsoDay(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (date) return dayPeriod(date);
  }

  const germanDateMatch = message.match(/\b(\d{1,2})\.(\d{1,2})\.((?:19|20)\d{2})\b/);
  if (germanDateMatch) {
    const date = validIsoDay(Number(germanDateMatch[3]), Number(germanDateMatch[2]), Number(germanDateMatch[1]));
    if (date) return dayPeriod(date);
  }

  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
  const namedDateMatch = normalized.match(new RegExp(`\\b(\\d{1,2})\\s+(?:${monthNames})\\s+((?:19|20)\\d{2})\\b`));
  if (namedDateMatch) {
    const monthName = namedDateMatch[0].match(new RegExp(`(?:${monthNames})`))?.[0];
    const month = monthName ? MONTHS[monthName] : null;
    const date = month ? validIsoDay(Number(namedDateMatch[2]), month, Number(namedDateMatch[1])) : null;
    if (date) return dayPeriod(date);
  }

  return null;
}

function rankingPeriods(message: string, years: number[]) {
  const normalized = normalizeQuestion(message);
  if (years.length === 1 && /monat|monate|month|months/.test(normalized)) return monthPeriods(years[0]);
  return years.length ? yearPeriods(years) : [defaultPeriod(message, years)];
}

function groupedPeriods(message: string, years: number[]) {
  const normalized = normalizeQuestion(message);
  if (/(?:monat|monate|month|months|tag|tage|day|days)/.test(normalized)) return [defaultPeriod(message, years)];
  return rankingPeriods(message, years);
}

function groupByFromQuestion(message: string): StatisticsChatIntent["groupBy"] | undefined {
  const normalized = normalizeQuestion(message);
  if (/monat|monate|month|months/.test(normalized)) return "month";
  if (/\btag\b|tage|day|days/.test(normalized)) return "day";
  return undefined;
}

function mainMetricFromQuestion(normalized: string, options: { average?: boolean; minimum?: boolean } = {}) {
  if (/regen|geregnet|regnete|niederschlag|niederschlaeg|rainfall|rain/.test(normalized)) {
    return { metric: "precipitation_total", unit: "mm", aggregation: "sum" as const };
  }
  if (/boe|böe|boeen|böen|gust/.test(normalized)) {
    return { metric: "gust_max", unit: "km/h", aggregation: "max" as const };
  }
  if (/wind|windgeschwindigkeit|windgeschwindigkeiten/.test(normalized)) {
    return { metric: options.average ? "wind_avg" : "wind_max", unit: "km/h", aggregation: options.average ? "avg" as const : "max" as const };
  }
  if (/gefuehlt|gefühlt|feels|windchill|heatindex/.test(normalized)) {
    return { metric: options.minimum ? "feels_like_temperature_min" : "feels_like_temperature_max", unit: "°C", aggregation: options.minimum ? "min" as const : "max" as const };
  }
  if (options.minimum || /kaeltest|kältest|niedrigst|tiefst|minimal|minimum/.test(normalized)) {
    return { metric: "outdoor_temperature_min", unit: "°C", aggregation: "min" as const };
  }
  return { metric: options.average ? "outdoor_temperature_avg" : "outdoor_temperature_max", unit: "°C", aggregation: options.average ? "avg" as const : "max" as const };
}

function rankedExtremeQuestion(message: string) {
  const normalized = normalizeQuestion(message);
  if (/wann|zeitpunkt|gemessen|zwischen/.test(normalized)) return false;
  return /hoechst|höchst|maximal|top|liste|werte|jahren|jahre|niedrigst|tiefst|kaeltest|kältest|minimal|minimum/.test(normalized);
}

export function parseStatisticsQuestion(message: string, now = new Date()): StatisticsChatIntent {
  const normalized = normalizeQuestion(message);
  const requestedDay = extractDayPeriod(message, now);
  const years = extractYears(message);
  const periods = years.length ? yearPeriods(years) : [
    { label: "alle verfügbaren Daten", start: "1900-01-01", end: "2999-12-31" },
  ];
  const hasRain = /regen|geregnet|regnete|niederschlag|niederschlaeg|rainfall|rain/.test(normalized);
  const hasWind = /wind|windgeschwindigkeit|windgeschwindigkeiten|boe|böe|boeen|böen|gust/.test(normalized);
  const hasFeels = /gefuehlt|gefühlt|feels|windchill|heatindex/.test(normalized);
  const hasTemp = /temperatur|temperaturen|warm|wärm|waerm|heiss|heiß|hitze|kalt|kaelt|kält|frost|tmax|tmin|grad|°|°c|niedrigst|tiefst|minimal|minimum/.test(normalized) || hasFeels;
  const hasMainWeatherMetric = hasRain || hasTemp || hasWind;
  const hasExtreme = /höchst|hoechst|maximal|wärmst|waermst|extrem|spitze|groesst|größt|maximum|niedrigst|tiefst|kaeltest|kältest|minimal|minimum/.test(normalized);
  const hasAverage = /durchschnitt|mittelwert|durchschn/.test(normalized);
  const hasMinimum = /niedrigst|tiefst|minimal|kaeltest|kältest|minimum/.test(normalized);
  const hasCount = /wie viele|anzahl|count/.test(normalized);
  const hasAmount = /wie viel|wieviel|wieviele/.test(normalized);
  const hasTotal = /summe|gesamt|insgesamt|total/.test(normalized);
  const hasRanking = /welcher|welches|welche|ranking|rangliste|sortiere|waermst|wärmst|nassest|meiste|meisten|hoechst|höchst|niedrigst|tiefst|kaeltest|kältest|minimal|minimum|top/.test(normalized);
  const hasAvailability = /daten|datenabdeckung|abdeckung|verfuegbarkeit|verfügbarkeit/.test(normalized);
  const hasCompare = years.length >= 2 && /oder|vergleich|wärmer|waermer|mehr|weniger|gegenüber|gegenueber|als/.test(normalized);
  const threshold = extractThreshold(message);
  const sensor = extractSensorQuestion(message);
  const genericSensor = Boolean(sensor && (
    sensor.channel
    || (sensor.measurement && !["precipitation", "wind", "gust"].includes(sensor.measurement))
  ));

  if (genericSensor) {
    const operation: StatisticsChatIntent["operation"] = threshold !== null ? "threshold_days" : hasExtreme ? "extreme_day" : sensor?.measurement === "precipitation" && /groessten|groesste|nassesten|staerksten/.test(normalized) ? "top_days" : years.length >= 2 && (hasCompare || hasAverage) ? "compare_periods" : "compare_periods";
    const unit = sensor?.measurement === "humidity" || sensor?.measurement === "battery" || sensor?.measurement === "soil_moisture" ? "%" : sensor?.measurement === "pressure" ? "hPa" : sensor?.measurement === "wind" || sensor?.measurement === "gust" ? "km/h" : sensor?.measurement === "solar" ? "W/m²" : sensor?.measurement === "uv" ? "UV" : sensor?.measurement === "pm" ? "µg/m³" : sensor?.measurement === "co2" ? "ppm" : sensor?.measurement === "precipitation" ? "mm" : "°C";
    return { operation, metric: "sensor_measurement", dataset: "allsensors", measurement: sensor?.measurement || "temperature", channel: sensor?.channel, operator: operation === "threshold_days" ? (/unter|weniger als/i.test(message) ? "<" : /mindestens|ab/i.test(message) ? ">=" : ">") : undefined, value: operation === "threshold_days" ? threshold ?? undefined : undefined, unit, periods: operation === "extreme_day" && years.length >= 2 ? [inclusiveRange(years)] : [years.length ? inclusiveRange(years) : periods[0]], limit: operation === "top_days" ? 5 : 100 };
  }

  const rankingByAverage = /waermste|wärmste|waermster|wärmster/.test(normalized)
    && /monat|monate|month|months/.test(normalized)
    && !/hoechsten|höchsten|maximal|maximale/.test(normalized);
  const mainMetric = mainMetricFromQuestion(normalized, { average: hasAverage || rankingByAverage, minimum: hasMinimum });
  const groupedBy = groupByFromQuestion(message);

  if (requestedDay && (/wetter|weather|wie war|wie ist|war es|heute|gestern|vorgestern/.test(normalized) || hasMainWeatherMetric)) {
    return {
      operation: "day_summary",
      metric: "weather_summary",
      unit: "",
      periods: [requestedDay],
    };
  }

  if (hasMainWeatherMetric && hasCompare) {
    return { operation: "compare_periods", metric: mainMetric.metric, aggregation: mainMetric.aggregation, unit: mainMetric.unit, periods };
  }
  if (hasRain && years.length >= 2 && /liste|werte|vergleich|mehr|weniger/.test(normalized)) {
    return { operation: "compare_periods", metric: "precipitation_total", unit: "mm", periods };
  }
  if (hasAvailability) {
    return {
      operation: "availability",
      metric: hasRain ? "precipitation_total" : hasTemp ? "outdoor_temperature_avg" : "available_days",
      unit: "%",
      periods: [defaultPeriod(message, years)],
    };
  }
  if (hasMainWeatherMetric && groupedBy === "month" && threshold !== null) {
    const operator = thresholdOperator(message);
    const thresholdMetric = operator?.startsWith("<") && (hasTemp || hasFeels)
      ? mainMetricFromQuestion(normalized, { minimum: true })
      : mainMetric;
    return {
      operation: "threshold_periods",
      metric: thresholdMetric.metric,
      aggregation: thresholdMetric.aggregation,
      groupBy: groupedBy,
      operator,
      value: threshold,
      unit: thresholdMetric.unit,
      periods: groupedPeriods(message, years),
      limit: 100,
    };
  }
  if (hasRain && hasRanking) {
    return {
      operation: "rank_periods",
      metric: mainMetric.metric,
      aggregation: mainMetric.aggregation,
      groupBy: groupedBy,
      unit: mainMetric.unit,
      periods: groupedPeriods(message, years),
      limit: /top\s*(\d+)/.test(normalized) ? Number(normalized.match(/top\s*(\d+)/)?.[1]) : 5,
    };
  }
  if (hasWind && hasRanking) {
    return {
      operation: "rank_periods",
      metric: mainMetric.metric,
      aggregation: mainMetric.aggregation,
      groupBy: groupedBy,
      unit: mainMetric.unit,
      periods: groupedPeriods(message, years),
      limit: /top\s*(\d+)/.test(normalized) ? Number(normalized.match(/top\s*(\d+)/)?.[1]) : 5,
    };
  }
  if (hasRain && hasCount) {
    return {
      operation: "count_days",
      metric: "precipitation_total",
      operator: ">",
      value: 0,
      unit: "mm",
      periods: [defaultPeriod(message, years)],
      limit: 100,
    };
  }
  if (hasRain && (hasTotal || hasAmount)) {
    return {
      operation: "aggregate_period",
      metric: "precipitation_total",
      aggregation: "sum",
      unit: "mm",
      periods: [defaultPeriod(message, years)],
    };
  }
  if (hasTemp && years.length >= 2 && (hasAverage || /wärmer|waermer|durchschnittlich/.test(normalized))) {
    return { operation: "compare_periods", metric: mainMetric.metric, aggregation: mainMetric.aggregation, unit: mainMetric.unit, periods };
  }
  if (hasTemp && hasExtreme && years.length >= 2 && rankedExtremeQuestion(message)) {
    return {
      operation: "rank_periods",
      metric: mainMetric.metric,
      aggregation: mainMetric.aggregation,
      groupBy: groupedBy,
      unit: mainMetric.unit,
      periods: groupedPeriods(message, years),
      limit: groupedBy ? 5 : years.length,
    };
  }
  if (hasTemp && hasExtreme && years.length >= 2) {
    return { operation: "extreme_day", metric: mainMetric.metric, aggregation: mainMetric.aggregation, unit: mainMetric.unit, periods: [inclusiveRange(years)] };
  }
  if (hasTemp && hasRanking) {
    return {
      operation: "rank_periods",
      metric: mainMetric.metric,
      aggregation: mainMetric.aggregation,
      groupBy: groupedBy,
      unit: mainMetric.unit,
      periods: groupedPeriods(message, years),
      limit: /top\s*(\d+)/.test(normalized) ? Number(normalized.match(/top\s*(\d+)/)?.[1]) : 5,
    };
  }
  if (hasTemp && hasAverage) {
    return {
      operation: "aggregate_period",
      metric: mainMetric.metric,
      aggregation: mainMetric.aggregation,
      unit: mainMetric.unit,
      periods: [defaultPeriod(message, years)],
    };
  }
  if (hasTemp && hasCount && threshold !== null) {
    const operator: StatisticsChatIntent["operator"] = /unter|weniger als/i.test(message) ? "<" : /mindestens|ab/i.test(message) ? ">=" : ">";
    return {
      operation: "count_days",
      metric: mainMetric.metric,
      operator,
      value: threshold,
      unit: mainMetric.unit,
      periods: [defaultPeriod(message, years)],
      limit: 100,
    };
  }
  if (hasTemp && threshold !== null) {
    const operator: StatisticsChatIntent["operator"] = /unter|weniger als/i.test(message) ? "<" : /mindestens|ab/i.test(message) ? ">=" : ">";
    return {
      operation: "threshold_days",
      metric: mainMetric.metric,
      operator,
      value: threshold,
      unit: mainMetric.unit,
      periods: [defaultPeriod(message, years)],
      limit: 100,
    };
  }
  if (hasMainWeatherMetric && (hasExtreme || hasRanking || /größten|groessten|nassesten|stärksten regen|staerksten regen/.test(normalized))) {
    return {
      operation: "top_days",
      metric: mainMetric.metric,
      unit: mainMetric.unit,
      periods: [defaultPeriod(message, years)],
      limit: 5,
    };
  }
  if (hasTemp && hasExtreme) {
    return {
      operation: "extreme_day",
      metric: mainMetric.metric,
      aggregation: mainMetric.aggregation,
      unit: mainMetric.unit,
      periods: [defaultPeriod(message, years)],
    };
  }

  throw new Error("UNSUPPORTED_STATISTICS_QUESTION");
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function filterRows(rows: DailyAggregateRow[], period: StatisticsChatPeriod) {
  return rows.filter((row) => row.day.slice(0, 10) >= period.start && row.day.slice(0, 10) <= period.end);
}

function expectedDays(period: StatisticsChatPeriod) {
  const start = new Date(`${period.start}T12:00:00`);
  const end = new Date(`${period.end}T12:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function coverage(validDays: number, expected: number) {
  return expected > 0 ? round((validDays / expected) * 100) : null;
}

function bounds(periods: StatisticsChatPeriod[]) {
  const sorted = periods.slice().sort((a, b) => a.start.localeCompare(b.start));
  return { start: sorted[0].start, end: sorted[sorted.length - 1].end };
}

function periodsContainDate(periods: StatisticsChatPeriod[], date: string) {
  return periods.some((period) => date >= period.start && date <= period.end);
}

function monthPeriodsFromRows(rows: DailyAggregateRow[], basePeriods: StatisticsChatPeriod[]) {
  const monthKeys = new Set<string>();
  for (const row of rows) {
    const date = row.day.slice(0, 10);
    if (!periodsContainDate(basePeriods, date)) continue;
    monthKeys.add(date.slice(0, 7));
  }
  return [...monthKeys].sort().map((key) => {
    const [year, month] = key.split("-").map(Number);
    return monthPeriod(year, month);
  });
}

function dayPeriodsFromRows(rows: DailyAggregateRow[], basePeriods: StatisticsChatPeriod[]) {
  return rows
    .map((row) => row.day.slice(0, 10))
    .filter((date, index, dates) => periodsContainDate(basePeriods, date) && dates.indexOf(date) === index)
    .sort()
    .map((date) => ({ label: date, start: date, end: date }));
}

function calculationPeriodsFromIntent(intent: StatisticsChatIntent, rows: DailyAggregateRow[]) {
  if (intent.groupBy === "month") return monthPeriodsFromRows(rows, intent.periods);
  if (intent.groupBy === "day") return dayPeriodsFromRows(rows, intent.periods);
  return intent.periods;
}

function rowMetricValue(row: DailyAggregateRow, metric: string) {
  if (metric === "precipitation_total") return toNumber(row.rain_day);
  if (metric === "outdoor_temperature_avg") return toNumber(row.tavg);
  if (metric === "outdoor_temperature_min") return toNumber(row.tmin);
  if (metric === "feels_like_temperature_max") return toNumber(row.tfmax);
  if (metric === "feels_like_temperature_min") return toNumber(row.tfmin);
  if (metric === "wind_max") return toNumber(row.wind_max);
  if (metric === "gust_max") return toNumber(row.gust_max);
  if (metric === "wind_avg") return toNumber(row.wind_avg);
  return toNumber(row.tmax);
}

function compareValue(value: number, operator: StatisticsChatIntent["operator"] | undefined, threshold: number) {
  if (operator === "<") return value < threshold;
  if (operator === ">=") return value >= threshold;
  if (operator === "<=") return value <= threshold;
  return value > threshold;
}

function aggregateValues(values: number[], aggregation: StatisticsChatIntent["aggregation"] | undefined) {
  if (!values.length) return null;
  if (aggregation === "sum") return values.reduce((sum, item) => sum + item, 0);
  if (aggregation === "min") return Math.min(...values);
  if (aggregation === "max") return Math.max(...values);
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function metricLabel(metric: string) {
  if (metric === "tmax") return "Höchsttemperatur";
  if (metric === "tmin") return "Tiefsttemperatur";
  if (metric === "tavg") return "Durchschnittstemperatur";
  if (metric === "tfmax") return "Max. gefühlte Temperatur";
  if (metric === "tfmin") return "Min. gefühlte Temperatur";
  if (metric === "rain_day") return "Niederschlag";
  if (metric === "wind_avg") return "Ø Wind";
  if (metric === "wind_max") return "Max. Wind";
  if (metric === "gust_max") return "Stärkste Böe";
  return metric;
}

function describeDayWeather(row: DailyAggregateRow) {
  const description: string[] = [];
  const tmax = toNumber(row.tmax);
  const tmin = toNumber(row.tmin);
  const tavg = toNumber(row.tavg);
  const tfmax = toNumber(row.tfmax);
  const rain = toNumber(row.rain_day);
  const windMax = toNumber(row.wind_max);
  const gustMax = toNumber(row.gust_max);

  if (tmax !== null) {
    if (tmax >= 35) description.push("sehr heiß");
    else if (tmax >= 30) description.push("heiß");
    else if (tmax >= 25) description.push("sommerlich warm");
    else if (tmax >= 20) description.push("warm");
    else if (tmax <= 0) description.push("ganztägig frostig");
    else if (tavg !== null && tavg < 5) description.push("kühl bis kalt");
    else description.push("mild");
  }

  if (tmin !== null && tmin < 0 && tmax !== null && tmax > 0) description.push("mit Frost in der Nacht bzw. Früh");

  if (rain !== null) {
    if (rain >= 30) description.push("sehr nass");
    else if (rain >= 10) description.push("deutlich regnerisch");
    else if (rain > 0) description.push("mit etwas Niederschlag");
    else description.push("trocken");
  }

  if (gustMax !== null) {
    if (gustMax >= 80) description.push("stürmisch");
    else if (gustMax >= 50) description.push("böig");
  } else if (windMax !== null && windMax >= 30) {
    description.push("windig");
  }

  if (tfmax !== null && tmax !== null && tfmax - tmax >= 2) description.push("gefühlt wärmer als die gemessene Lufttemperatur");

  return description.length ? Array.from(new Set(description)) : ["keine eindeutige Einordnung aus den Tagesaggregaten möglich"];
}

function round(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function statisticsChatFingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export async function getStatisticsChatDataRevision() {
  const stats = await readStatistics();
  const years = stats?.years || [];
  const first = years.length ? Math.min(...years.map((year) => year.year)) : null;
  const last = years.length ? Math.max(...years.map((year) => year.year)) : null;
  return statisticsChatFingerprint({ updatedAt: stats?.updatedAt || null, first, last });
}

export async function computeStatisticsChatFacts(intent: StatisticsChatIntent): Promise<StatisticsChatFacts> {
  if (intent.dataset === "allsensors") return computeSensorStatisticsChatFacts(intent);
  const range = bounds(intent.periods);
  const broadStart = new Date(`${range.start}T00:00:00`);
  const broadEnd = new Date(`${range.end}T23:59:59`);
  const parquets = await ensureMainParquetsInRange(broadStart, broadEnd);
  if (!parquets.length) throw new Error("NO_STATISTICS_DATA");
  const rows = await queryDailyAggregatesInRange(parquets, broadStart, broadEnd);
  return computeStatisticsChatFactsFromDailyRows(intent, rows);
}

export function computeStatisticsChatFactsFromDailyRows(intent: StatisticsChatIntent, rows: DailyAggregateRow[]): StatisticsChatFacts {
  const warnings: string[] = [];

  if (intent.operation === "day_summary") {
    const period = intent.periods[0];
    const row = filterRows(rows, period)[0];
    if (!row) {
      return {
        operation: intent.operation,
        metric: intent.metric,
        unit: intent.unit,
        periods: intent.periods,
        count: 0,
        warnings: [`Für ${period.label} wurden keine Tagesaggregate gefunden.`],
        daySummary: {
          date: period.start,
          label: period.label,
          measurements: [],
          description: ["keine Daten vorhanden"],
        },
      } satisfies StatisticsChatFacts;
    }

    const measurements = [
      { key: "tmax", value: toNumber(row.tmax), unit: "°C" },
      { key: "tmin", value: toNumber(row.tmin), unit: "°C" },
      { key: "tavg", value: toNumber(row.tavg), unit: "°C" },
      { key: "tfmax", value: toNumber(row.tfmax), unit: "°C" },
      { key: "tfmin", value: toNumber(row.tfmin), unit: "°C" },
      { key: "rain_day", value: toNumber(row.rain_day), unit: "mm" },
      { key: "wind_avg", value: toNumber(row.wind_avg), unit: "km/h" },
      { key: "wind_max", value: toNumber(row.wind_max), unit: "km/h" },
      { key: "gust_max", value: toNumber(row.gust_max), unit: "km/h" },
    ].map((item) => ({ ...item, label: metricLabel(item.key), value: round(item.value) }));

    return {
      operation: intent.operation,
      metric: intent.metric,
      unit: intent.unit,
      periods: intent.periods,
      count: measurements.filter((item) => item.value !== null).length,
      warnings,
      daySummary: {
        date: row.day.slice(0, 10),
        label: period.label,
        measurements,
        description: describeDayWeather(row),
      },
    } satisfies StatisticsChatFacts;
  }

  if (intent.operation === "threshold_days") {
    const periodRows = filterRows(rows, intent.periods[0]);
    const threshold = intent.value ?? 0;
    const matches = periodRows.filter((row) => {
      const value = rowMetricValue(row, intent.metric);
      if (value === null) return false;
      return compareValue(value, intent.operator, threshold);
    });
    const items = matches
      .map((row) => ({ date: row.day.slice(0, 10), value: rowMetricValue(row, intent.metric) as number, unit: intent.unit }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      operation: intent.operation,
      metric: intent.metric,
      unit: intent.unit,
      periods: intent.periods,
      count: items.length,
      items: items.slice(0, intent.limit || 100),
      warnings,
    } satisfies StatisticsChatFacts;
  }

  if (intent.operation === "count_days") {
    const periodRows = filterRows(rows, intent.periods[0]);
    const threshold = intent.value ?? 0;
    const items = periodRows
      .map((row) => ({ date: row.day.slice(0, 10), value: rowMetricValue(row, intent.metric), unit: intent.unit }))
      .filter((item): item is { date: string; value: number; unit: string } => item.value !== null && compareValue(item.value, intent.operator, threshold))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      operation: intent.operation,
      metric: intent.metric,
      unit: intent.unit,
      periods: intent.periods,
      count: items.length,
      items: items.slice(0, intent.limit || 100),
      warnings,
    } satisfies StatisticsChatFacts;
  }

  if (intent.operation === "top_days") {
    const periodRows = filterRows(rows, intent.periods[0]);
    const items = periodRows
      .map((row) => ({ date: row.day.slice(0, 10), value: rowMetricValue(row, intent.metric), unit: intent.unit }))
      .filter((item): item is { date: string; value: number; unit: string } => item.value !== null)
      .sort((a, b) => intent.aggregation === "min" ? a.value - b.value || a.date.localeCompare(b.date) : b.value - a.value || a.date.localeCompare(b.date));
    return {
      operation: intent.operation,
      metric: intent.metric,
      unit: intent.unit,
      periods: intent.periods,
      count: items.length,
      items: items.slice(0, intent.limit || 5),
      warnings,
    } satisfies StatisticsChatFacts;
  }

  if (intent.operation === "extreme_day") {
    const periodRows = filterRows(rows, intent.periods[0]);
    const values = periodRows
      .map((row) => ({ date: row.day.slice(0, 10), value: rowMetricValue(row, intent.metric) }))
      .filter((item): item is { date: string; value: number } => item.value !== null)
      .sort((a, b) => intent.aggregation === "min" ? a.value - b.value || a.date.localeCompare(b.date) : b.value - a.value || a.date.localeCompare(b.date));
    const top = values[0];
    return {
      operation: intent.operation,
      metric: intent.metric,
      unit: intent.unit,
      periods: intent.periods,
      count: top ? 1 : 0,
      items: top ? [{ ...top, unit: intent.unit }] : [],
      warnings: top ? ["Die Extremwertabfrage verwendet vorhandene Tagesaggregate."] : ["Keine gültigen Messwerte im Zeitraum vorhanden."],
    } satisfies StatisticsChatFacts;
  }

  if (intent.operation === "threshold_periods") {
    const threshold = intent.value ?? 0;
    const calculationPeriods = calculationPeriodsFromIntent(intent, rows);
    const values = calculationPeriods.map((period) => {
      const periodRows = filterRows(rows, period);
      const numeric = periodRows.map((row) => rowMetricValue(row, intent.metric)).filter((item): item is number => item !== null);
      const value = aggregateValues(numeric, intent.aggregation || (intent.metric === "precipitation_total" ? "sum" : "avg"));
      const validDays = intent.metric === "precipitation_total"
        ? periodRows.filter((row) => toNumber(row.rain_day) !== null).length
        : periodRows.filter((row) => rowMetricValue(row, intent.metric) !== null).length;
      return {
        label: period.label,
        value: round(toNumber(value)),
        unit: intent.unit,
        validDays,
        availableDays: periodRows.length,
        expectedDays: expectedDays(period),
        coverage: coverage(validDays, expectedDays(period)),
      };
    });
    const matches = values
      .filter((item): item is typeof values[number] & { value: number } => item.value !== null && compareValue(item.value, intent.operator, threshold))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (!matches.length) warnings.push("Keine Zeiträume erfüllen den angefragten Grenzwert.");
    return {
      operation: intent.operation,
      metric: intent.metric,
      unit: intent.unit,
      periods: calculationPeriods,
      values: matches.slice(0, intent.limit || 100),
      count: matches.length,
      warnings,
    } satisfies StatisticsChatFacts;
  }

  if (intent.operation === "aggregate_period") {
    const values = intent.periods.map((period) => {
      const periodRows = filterRows(rows, period);
      const numeric = periodRows.map((row) => rowMetricValue(row, intent.metric)).filter((value): value is number => value !== null);
      const value = aggregateValues(numeric, intent.aggregation);
      return {
        label: period.label,
        value: round(value),
        unit: intent.unit,
        validDays: numeric.length,
        availableDays: periodRows.length,
        expectedDays: expectedDays(period),
        coverage: coverage(numeric.length, expectedDays(period)),
      };
    });
    if (values.some((item) => item.value === null)) warnings.push("Für mindestens einen Zeitraum fehlen gültige Messwerte.");
    return {
      operation: intent.operation,
      metric: intent.metric,
      unit: intent.unit,
      periods: intent.periods,
      values,
      warnings,
    } satisfies StatisticsChatFacts;
  }

  if (intent.operation === "availability") {
    const values = intent.periods.map((period) => {
      const periodRows = filterRows(rows, period);
      const expected = expectedDays(period);
      const validDays = intent.metric === "precipitation_total"
        ? periodRows.filter((row) => toNumber(row.rain_day) !== null).length
        : intent.metric === "available_days"
          ? periodRows.length
          : periodRows.filter((row) => rowMetricValue(row, intent.metric) !== null).length;
      return {
        label: period.label,
        value: coverage(validDays, expected),
        unit: "%",
        validDays,
        availableDays: periodRows.length,
        expectedDays: expected,
        coverage: coverage(validDays, expected),
      };
    });
    if (values.some((item) => item.coverage !== null && item.coverage < 100)) warnings.push("Für mindestens einen Zeitraum ist die Datenabdeckung unvollständig.");
    return {
      operation: intent.operation,
      metric: intent.metric,
      unit: "%",
      periods: intent.periods,
      values,
      warnings,
    } satisfies StatisticsChatFacts;
  }

  const calculationPeriods = calculationPeriodsFromIntent(intent, rows);
  const values = calculationPeriods.map((period) => {
    const periodRows = filterRows(rows, period);
    const numeric = periodRows.map((row) => rowMetricValue(row, intent.metric)).filter((item): item is number => item !== null);
    const value = aggregateValues(numeric, intent.aggregation || (intent.metric === "precipitation_total" ? "sum" : "avg"));
    const validDays = intent.metric === "precipitation_total"
      ? periodRows.filter((row) => toNumber(row.rain_day) !== null).length
      : periodRows.filter((row) => rowMetricValue(row, intent.metric) !== null).length;
    return {
      label: period.label,
      value: round(toNumber(value)),
      unit: intent.unit,
      validDays,
      availableDays: periodRows.length,
      expectedDays: expectedDays(period),
      coverage: coverage(validDays, expectedDays(period)),
    };
  });
  const numeric = values.filter((item): item is typeof values[number] & { value: number } => item.value !== null);
  const isMinimumRanking = intent.aggregation === "min";
  const winner = numeric.length
    ? numeric.reduce((best, item) => isMinimumRanking ? item.value < best.value ? item : best : item.value > best.value ? item : best).label
    : null;
  const sorted = numeric.slice().sort((a, b) => isMinimumRanking ? a.value - b.value : b.value - a.value);
  const differenceAbsolute = sorted.length >= 2 ? round(Math.abs(sorted[0].value - sorted[1].value)) : null;
  const denominator = sorted.length >= 2 ? Math.abs(sorted[1].value) : 0;
  const differenceRelativePercent = differenceAbsolute !== null && denominator > 0
    ? round((differenceAbsolute / denominator) * 100)
    : null;
  if (values.some((item) => item.value === null)) warnings.push("Für mindestens einen Vergleichszeitraum fehlen gültige Messwerte.");
  if (intent.operation === "rank_periods") {
    return {
      operation: intent.operation,
      metric: intent.metric,
      unit: intent.unit,
      periods: calculationPeriods,
      values: sorted.slice(0, intent.limit || 10),
      winner,
      differenceAbsolute,
      differenceRelativePercent,
      warnings,
    } satisfies StatisticsChatFacts;
  }
  return {
    operation: intent.operation,
    metric: intent.metric,
    unit: intent.unit,
    periods: calculationPeriods,
    values,
    winner,
    differenceAbsolute,
    differenceRelativePercent,
    warnings,
  } satisfies StatisticsChatFacts;
}

export function formatStatisticsChatAnswer(facts: StatisticsChatFacts) {
  const valueText = (value: number | null, unit: string) => value === null ? "keine gültigen Daten" : `${value.toLocaleString("de-DE", { maximumFractionDigits: 2 })} ${unit}`;
  if (facts.operation === "day_summary") {
    const summary = facts.daySummary;
    if (!summary || !summary.measurements.length) return `Für ${facts.periods[0]?.label || "den angefragten Tag"} wurden keine Tagesdaten gefunden.`;
    const measurements = summary.measurements
      .filter((item) => item.value !== null)
      .map((item) => `- ${item.label}: ${valueText(item.value, item.unit)}`)
      .join("\n");
    const description = summary.description.join(", ");
    return `## Wetter am ${summary.label}\n\n${measurements}\n\nKurz eingeordnet: ${description}.`;
  }
  if (facts.operation === "rank_periods") {
    const values = (facts.values || []).map((item, index) => `${index + 1}. ${item.label}: ${valueText(item.value, item.unit)}`).join("; ");
    return values ? `${values}.` : "Im angefragten Zeitraum wurden keine gültigen Werte gefunden.";
  }
  if (facts.operation === "availability") {
    const values = (facts.values || []).map((item) => `${item.label}: ${valueText(item.value, item.unit)} Abdeckung (${item.validDays}/${item.expectedDays ?? item.availableDays} gültige Tage)`).join("; ");
    return values ? `${values}.` : "Für den angefragten Zeitraum wurden keine Daten gefunden.";
  }
  if (facts.operation === "compare_periods") {
    const values = (facts.values || []).map((item) => `${item.label}: ${valueText(item.value, item.unit)}`).join("; ");
    const winner = facts.winner ? ` ${facts.winner} war der höhere Vergleichswert.` : "";
    const difference = facts.differenceAbsolute == null ? "" : ` Differenz: ${valueText(facts.differenceAbsolute, facts.unit)}.`;
    return `${values}.${winner}${difference}`;
  }
  if (facts.operation === "aggregate_period") {
    const values = (facts.values || []).map((item) => `${item.label}: ${valueText(item.value, item.unit)} (${item.validDays} gültige Tage)`).join("; ");
    return values ? `${values}.` : "Im angefragten Zeitraum wurden keine gültigen Werte gefunden.";
  }
  if (facts.operation === "extreme_day") {
    const item = facts.items?.[0];
    const label = /_min$/.test(facts.metric) ? "niedrigste" : "höchste";
    return item ? `Der ${label} gefundene Wert beträgt ${valueText(item.value, item.unit)} am ${item.date}.` : "Im angefragten Zeitraum wurden keine gültigen Werte gefunden.";
  }
  if (facts.operation === "count_days") {
    return `${facts.count || 0} Tage erfüllen die angefragte Bedingung.`;
  }
  if (facts.operation === "threshold_periods") {
    const values = (facts.values || []).map((item) => `${item.label}: ${valueText(item.value, item.unit)}`).join("; ");
    return values ? `${facts.count || facts.values?.length || 0} Zeiträume erfüllen den angefragten Grenzwert: ${values}.` : "Kein Zeitraum erfüllt den angefragten Grenzwert.";
  }
  if (facts.operation === "threshold_days") {
    const first = facts.items?.[0];
    return `${facts.count || 0} Tage erfüllen den angefragten Grenzwert${first ? `; der erste Treffer ist am ${first.date} mit ${valueText(first.value, first.unit)}` : ""}.`;
  }
  if (facts.dataset === "allsensors") { const first = facts.items?.[0]; return first ? `Die größten Messwerte beginnen am ${first.date} mit ${valueText(first.value, first.unit)}.` : "Im angefragten Zeitraum wurden keine gültigen Messwerte gefunden."; }
  const first = facts.items?.[0];
  return first ? `Die größten Niederschlagswerte beginnen am ${first.date} mit ${valueText(first.value, first.unit)}.` : "Im angefragten Zeitraum wurden keine Niederschlagswerte gefunden.";
}

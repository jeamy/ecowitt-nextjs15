import { createHash } from "node:crypto";
import { ensureMainParquetsInRange } from "@/lib/db/ingest";
import {
  computeStatsFromDaily,
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
  jaenner: 1,
  jänner: 1,
  january: 1,
  februar: 2,
  february: 2,
  maerz: 3,
  märz: 3,
  march: 3,
  april: 4,
  mai: 5,
  may: 5,
  juni: 6,
  june: 6,
  juli: 7,
  july: 7,
  august: 8,
  september: 9,
  oktober: 10,
  october: 10,
  november: 11,
  dezember: 12,
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

function monthPeriod(year: number, month: number): StatisticsChatPeriod {
  const endDay = new Date(year, month, 0).getDate();
  const label = `${year}-${pad2(month)}`;
  return {
    label,
    start: `${year}-${pad2(month)}-01`,
    end: `${year}-${pad2(month)}-${pad2(endDay)}`,
  };
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
  return Array.from(new Set(Array.from(message.matchAll(/\b(?:19|20)\d{2}\b/g), (m) => Number(m[0])))).sort((a, b) => a - b);
}

function extractThreshold(message: string): number | null {
  const match = message.match(/(?:mehr als|ueber|über|mindestens|ab|unter|weniger als)\s*(-?\d+(?:[,.]\d+)?)/i);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
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

function rankingPeriods(message: string, years: number[]) {
  const normalized = normalizeQuestion(message);
  if (years.length === 1 && /monat|monate|month|months/.test(normalized)) return monthPeriods(years[0]);
  return years.length ? yearPeriods(years) : [defaultPeriod(message, years)];
}

export function parseStatisticsQuestion(message: string): StatisticsChatIntent {
  const normalized = normalizeQuestion(message);
  const years = extractYears(message);
  const periods = years.length ? yearPeriods(years) : [
    { label: "alle verfügbaren Daten", start: "1900-01-01", end: "2999-12-31" },
  ];
  const hasRain = /regen|geregnet|regnete|niederschlag|rainfall|rain/.test(normalized);
  const hasTemp = /temperatur|temperaturen|warm|wärm|waerm|heiss|heiß|hitze|tmax|grad|°|°c/.test(normalized);
  const hasExtreme = /höchste|hoechste|maximal|maximale|wärmste|waermste|extrem|spitze|groessten|groesste|größten|größte|maximum/.test(normalized);
  const hasAverage = /durchschnitt|mittelwert|durchschn/.test(normalized);
  const hasCount = /wie viele|anzahl|count/.test(normalized);
  const hasAmount = /wie viel|wieviel|wieviele/.test(normalized);
  const hasTotal = /summe|gesamt|insgesamt|total/.test(normalized);
  const hasRanking = /welcher|welches|welche|ranking|rangliste|sortiere|waermste|wärmste|nasseste|meiste|meisten/.test(normalized);
  const hasAvailability = /daten|datenabdeckung|abdeckung|verfuegbarkeit|verfügbarkeit/.test(normalized);
  const hasCompare = years.length >= 2 && /oder|vergleich|wärmer|waermer|mehr|weniger|gegenüber|gegenueber|als/.test(normalized);
  const threshold = extractThreshold(message);
  const sensor = extractSensorQuestion(message);
  const genericSensor = Boolean(sensor && (sensor.channel || (sensor.measurement && sensor.measurement !== "precipitation")));

  if (genericSensor) {
    const operation: StatisticsChatIntent["operation"] = threshold !== null ? "threshold_days" : hasExtreme ? "extreme_day" : sensor?.measurement === "precipitation" && /groessten|groesste|nassesten|staerksten/.test(normalized) ? "top_days" : years.length >= 2 && (hasCompare || hasAverage) ? "compare_periods" : "compare_periods";
    const unit = sensor?.measurement === "humidity" || sensor?.measurement === "battery" || sensor?.measurement === "soil_moisture" ? "%" : sensor?.measurement === "pressure" ? "hPa" : sensor?.measurement === "wind" || sensor?.measurement === "gust" ? "km/h" : sensor?.measurement === "solar" ? "W/m²" : sensor?.measurement === "uv" ? "UV" : sensor?.measurement === "pm" ? "µg/m³" : sensor?.measurement === "co2" ? "ppm" : sensor?.measurement === "precipitation" ? "mm" : "°C";
    return { operation, metric: "sensor_measurement", dataset: "allsensors", measurement: sensor?.measurement || "temperature", channel: sensor?.channel, operator: operation === "threshold_days" ? (/unter|weniger als/i.test(message) ? "<" : /mindestens|ab/i.test(message) ? ">=" : ">") : undefined, value: operation === "threshold_days" ? threshold ?? undefined : undefined, unit, periods: operation === "extreme_day" && years.length >= 2 ? [inclusiveRange(years)] : [years.length ? inclusiveRange(years) : periods[0]], limit: operation === "top_days" ? 5 : 100 };
  }

  if (hasRain && hasCompare) {
    return { operation: "compare_periods", metric: "precipitation_total", unit: "mm", periods };
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
  if (hasRain && hasRanking) {
    return {
      operation: "rank_periods",
      metric: "precipitation_total",
      aggregation: "sum",
      unit: "mm",
      periods: rankingPeriods(message, years),
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
    return { operation: "compare_periods", metric: "outdoor_temperature_avg", unit: "°C", periods };
  }
  if (hasTemp && hasRanking) {
    return {
      operation: "rank_periods",
      metric: "outdoor_temperature_avg",
      aggregation: "avg",
      unit: "°C",
      periods: rankingPeriods(message, years),
      limit: /top\s*(\d+)/.test(normalized) ? Number(normalized.match(/top\s*(\d+)/)?.[1]) : 5,
    };
  }
  if (hasTemp && hasAverage) {
    return {
      operation: "aggregate_period",
      metric: "outdoor_temperature_avg",
      aggregation: "avg",
      unit: "°C",
      periods: [defaultPeriod(message, years)],
    };
  }
  if (hasTemp && hasExtreme && years.length >= 2) {
    return { operation: "extreme_day", metric: "outdoor_temperature_max", unit: "°C", periods: [inclusiveRange(years)] };
  }
  if (hasTemp && hasCount && threshold !== null) {
    const operator: StatisticsChatIntent["operator"] = /unter|weniger als/i.test(message) ? "<" : /mindestens|ab/i.test(message) ? ">=" : ">";
    return {
      operation: "count_days",
      metric: "outdoor_temperature_max",
      operator,
      value: threshold,
      unit: "°C",
      periods: [defaultPeriod(message, years)],
      limit: 100,
    };
  }
  if (hasTemp && threshold !== null) {
    const operator: StatisticsChatIntent["operator"] = /unter|weniger als/i.test(message) ? "<" : /mindestens|ab/i.test(message) ? ">=" : ">";
    return {
      operation: "threshold_days",
      metric: "outdoor_temperature_max",
      operator,
      value: threshold,
      unit: "°C",
      periods: [defaultPeriod(message, years)],
      limit: 100,
    };
  }
  if (hasRain || /größten|groessten|nassesten|stärksten regen|staerksten regen/.test(normalized)) {
    return {
      operation: "top_days",
      metric: "precipitation_total",
      unit: "mm",
      periods: [defaultPeriod(message, years)],
      limit: 5,
    };
  }
  if (hasTemp && hasExtreme) {
    return {
      operation: "extreme_day",
      metric: "outdoor_temperature_max",
      unit: "°C",
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

function rowMetricValue(row: DailyAggregateRow, metric: string) {
  if (metric === "precipitation_total") return toNumber(row.rain_day);
  if (metric === "outdoor_temperature_avg") return toNumber(row.tavg);
  if (metric === "outdoor_temperature_min") return toNumber(row.tmin);
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
      .map((row) => ({ date: row.day.slice(0, 10), value: toNumber(row.rain_day), unit: "mm" }))
      .filter((item): item is { date: string; value: number; unit: string } => item.value !== null)
      .sort((a, b) => b.value - a.value || a.date.localeCompare(b.date));
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
      .map((row) => ({ date: row.day.slice(0, 10), value: toNumber(row.tmax) }))
      .filter((item): item is { date: string; value: number } => item.value !== null)
      .sort((a, b) => b.value - a.value || a.date.localeCompare(b.date));
    const top = values[0];
    return {
      operation: intent.operation,
      metric: intent.metric,
      unit: intent.unit,
      periods: intent.periods,
      count: top ? 1 : 0,
      items: top ? [{ ...top, unit: "°C" }] : [],
      warnings: top ? ["Die Extremwertabfrage verwendet die vorhandenen Tagesmaxima."] : ["Keine Temperaturdaten im Zeitraum vorhanden."],
    } satisfies StatisticsChatFacts;
  }

  if (intent.operation === "aggregate_period") {
    const values = intent.periods.map((period) => {
      const periodRows = filterRows(rows, period);
      const numeric = periodRows.map((row) => rowMetricValue(row, intent.metric)).filter((value): value is number => value !== null);
      let value: number | null = null;
      if (numeric.length) {
        if (intent.aggregation === "sum") value = numeric.reduce((sum, item) => sum + item, 0);
        else if (intent.aggregation === "min") value = Math.min(...numeric);
        else if (intent.aggregation === "max") value = Math.max(...numeric);
        else value = numeric.reduce((sum, item) => sum + item, 0) / numeric.length;
      }
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

  const values = intent.periods.map((period) => {
    const periodRows = filterRows(rows, period);
    const stats = computeStatsFromDaily(periodRows);
    const value = intent.metric === "precipitation_total" ? stats.rain.total : stats.temp.avg;
    const validDays = intent.metric === "precipitation_total"
      ? periodRows.filter((row) => toNumber(row.rain_day) !== null).length
      : periodRows.filter((row) => toNumber(row.tavg) !== null).length;
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
  const winner = numeric.length ? numeric.reduce((best, item) => item.value > best.value ? item : best).label : null;
  const sorted = numeric.slice().sort((a, b) => b.value - a.value);
  const differenceAbsolute = sorted.length >= 2 ? round(sorted[0].value - sorted[1].value) : null;
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
      periods: intent.periods,
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
    periods: intent.periods,
    values,
    winner,
    differenceAbsolute,
    differenceRelativePercent,
    warnings,
  } satisfies StatisticsChatFacts;
}

export function formatStatisticsChatAnswer(facts: StatisticsChatFacts) {
  const valueText = (value: number | null, unit: string) => value === null ? "keine gültigen Daten" : `${value.toLocaleString("de-DE", { maximumFractionDigits: 2 })} ${unit}`;
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
    return item ? `Der höchste gefundene Wert beträgt ${valueText(item.value, item.unit)} am ${item.date}.` : "Im angefragten Zeitraum wurden keine gültigen Werte gefunden.";
  }
  if (facts.operation === "count_days") {
    return `${facts.count || 0} Tage erfüllen die angefragte Bedingung.`;
  }
  if (facts.operation === "threshold_days") {
    const first = facts.items?.[0];
    return `${facts.count || 0} Tage erfüllen den angefragten Grenzwert${first ? `; der erste Treffer ist am ${first.date} mit ${valueText(first.value, first.unit)}` : ""}.`;
  }
  if (facts.dataset === "allsensors") { const first = facts.items?.[0]; return first ? `Die größten Messwerte beginnen am ${first.date} mit ${valueText(first.value, first.unit)}.` : "Im angefragten Zeitraum wurden keine gültigen Messwerte gefunden."; }
  const first = facts.items?.[0];
  return first ? `Die größten Niederschlagswerte beginnen am ${first.date} mit ${valueText(first.value, first.unit)}.` : "Im angefragten Zeitraum wurden keine Niederschlagswerte gefunden.";
}

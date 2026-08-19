import assert from "node:assert/strict";
import test from "node:test";
import {
  computeStatisticsChatFactsFromDailyRows,
  formatStatisticsChatAnswer,
  parseConversionQuestion,
  parseStatisticsQuestion,
} from "@/lib/statisticsChat";
import type { DailyAggregateRow } from "@/lib/statistics";
import type { StatisticsChatHistory, StatisticsChatIntent } from "@/types/statisticsChat";

const rows: DailyAggregateRow[] = [
  { day: "2023-01-01", tmax: 9, tmin: 1, tavg: 5, rain_day: 1, wind_max: 12, gust_max: 20, wind_avg: 5, tfmax: 8, tfmin: 0 },
  { day: "2023-07-15", tmax: 33.5, tmin: 19, tavg: 26, rain_day: 2, wind_max: 40, gust_max: 55, wind_avg: 14, tfmax: 35.2, tfmin: 18 },
  { day: "2024-01-01", tmax: 11, tmin: 3, tavg: 7, rain_day: 5, wind_max: 18, gust_max: 30, wind_avg: 7, tfmax: 10, tfmin: 1 },
  { day: "2024-07-01", tmax: 29.9, tmin: 17, tavg: 23, rain_day: 0, wind_max: 50, gust_max: 70, wind_avg: 16, tfmax: 31, tfmin: 16 },
  { day: "2024-08-01", tmax: 31.2, tmin: 19, tavg: 25, rain_day: 22, wind_max: 22, gust_max: 35, wind_avg: 8, tfmax: 34.1, tfmin: 18 },
  { day: "2025-01-01", tmax: 10, tmin: 2, tavg: 6, rain_day: 8, wind_max: null, gust_max: null, wind_avg: null },
  { day: "2025-07-01", tmax: 30, tmin: 18, tavg: 24, rain_day: 35, wind_max: null, gust_max: null, wind_avg: null },
  { day: "2025-08-10", tmax: 37.4, tmin: 21, tavg: 29, rain_day: 0, wind_max: null, gust_max: null, wind_avg: null },
  { day: "2026-06-01", tmax: 34.1, tmin: 20, tavg: 27, rain_day: null, wind_max: null, gust_max: null, wind_avg: null },
];

test("parses threshold days above 30 C in 2025", () => {
  const intent = parseStatisticsQuestion("Wann hatte es in 2025 mehr als 30 °C?");
  assert.equal(intent.operation, "threshold_days");
  assert.equal(intent.metric, "outdoor_temperature_max");
  assert.equal(intent.operator, ">");
  assert.equal(intent.value, 30);
  assert.deepEqual(intent.periods, [{ label: "2025-2025", start: "2025-01-01", end: "2025-12-31" }]);
});

test("counts threshold days without including exact boundary", () => {
  const intent = parseStatisticsQuestion("Wie viele Tage hatte es 2025 mehr als 30 Grad?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(facts.operation, "count_days");
  assert.equal(facts.count, 1);
  assert.deepEqual(facts.items?.map((item) => item.date), ["2025-08-10"]);
});

test("counts heat days in the current year to date", () => {
  const intent = parseStatisticsQuestion(
    "wieviele hitzetage hat es bisher im jahre 2026 gegeben?",
    new Date("2026-08-11T10:00:00"),
  );
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "count_days");
  assert.equal(intent.metric, "outdoor_temperature_max");
  assert.equal(intent.operator, ">=");
  assert.equal(intent.value, 30);
  assert.equal(intent.conditionLabel, "Hitzetag/Tropentag: Tagesmaximum mindestens 30 °C");
  assert.deepEqual(intent.periods, [{ label: "2026 bisher", start: "2026-01-01", end: "2026-08-11" }]);
  assert.equal(facts.count, 1);
  assert.deepEqual(facts.items?.map((item) => item.date), ["2026-06-01"]);
  assert.equal(facts.conditionLabel, intent.conditionLabel);
});

test("counts multiple weather day classes in one question", () => {
  const intent = parseStatisticsQuestion(
    "wie viele hitzetage und wüstentage hat es bisher im jahr 2026 gegeben?",
    new Date("2026-08-11T10:00:00"),
  );
  const rowsWithDesertDay: DailyAggregateRow[] = [
    ...rows,
    { day: "2026-07-01", tmax: 35.2, tmin: 22, tavg: 29, rain_day: null, wind_max: null, gust_max: null, wind_avg: null },
  ];
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rowsWithDesertDay);
  assert.equal(intent.operation, "count_conditions");
  assert.equal(intent.metric, "weather_day_classes");
  assert.deepEqual(intent.periods, [{ label: "2026 bisher", start: "2026-01-01", end: "2026-08-11" }]);
  assert.deepEqual(intent.conditions?.map((item) => [item.label, item.metric, item.operator, item.value]), [
    ["Hitzetage/Tropentage", "outdoor_temperature_max", ">=", 30],
    ["Wüstentage", "outdoor_temperature_max", ">=", 35],
  ]);
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value]), [
    ["Hitzetage/Tropentage", 2],
    ["Wüstentage", 1],
  ]);
  assert.deepEqual(facts.conditionItems?.map((group) => [group.label, group.items.map((item) => [item.date, item.value])]), [
    ["Hitzetage/Tropentage", [["2026-06-01", 34.1], ["2026-07-01", 35.2]]],
    ["Wüstentage", [["2026-07-01", 35.2]]],
  ]);
});

test("counts summer days, tropical days, tropical nights, frost days and ice days", () => {
  const summerDays = computeStatisticsChatFactsFromDailyRows(parseStatisticsQuestion("Wie viele Sommertage gab es 2024?"), rows);
  const tropicalDays = computeStatisticsChatFactsFromDailyRows(parseStatisticsQuestion("Wie viele Tropentage gab es 2025?"), rows);
  const tropicalNights = computeStatisticsChatFactsFromDailyRows(parseStatisticsQuestion("Wie viele Tropennächte gab es 2025?"), rows);
  const frostDays = computeStatisticsChatFactsFromDailyRows(parseStatisticsQuestion("Wie viele Frosttage gab es 2023?"), rows);
  const iceDays = computeStatisticsChatFactsFromDailyRows(parseStatisticsQuestion("Wie viele Eistage gab es 2023?"), rows);

  assert.equal(summerDays.count, 2);
  assert.equal(summerDays.value, 25);
  assert.equal(summerDays.operator, ">=");
  assert.equal(tropicalDays.count, 2);
  assert.equal(tropicalDays.metric, "outdoor_temperature_max");
  assert.equal(tropicalDays.value, 30);
  assert.equal(tropicalNights.count, 1);
  assert.equal(tropicalNights.metric, "outdoor_temperature_min");
  assert.equal(tropicalNights.value, 20);
  assert.equal(frostDays.count, 0);
  assert.equal(frostDays.metric, "outdoor_temperature_min");
  assert.equal(iceDays.count, 0);
  assert.equal(iceDays.metric, "outdoor_temperature_max");
});

test("sorts precipitation top days descending", () => {
  const intent = parseStatisticsQuestion("Wann waren die Niederschläge am größten?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(facts.operation, "top_days");
  assert.deepEqual(facts.items?.slice(0, 3).map((item) => [item.date, item.value]), [
    ["2025-07-01", 35],
    ["2024-08-01", 22],
    ["2025-01-01", 8],
  ]);
});

test("compares yearly average temperature", () => {
  const intent = parseStatisticsQuestion("War es 2024 durchschnittlich wärmer als 2025?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(facts.operation, "compare_periods");
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value, item.validDays]), [
    ["2024", 18.33, 3],
    ["2025", 19.67, 3],
  ]);
  assert.equal(facts.winner, "2025");
  assert.equal(facts.differenceAbsolute, 1.34);
});

test("finds maximum temperature over multi-year range", () => {
  const intent = parseStatisticsQuestion("Wann wurde die höchste Temperatur gemessen im Zeitraum zwischen 2024 u. 2026?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(facts.operation, "extreme_day");
  assert.deepEqual(facts.items?.[0], { date: "2025-08-10", value: 37.4, unit: "°C" });
});

test("aggregates yearly precipitation sum", () => {
  const intent = parseStatisticsQuestion("Wie viel Niederschlag gab es insgesamt 2025?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(facts.operation, "aggregate_period");
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value, item.validDays]), [["2025-2025", 43, 3]]);
});

test("aggregates precipitation per month across multiple years", () => {
  const rowsWithJuly2026: DailyAggregateRow[] = [
    ...rows,
    { day: "2026-07-01", tmax: 32, tmin: 19, tavg: 25, rain_day: 12, wind_max: null, gust_max: null, wind_avg: null, tfmax: null, tfmin: null },
    { day: "2026-07-15", tmax: 30, tmin: 18, tavg: 24, rain_day: 5, wind_max: null, gust_max: null, wind_avg: null, tfmax: null, tfmin: null },
  ];
  const intent = parseStatisticsQuestion("Wie viel Regen war im Juli 2025 und 2026?");
  assert.equal(intent.operation, "aggregate_period");
  assert.equal(intent.metric, "precipitation_total");
  assert.deepEqual(intent.periods, [
    { label: "2025-07", start: "2025-07-01", end: "2025-07-31" },
    { label: "2026-07", start: "2026-07-01", end: "2026-07-31" },
  ]);
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rowsWithJuly2026);
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value, item.validDays]), [
    ["2025-07", 35, 1],
    ["2026-07", 17, 2],
  ]);
});

test("parses colloquial yearly rain amount", () => {
  const intent = parseStatisticsQuestion("wieviel hat es 2024 geregnet?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(facts.operation, "aggregate_period");
  assert.equal(facts.metric, "precipitation_total");
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value, item.validDays]), [["2024-2024", 27, 3]]);
});

test("rejects questions outside the weather statistics domain", () => {
  assert.throws(
    () => parseStatisticsQuestion("Was ist die Hauptstadt von Frankreich?"),
    /UNSUPPORTED_STATISTICS_QUESTION/,
  );
});

test("parses yesterday weather summary using server time", () => {
  const intent = parseStatisticsQuestion("Wie war das Wetter gestern?", new Date("2025-08-11T10:00:00"));
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "day_summary");
  assert.deepEqual(intent.periods, [{ label: "gestern (2025-08-10)", start: "2025-08-10", end: "2025-08-10" }]);
  assert.equal(facts.daySummary?.date, "2025-08-10");
  assert.deepEqual(facts.daySummary?.measurements.filter((item) => item.value !== null).map((item) => [item.key, item.value]), [
    ["tmax", 37.4],
    ["tmin", 21],
    ["tavg", 29],
    ["rain_day", 0],
  ]);
  assert.ok(facts.daySummary?.description.includes("sehr heiß"));
  assert.ok(facts.daySummary?.description.includes("trocken"));
});

test("parses today and day before yesterday weather summaries using server time", () => {
  const today = parseStatisticsQuestion("Wie ist das Wetter heute?", new Date("2025-08-11T10:00:00"));
  const dayBeforeYesterday = parseStatisticsQuestion("Wie war das Wetter vorgestern?", new Date("2025-08-11T10:00:00"));
  assert.equal(today.operation, "day_summary");
  assert.equal(dayBeforeYesterday.operation, "day_summary");
  assert.deepEqual(today.periods, [{ label: "heute (2025-08-11)", start: "2025-08-11", end: "2025-08-11" }]);
  assert.deepEqual(dayBeforeYesterday.periods, [{ label: "vorgestern (2025-08-09)", start: "2025-08-09", end: "2025-08-09" }]);
});

test("parses explicit weather day formats", () => {
  const dotted = parseStatisticsQuestion("Wie war das Wetter am 10.10.2024?");
  const iso = parseStatisticsQuestion("Wie war das Wetter am 2024-10-10?");
  const named = parseStatisticsQuestion("Wie war das Wetter am 10. Oktober 2024?");
  const abbreviated = parseStatisticsQuestion("Wie war das Wetter am 10. Okt 2024?");
  assert.equal(dotted.operation, "day_summary");
  assert.deepEqual(dotted.periods, [{ label: "2024-10-10", start: "2024-10-10", end: "2024-10-10" }]);
  assert.deepEqual(iso.periods, dotted.periods);
  assert.deepEqual(named.periods, dotted.periods);
  assert.deepEqual(abbreviated.periods, dotted.periods);
});

test("answers whether today was the warmest day in the records", () => {
  const intent = parseStatisticsQuestion("War heute der wärmste Tag in den Aufzeichnungen?", new Date("2025-08-10T10:00:00"));
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "record_check");
  assert.equal(intent.metric, "outdoor_temperature_max");
  assert.equal(facts.recordCheck?.targetDate, "2025-08-10");
  assert.equal(facts.recordCheck?.targetValue, 37.4);
  assert.equal(facts.recordCheck?.bestDate, "2025-08-10");
  assert.equal(facts.recordCheck?.previousBestDate, "2026-06-01");
  assert.equal(facts.recordCheck?.previousBestValue, 34.1);
  assert.equal(facts.recordCheck?.differenceToPreviousBest, 3.3);
  assert.equal(facts.recordCheck?.isRecord, true);
  assert.equal(facts.recordCheck?.rank, 1);
});

test("answers why a specific day was not the warmest day in the records", () => {
  const intent = parseStatisticsQuestion("War der 1. August 2024 der wärmste Tag in den Aufzeichnungen?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "record_check");
  assert.equal(facts.recordCheck?.targetDate, "2024-08-01");
  assert.equal(facts.recordCheck?.targetValue, 31.2);
  assert.equal(facts.recordCheck?.bestDate, "2025-08-10");
  assert.equal(facts.recordCheck?.bestValue, 37.4);
  assert.equal(facts.recordCheck?.isRecord, false);
  assert.equal(facts.recordCheck?.rank, 4);
});

test("ranks months by average temperature", () => {
  const intent = parseStatisticsQuestion("Welcher Monat war 2024 der wärmste?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(facts.operation, "rank_periods");
  assert.equal(facts.metric, "outdoor_temperature_avg");
  assert.deepEqual(facts.values?.slice(0, 3).map((item) => [item.label, item.value, item.validDays]), [
    ["2024-08", 25, 1],
    ["2024-07", 23, 1],
    ["2024-01", 7, 1],
  ]);
});

test("uses season periods for threshold questions", () => {
  const intent = parseStatisticsQuestion("Wie viele Tage hatte es im Sommer 2024 mehr als 30 Grad?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(facts.operation, "count_days");
  assert.deepEqual(intent.periods, [{ label: "Sommer 2024", start: "2024-06-01", end: "2024-08-31" }]);
  assert.equal(facts.count, 1);
});

test("reports data availability for a season", () => {
  const intent = parseStatisticsQuestion("Gibt es Daten für Sommer 2024?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(facts.operation, "availability");
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value, item.validDays, item.expectedDays]), [["Sommer 2024", 2.17, 2, 92]]);
});

test("lists highest temperatures per year instead of one overall maximum", () => {
  const intent = parseStatisticsQuestion("Die höchsten Temperaturen in den Jahren 2023 bis 2024.");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "rank_periods");
  assert.equal(intent.metric, "outdoor_temperature_max");
  assert.equal(intent.aggregation, "max");
  assert.deepEqual(intent.periods, [
    { label: "2023", start: "2023-01-01", end: "2023-12-31" },
    { label: "2024", start: "2024-01-01", end: "2024-12-31" },
  ]);
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value]), [
    ["2023", 33.5],
    ["2024", 31.2],
  ]);
});

test("expands year ranges with dash for yearly highest temperature lists", () => {
  const intent = parseStatisticsQuestion("Höchste Temperaturen 2023–2025");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "rank_periods");
  assert.equal(intent.metric, "outdoor_temperature_max");
  assert.deepEqual(intent.periods, [
    { label: "2023", start: "2023-01-01", end: "2023-12-31" },
    { label: "2024", start: "2024-01-01", end: "2024-12-31" },
    { label: "2025", start: "2025-01-01", end: "2025-12-31" },
  ]);
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value]), [
    ["2025", 37.4],
    ["2023", 33.5],
    ["2024", 31.2],
  ]);
});

test("lists precipitation totals per year for highest precipitation wording", () => {
  const intent = parseStatisticsQuestion("Die höchsten Niederschläge in den Jahren 2023 bis 2024.");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "rank_periods");
  assert.equal(intent.metric, "precipitation_total");
  assert.equal(intent.aggregation, "sum");
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value]), [
    ["2024", 27],
    ["2023", 3],
  ]);
});

test("ranks rainiest months across all records", () => {
  const intent = parseStatisticsQuestion("In welchem Monat in den Aufzeichnungen hat es am meisten geregnet?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "rank_periods");
  assert.equal(intent.metric, "precipitation_total");
  assert.equal(intent.aggregation, "sum");
  assert.equal(intent.groupBy, "month");
  assert.deepEqual(facts.values?.slice(0, 4).map((item) => [item.label, item.value]), [
    ["2025-07", 35],
    ["2024-08", 22],
    ["2025-01", 8],
    ["2024-01", 5],
  ]);
});

test("ranks rainiest months across a multi-year range", () => {
  const intent = parseStatisticsQuestion("In welchem Monat zwischen 2023 und 2025 hat es am meisten geregnet?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "rank_periods");
  assert.equal(intent.groupBy, "month");
  assert.deepEqual(intent.periods, [{ label: "2023-2025", start: "2023-01-01", end: "2025-12-31" }]);
  assert.deepEqual(facts.values?.slice(0, 3).map((item) => [item.label, item.value]), [
    ["2025-07", 35],
    ["2024-08", 22],
    ["2025-01", 8],
  ]);
});

test("ranks rainiest days across all records", () => {
  const intent = parseStatisticsQuestion("Welcher Tag in den Aufzeichnungen hatte den meisten Niederschlag?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "rank_periods");
  assert.equal(intent.metric, "precipitation_total");
  assert.equal(intent.groupBy, "day");
  assert.deepEqual(facts.values?.slice(0, 3).map((item) => [item.label, item.value]), [
    ["2025-07-01", 35],
    ["2024-08-01", 22],
    ["2025-01-01", 8],
  ]);
});

test("lists months where temperatures exceeded a threshold", () => {
  const intent = parseStatisticsQuestion("In welchen Monaten im gesamten Zeitraum waren die Temperaturen > 30 Grad?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "threshold_periods");
  assert.equal(intent.metric, "outdoor_temperature_max");
  assert.equal(intent.groupBy, "month");
  assert.equal(intent.operator, ">");
  assert.equal(intent.value, 30);
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value]), [
    ["2023-07", 33.5],
    ["2024-08", 31.2],
    ["2025-08", 37.4],
    ["2026-06", 34.1],
  ]);
});

test("lists months where temperatures were below a threshold", () => {
  const intent = parseStatisticsQuestion("In welchen Monaten im gesamten Zeitraum waren die Temperaturen < 3 Grad?");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "threshold_periods");
  assert.equal(intent.metric, "outdoor_temperature_min");
  assert.equal(intent.aggregation, "min");
  assert.equal(intent.groupBy, "month");
  assert.equal(intent.operator, "<");
  assert.equal(intent.value, 3);
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value]), [
    ["2023-01", 1],
    ["2025-01", 2],
  ]);
});

test("lists maximum wind speed per year", () => {
  const intent = parseStatisticsQuestion("Die höchsten Windgeschwindigkeiten in den Jahren 2023 bis 2024.");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "rank_periods");
  assert.equal(intent.metric, "wind_max");
  assert.equal(intent.aggregation, "max");
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value]), [
    ["2024", 50],
    ["2023", 40],
  ]);
});

test("lists maximum feels-like temperature per year", () => {
  const intent = parseStatisticsQuestion("Die höchsten gefühlten Temperaturen in den Jahren 2023 bis 2024.");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "rank_periods");
  assert.equal(intent.metric, "feels_like_temperature_max");
  assert.equal(intent.aggregation, "max");
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value]), [
    ["2023", 35.2],
    ["2024", 34.1],
  ]);
});

test("lists lowest temperatures per year", () => {
  const intent = parseStatisticsQuestion("Tiefsten Temperaturen in den Jahren 2023-2025");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "rank_periods");
  assert.equal(intent.metric, "outdoor_temperature_min");
  assert.equal(intent.aggregation, "min");
  assert.deepEqual(intent.periods, [
    { label: "2023", start: "2023-01-01", end: "2023-12-31" },
    { label: "2024", start: "2024-01-01", end: "2024-12-31" },
    { label: "2025", start: "2025-01-01", end: "2025-12-31" },
  ]);
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value]), [
    ["2023", 1],
    ["2025", 2],
    ["2024", 3],
  ]);
});

test("lists lowest feels-like temperatures per year", () => {
  const intent = parseStatisticsQuestion("Die niedrigsten gefühlten Temperaturen in den Jahren 2023 bis 2024.");
  const facts = computeStatisticsChatFactsFromDailyRows(intent, rows);
  assert.equal(intent.operation, "rank_periods");
  assert.equal(intent.metric, "feels_like_temperature_min");
  assert.equal(intent.aggregation, "min");
  assert.deepEqual(facts.values?.map((item) => [item.label, item.value]), [
    ["2023", 0],
    ["2024", 1],
  ]);
});

test("converts explicit mm to liters per m²", () => {
  const intent = parseConversionQuestion("wieviele liter sind 40mm");
  assert.equal(intent?.operation, "unit_conversion");
  assert.equal(intent?.conversion?.fromValue, 40);
  assert.equal(intent?.conversion?.fromUnit, "mm");
  assert.equal(intent?.conversion?.toUnit, "L");
  assert.equal(intent?.conversion?.source, "explicit");
  const facts = computeStatisticsChatFactsFromDailyRows(intent!, []);
  assert.equal(facts.conversion?.toValue, 40);
  assert.equal(facts.conversion?.toUnit, "L");
  const answer = formatStatisticsChatAnswer(facts);
  assert.match(answer, /40 mm entsprechen 40 Liter\/m²/);
  assert.match(answer, /1 mm Niederschlag = 1 Liter pro Quadratmeter/);
});

test("converts explicit mm to cm", () => {
  const intent = parseConversionQuestion("wieviele cm sind 44 mm");
  assert.equal(intent?.operation, "unit_conversion");
  assert.equal(intent?.conversion?.fromValue, 44);
  assert.equal(intent?.conversion?.fromUnit, "mm");
  assert.equal(intent?.conversion?.toUnit, "cm");
  const facts = computeStatisticsChatFactsFromDailyRows(intent!, []);
  assert.equal(facts.conversion?.toValue, 4.4);
  const answer = formatStatisticsChatAnswer(facts);
  assert.match(answer, /44 mm entsprechen 4,4 cm/);
});

test("converts explicit cm to liters per m²", () => {
  const intent = parseConversionQuestion("wieviel liter sind 2 cm");
  assert.equal(intent?.conversion?.fromValue, 2);
  assert.equal(intent?.conversion?.fromUnit, "cm");
  assert.equal(intent?.conversion?.toUnit, "L");
  const facts = computeStatisticsChatFactsFromDailyRows(intent!, []);
  assert.equal(facts.conversion?.toValue, 20);
});

test("converts previous turn rain value to liters via follow-up question", () => {
  const previousIntent = parseStatisticsQuestion("Wie viel Niederschlag gab es insgesamt 2025?");
  const previousFacts = computeStatisticsChatFactsFromDailyRows(previousIntent, rows);
  const history: StatisticsChatHistory = {
    schemaVersion: "ecowitt.statistics-chat-history.v1",
    conversationId: "test-conv",
    messages: [
      { role: "user", content: "Wie viel Niederschlag gab es insgesamt 2025?" },
      { role: "assistant", content: formatStatisticsChatAnswer(previousFacts) },
    ],
    turns: [
      {
        message: "Wie viel Niederschlag gab es insgesamt 2025?",
        result: {
          schema_version: "ecowitt.statistics-chat-answer.v1",
          answer: formatStatisticsChatAnswer(previousFacts),
          facts: previousFacts,
          source: { granularity: "day", dataset: "main", statisticsUpdatedAt: null, dataRevision: "rev" },
          warnings: [],
          mode: "local_fallback",
        },
        createdAt: new Date().toISOString(),
        requestFingerprint: "fp",
        dataRevision: "rev",
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dataRevision: "rev",
  };
  const intent = parseConversionQuestion("wieviele liter sind das bezugnehmend auf die vorhergehende frage", history);
  assert.equal(intent?.operation, "unit_conversion");
  assert.equal(intent?.conversion?.source, "previous_turn");
  assert.equal(intent?.conversion?.fromUnit, "mm");
  assert.equal(intent?.conversion?.fromValue, 43);
  assert.equal(intent?.conversion?.toUnit, "L");
  const facts = computeStatisticsChatFactsFromDailyRows(intent!, []);
  assert.equal(facts.conversion?.toValue, 43);
  assert.ok(facts.conversion?.previousTurnSummary?.includes("43 mm"));
  const answer = formatStatisticsChatAnswer(facts);
  assert.match(answer, /43 mm entsprechen 43 Liter\/m²/);
  assert.match(answer, /Bezugswert:/);
});

test("chained conversion questions skip prior conversion turns to find rain value", () => {
  const rainIntent = parseStatisticsQuestion("Wie viel Niederschlag gab es insgesamt 2025?");
  const rainFacts = computeStatisticsChatFactsFromDailyRows(rainIntent, rows);
  const literIntent: StatisticsChatIntent = {
    operation: "unit_conversion",
    metric: "unit_conversion",
    unit: "L",
    periods: [],
    conversion: { fromValue: 43, fromUnit: "mm", toUnit: "L", source: "previous_turn", previousTurnSummary: "43 mm" },
  };
  const literFacts = computeStatisticsChatFactsFromDailyRows(literIntent, []);
  const history: StatisticsChatHistory = {
    schemaVersion: "ecowitt.statistics-chat-history.v1",
    conversationId: "test-conv-chained",
    messages: [],
    turns: [
      {
        message: "Wie viel Niederschlag gab es insgesamt 2025?",
        result: {
          schema_version: "ecowitt.statistics-chat-answer.v1",
          answer: formatStatisticsChatAnswer(rainFacts),
          facts: rainFacts,
          source: { granularity: "day", dataset: "main", statisticsUpdatedAt: null, dataRevision: "rev" },
          warnings: [],
          mode: "local_fallback",
        },
        createdAt: new Date().toISOString(),
        requestFingerprint: "fp1",
        dataRevision: "rev",
      },
      {
        message: "wieviele liter sind das",
        result: {
          schema_version: "ecowitt.statistics-chat-answer.v1",
          answer: formatStatisticsChatAnswer(literFacts),
          facts: literFacts,
          source: { granularity: "day", dataset: "main", statisticsUpdatedAt: null, dataRevision: "rev" },
          warnings: [],
          mode: "local_fallback",
        },
        createdAt: new Date().toISOString(),
        requestFingerprint: "fp2",
        dataRevision: "rev",
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dataRevision: "rev",
  };
  const cmIntent = parseConversionQuestion("wieviele cm sind das", history);
  assert.equal(cmIntent?.operation, "unit_conversion");
  assert.equal(cmIntent?.conversion?.source, "previous_turn");
  assert.equal(cmIntent?.conversion?.fromUnit, "mm");
  assert.equal(cmIntent?.conversion?.fromValue, 43);
  assert.equal(cmIntent?.conversion?.toUnit, "cm");
  const cmFacts = computeStatisticsChatFactsFromDailyRows(cmIntent!, []);
  assert.equal(cmFacts.conversion?.toValue, 4.3);
});

test("returns null for conversion question without previous rain value", () => {
  const emptyHistory: StatisticsChatHistory = {
    schemaVersion: "ecowitt.statistics-chat-history.v1",
    conversationId: "test-conv-empty",
    messages: [],
    turns: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dataRevision: "rev",
  };
  const intent = parseConversionQuestion("wieviele liter sind das", emptyHistory);
  assert.equal(intent, null);
});

test("returns null for non-conversion questions", () => {
  assert.equal(parseConversionQuestion("Wie viel Regen gab es im Juli 2025?"), null);
  assert.equal(parseConversionQuestion("Was ist die Hauptstadt von Frankreich?"), null);
});

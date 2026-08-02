import assert from "node:assert/strict";
import test from "node:test";
import {
  computeStatisticsChatFactsFromDailyRows,
  parseStatisticsQuestion,
} from "@/lib/statisticsChat";
import type { DailyAggregateRow } from "@/lib/statistics";

const rows: DailyAggregateRow[] = [
  { day: "2024-01-01", tmax: 11, tmin: 3, tavg: 7, rain_day: 5, wind_max: null, gust_max: null, wind_avg: null },
  { day: "2024-07-01", tmax: 29.9, tmin: 17, tavg: 23, rain_day: 0, wind_max: null, gust_max: null, wind_avg: null },
  { day: "2024-08-01", tmax: 31.2, tmin: 19, tavg: 25, rain_day: 22, wind_max: null, gust_max: null, wind_avg: null },
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

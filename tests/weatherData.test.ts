import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { NextRequest } from "next/server";
import { headerKeyForAllsensors, isChannelMetricColumn } from "@/lib/data/channels";

test("channel lookup never substitutes another channel or metric", () => {
  const header = [
    "time", "CH1 Temperature(℃)", "CH1 Taupunkt(℃)", "CH1 Wärmeindex(℃)",
    "CH1 Luftfeuchtigkeit(%)", "CH3 Taupunkt(℃)", "CH3 Wärmeindex(℃)",
    "CH10 Temperature(℃)", "WN35CH3hum(%)",
  ];
  assert.equal(headerKeyForAllsensors(header, "Temperatur", "1"), "CH1 Temperature(℃)");
  assert.equal(headerKeyForAllsensors(header, "Temperatur", "2"), "");
  assert.equal(headerKeyForAllsensors(header, "Temperatur", "3"), "");
  assert.equal(headerKeyForAllsensors(header, "Luftfeuchtigkeit", "3"), "WN35CH3hum(%)");
  assert.equal(headerKeyForAllsensors(header, "Luftfeuchtigkeit", "4"), "");
  assert.equal(headerKeyForAllsensors(["CH10 Temperature(℃)"], "Temperatur", "1"), "");
  assert.equal(headerKeyForAllsensors(["time"], "Temperatur", "1"), "");
  for (const name of header.slice(1)) assert.equal(isChannelMetricColumn(name), true, name);
  assert.equal(isChannelMetricColumn("time"), false);
  assert.equal(isChannelMetricColumn("Temperatur Aussen(℃)"), false);
  assert.equal(headerKeyForAllsensors(["CH2 Humidity(%)"], "Luftfeuchtigkeit", "2"), "CH2 Humidity(%)");
  assert.equal(headerKeyForAllsensors(["CH2 Heat Index(℃)"], "Gefühlte Temperatur", "2"), "CH2 Heat Index(℃)");
});

test("weather data preserves measurement times and channel values", async (t) => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(os.tmpdir(), "ecowitt-weather-"));
  let database: DuckDBInstance | undefined;
  try {
    await mkdir(path.join(dir, "DNT"));
    const mainCsv = [
      "Zeit,Temperatur Aussen(℃),Gefühlte Temperatur(℃),Wind(km/h),Böe(km/h),Regen/Tag(mm)",
      "2026/11/09 11:41,12.5,13,5,10,0",
      "2026/11/09 11:38,12.5,13,7,9,0",
      "2026/11/15 04:46,-4.1,-5,3,8,1",
      "2026/11/15 04:43,-4.1,-5,4,12,1",
      "2026/11/15 12:00,0,1,2,5,1",
      "2026/11/15 06:10,-2,-7,1,4,1",
    ].join("\n");
    const channelHeader = ["Zeit", ...Array.from({ length: 8 }, (_, i) => [
      `CH${i + 1} Temperature(℃)`,
      `CH${i + 1} Taupunkt(℃)`,
      `CH${i + 1} Wärmeindex(℃)`,
      `CH${i + 1} Luftfeuchtigkeit(%)`,
    ]).flat()];
    const channelValues = ["2026/11/16 07:40", ...Array.from({ length: 8 }, (_, i) =>
      i === 3 ? ["", "", "", ""] :
        [i === 2 ? "5.8" : String(11.9 + i), String(i), String(15 + i), String(59 + i)]
    ).flat()];
    await writeFile(path.join(dir, "DNT", "202611A.CSV"), mainCsv);
    await writeFile(path.join(dir, "DNT", "202611Allsensors_A.CSV"),
      [channelHeader.join(","), channelValues.join(",")].join("\n"));
    process.chdir(dir);
    const { getDuckDB, withConn } = await import("@/lib/db/duckdb");
    database = await getDuckDB();
    await mkdir(path.join(dir, "data", "parquet", "allsensors"), { recursive: true });
    await withConn(async (conn) => {
      await conn.run(`
        COPY (
          SELECT strptime("Zeit", '%Y/%m/%d %H:%M') AS ts, *
          FROM read_csv('DNT/202611Allsensors_A.CSV', header=true, all_varchar=true)
        ) TO 'data/parquet/allsensors/202611.parquet' (FORMAT PARQUET)
      `);
    });
    const { GET: getRange } = await import("@/app/api/statistics/range/route");
    const { GET: getChannels } = await import("@/app/api/statistics/channels/route");
    const { GET: getAllsensors } = await import("@/app/api/data/allsensors/route");
    const { computeStatistics } = await import("@/lib/statistics");

    await t.test("range extrema use the earliest matching measurement, not the day bucket", async () => {
      const response = await getRange(new NextRequest("http://localhost/api/statistics/range?month=202611"));
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.stats.temp.maxDate, "2026-11-09 11:38:00");
      assert.equal(data.stats.temp.minDate, "2026-11-15 04:43:00");
      assert.equal(data.stats.feels.maxDate, "2026-11-09 11:38:00");
      assert.equal(data.stats.feels.minDate, "2026-11-15 06:10:00");
      assert.equal(data.stats.wind.maxDate, "2026-11-09 11:38:00");
      assert.equal(data.stats.wind.gustMaxDate, "2026-11-15 04:43:00");
      assert.equal(data.stats.temp.min, -4.1);
      assert.equal(data.stats.temp.max, 12.5);
      assert.deepEqual(data.days.map((day: { day: string }) => day.day), ["2026-11-09", "2026-11-15"]);
    });

    await t.test("partial ranges exclude earlier matching measurements", async () => {
      const response = await getRange(new NextRequest(
        "http://localhost/api/statistics/range?start=2026-11-15T04:45&end=2026-11-15T06:10",
      ));
      const data = await response.json();
      assert.equal(data.stats.temp.minDate, "2026-11-15 04:46:00");
    });

    await t.test("year and month statistics keep their calendar-date format", async () => {
      const data = await computeStatistics();
      assert.equal(data.years[0].temperature.minDate, "2026-11-15");
      assert.equal(data.years[0].months[0].temperature.maxDate, "2026-11-09");
    });

    await t.test("all channel metrics survive VARCHAR parquet schemas at every resolution", async () => {
      for (const resolution of ["minute", "hour", "day"]) {
        const response = await getAllsensors(new Request(
          `http://localhost/api/data/allsensors?month=202611&resolution=${resolution}`,
        ));
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.file, "202611.parquet");
        assert.deepEqual(new Set(data.header), new Set(["time", ...channelHeader.slice(1)]));
        for (let i = 1; i <= 8; i++) {
          const row = data.rows[0];
          assert.equal(row[`CH${i} Temperature(℃)`], i === 4 ? null : i === 3 ? 5.8 : 10.9 + i);
          assert.equal(row[`CH${i} Luftfeuchtigkeit(%)`], i === 4 ? null : 58 + i);
          assert.equal(row[`CH${i} Wärmeindex(℃)`], i === 4 ? null : 14 + i);
        }
      }
    });

    await t.test("channel statistics keep their own values and actual timestamps", async () => {
      const response = await getChannels(new NextRequest(
        "http://localhost/api/statistics/channels?ch=ch3&month=202611",
      ));
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.stats.temp.min, 5.8);
      assert.equal(data.stats.temp.minDate, "2026-11-16 07:40:00");
      assert.equal(data.stats.feels.max, 17);
      assert.equal(data.stats.feels.maxDate, "2026-11-16 07:40:00");
    });
  } finally {
    database?.closeSync();
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  }
});

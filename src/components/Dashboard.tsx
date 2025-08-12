"use client";

import React, { useEffect, useMemo, useState } from "react";
import LineChart, { type LineSeries } from "@/components/LineChart";

type MonthsResp = { months: string[] };

type DataResp = {
  file: string;
  header: string[];
  rows: Array<Record<string, number | string | null>>; // time as string, numeric values averaged
};

type ChannelsConfig = Record<string, { name: string }>; // { ch1: { name: "Living" }, ... }

function pad2(n: number) { return n < 10 ? `0${n}` : String(n); }
function makeTimeTickFormatter(t0: number) {
  return (v: number) => {
    const d = new Date(t0 + Math.round(v) * 60000);
    const dd = pad2(d.getDate());
    const mm = pad2(d.getMonth() + 1);
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    return `${dd}.${mm} ${hh}:${mi}`;
  };
}

const DE_MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
function formatMonthLabel(m: string) {
  // expects YYYYMM
  const year = m.slice(0, 4);
  const mo = Number(m.slice(4, 6));
  const name = DE_MONTHS[(mo || 1) - 1] || m;
  return `${year} ${name}`;
}

type Dataset = "allsensors" | "main";

type Resolution = "minute" | "hour" | "day";

const COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#0ea5e9",
  "#84cc16",
  "#f97316",
];

export default function Dashboard() {
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string>("");
  const [dataAll, setDataAll] = useState<DataResp | null>(null);
  const [dataMain, setDataMain] = useState<DataResp | null>(null);
  const [channelsCfg, setChannelsCfg] = useState<ChannelsConfig>({});

  useEffect(() => {
    fetch("/api/data/months")
      .then((r) => r.json())
      .then((j: MonthsResp) => {
        setMonths(j.months);
        if (j.months.length && !month) setMonth(j.months[0]);
      })
      .catch(() => {});
    fetch("/api/config/channels")
      .then((r) => r.json())
      .then((j: ChannelsConfig) => setChannelsCfg(j))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!month) return;
    // Always fetch both datasets, no selections
    const uAll = new URL("/api/data/allsensors", window.location.origin);
    uAll.searchParams.set("month", month);
    uAll.searchParams.set("resolution", "minute");
    const uMain = new URL("/api/data/main", window.location.origin);
    uMain.searchParams.set("month", month);
    uMain.searchParams.set("resolution", "minute");
    Promise.all([
      fetch(uAll.toString()).then((r) => r.json()).catch(() => null),
      fetch(uMain.toString()).then((r) => r.json()).catch(() => null),
    ]).then(([a, m]) => {
      setDataAll(a);
      setDataMain(m);
    });
  }, [month]);
  // Helpers to build x scaling per dataset
  const xBaseAll = useMemo(() => {
    if (!dataAll?.rows?.length) return null as number | null;
    const times = dataAll.rows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
    return times.length ? times[0].getTime() : null;
  }, [dataAll]);
  const xBaseMain = useMemo(() => {
    if (!dataMain?.rows?.length) return null as number | null;
    const times = dataMain.rows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
    return times.length ? times[0].getTime() : null;
  }, [dataMain]);

  return (
    <div className="w-full max-w-screen-lg mx-auto flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Wetterstation Dashboard</h1>
      {/* Monat-Auswahl (lesbar) */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm">Monat</label>
          <select className="border rounded p-2" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>{formatMonthLabel(m)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Allsensors: alle Reihen einzeln */}
      {dataAll && (
        <div className="rounded-lg border border-gray-200 bg-white dark:bg-black">
          <div className="px-3 py-2 border-b border-gray-200 text-sm font-medium">Allsensors • Datei: {dataAll.file}</div>
          <div className="p-3 flex flex-col gap-4">
            {renderAllCharts(dataAll, channelsCfg, xBaseAll)}
          </div>
        </div>
      )}

      {/* Hauptdaten: alle Reihen einzeln */}
      {dataMain && (
        <div className="rounded-lg border border-gray-200 bg-white dark:bg-black">
          <div className="px-3 py-2 border-b border-gray-200 text-sm font-medium">Hauptdaten (A) • Datei: {dataMain.file}</div>
          <div className="p-3 flex flex-col gap-4">
            {renderMainCharts(dataMain, xBaseMain)}
          </div>
        </div>
      )}
    </div>
  );
}

function renderAllCharts(data: DataResp, channelsCfg: ChannelsConfig, xBase: number | null) {
  const rows = data.rows || [];
  if (!rows.length || !xBase) return <div className="text-xs text-gray-500">Keine Daten</div>;
  const times = rows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
  const xVals = times.map((t) => Math.round((t.getTime() - xBase) / 60000));
  const cols = inferNumericColumns(data);
  const fmt = makeTimeTickFormatter(xBase);
  return (
    <>
      {cols.map((col, i) => {
        const label = prettyAllsensorsLabel(col, channelsCfg);
        const series: LineSeries = {
          id: label,
          color: COLORS[i % COLORS.length],
          points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
        };
        if (!series.points.some((p) => Number.isFinite(p.y))) return null;
        return (
          <div key={col} className="rounded border border-gray-200 p-3">
            <LineChart series={[series]} yLabel={label} xLabel="Zeit" xTickFormatter={fmt} showLegend={false} />
          </div>
        );
      })}
    </>
  );
}

function renderMainCharts(data: DataResp, xBase: number | null) {
  const rows = data.rows || [];
  if (!rows.length || !xBase) return <div className="text-xs text-gray-500">Keine Daten</div>;
  const times = rows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
  const xVals = times.map((t) => Math.round((t.getTime() - xBase) / 60000));
  const cols = inferNumericColumns(data);
  const fmt = makeTimeTickFormatter(xBase);
  return (
    <>
      {cols.map((col, i) => {
        const series: LineSeries = {
          id: col,
          color: COLORS[i % COLORS.length],
          points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
        };
        if (!series.points.some((p) => Number.isFinite(p.y))) return null;
        return (
          <div key={col} className="rounded border border-gray-200 p-3">
            <LineChart series={[series]} yLabel={col} xLabel="Zeit" xTickFormatter={fmt} showLegend={false} />
          </div>
        );
      })}
    </>
  );
}

function toDate(s: string): Date | null {
  // try YYYY/M/D H:MM
  let m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // try YYYY-MM-DD HH:MM
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // fallback
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

function numOrNaN(v: any): number {
  if (v == null) return NaN;
  const n = typeof v === "number" ? v : Number(v);
  return isNaN(n) ? NaN : n;
}

function prettyAllsensorsLabel(header: string, cfg: ChannelsConfig) {
  // Replace leading CHx with configured channel name if present
  const m = header.match(/^CH(\d+)\s+(.*)$/);
  if (m) {
    const key = `ch${m[1]}`;
    const name = cfg[key]?.name || `CH${m[1]}`;
    return `${name} ${m[2]}`;
  }
  return header;
}

function inferNumericColumns(data: DataResp | null): string[] {
  if (!data) return [];
  const header = data.header || [];
  const rows = data.rows || [];
  const numeric: string[] = [];
  for (const h of header) {
    if (h === "Zeit" || h === "Time") continue;
    let count = 0, nums = 0;
    for (let i = 0; i < Math.min(rows.length, 50); i++) {
      const v = rows[i][h];
      if (v != null) count++;
      if (typeof v === "number") nums++;
    }
    if (count > 0 && nums / Math.max(1, count) > 0.6) numeric.push(h);
  }
  return numeric;
}

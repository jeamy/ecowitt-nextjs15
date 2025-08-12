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

type ChannelMetric = "Temperature" | "Luftfeuchtigkeit" | "Taupunkt" | "Wärmeindex";

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
  const [year, setYear] = useState<string>("");
  const [mon, setMon] = useState<string>(""); // MM
  const [resolution, setResolution] = useState<Resolution>("minute");
  const [mode, setMode] = useState<"main" | "channel">("main");
  const [selectedChannel, setSelectedChannel] = useState<string>("ch1");
  const [metric, setMetric] = useState<ChannelMetric>("Temperature");
  const [dataAll, setDataAll] = useState<DataResp | null>(null);
  const [dataMain, setDataMain] = useState<DataResp | null>(null);
  const [channelsCfg, setChannelsCfg] = useState<ChannelsConfig>({});

  const monthsByYear = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const ym of months) {
      const y = ym.slice(0, 4);
      const m = ym.slice(4, 6);
      if (!map[y]) map[y] = [];
      if (!map[y].includes(m)) map[y].push(m);
    }
    for (const y of Object.keys(map)) {
      map[y].sort((a, b) => b.localeCompare(a));
    }
    return map;
  }, [months]);
  const years = useMemo(() => Object.keys(monthsByYear).sort((a, b) => b.localeCompare(a)), [monthsByYear]);

  useEffect(() => {
    fetch("/api/data/months")
      .then((r) => r.json())
      .then((j: MonthsResp) => {
        setMonths(j.months);
        // initialize year/month defaults to most recent available
        if (!year || !mon) {
          const byY: Record<string, string[]> = {};
          for (const ym of j.months) {
            const y = ym.slice(0, 4);
            const m = ym.slice(4, 6);
            if (!byY[y]) byY[y] = [];
            if (!byY[y].includes(m)) byY[y].push(m);
          }
          const ys = Object.keys(byY).sort((a, b) => b.localeCompare(a));
          if (ys.length) {
            const y = ys[0];
            byY[y].sort((a, b) => b.localeCompare(a));
            const m = byY[y][0];
            setYear((prev) => prev || y);
            setMon((prev) => prev || m);
          }
        }
      })
      .catch(() => {});
    fetch("/api/config/channels")
      .then((r) => r.json())
      .then((cfg) => setChannelsCfg(cfg))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!year || !mon) return;
    const monthStr = `${year}${mon}`;
    const uAll = new URL("/api/data/allsensors", window.location.origin);
    uAll.searchParams.set("month", monthStr);
    uAll.searchParams.set("resolution", resolution);
    const uMain = new URL("/api/data/main", window.location.origin);
    uMain.searchParams.set("month", monthStr);
    uMain.searchParams.set("resolution", resolution);
    Promise.all([
      fetch(uAll.toString()).then((r) => r.json()).catch(() => null),
      fetch(uMain.toString()).then((r) => r.json()).catch(() => null),
    ]).then(([a, m]) => {
      setDataAll(a);
      setDataMain(m);
    });
  }, [year, mon, resolution]);
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
      {/* Steuerung: Jahr/Monat, Auflösung, Ansicht, Kanal/Metrik */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm">Jahr</label>
          <select className="border rounded p-2" value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm">Monat</label>
          <select className="border rounded p-2" value={mon} onChange={(e) => setMon(e.target.value)}>
            {(monthsByYear[year] || []).map((m) => (
              <option key={m} value={m}>{DE_MONTHS[Number(m) - 1] || m}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm">Auflösung</label>
          <select className="border rounded p-2" value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
            <option value="minute">Minuten</option>
            <option value="hour">Stunden</option>
            <option value="day">Tage</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm">Ansicht</label>
          <select className="border rounded p-2" value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="main">Hauptsensoren</option>
            <option value="channel">Sensor CH1–CH8</option>
          </select>
        </div>
        {mode === "channel" && (
          <div className="flex flex-col gap-1">
            <label className="text-sm">Sensor</label>
            <select className="border rounded p-2" value={selectedChannel} onChange={(e) => setSelectedChannel(e.target.value)}>
              {getChannelKeys(channelsCfg).map((k) => (
                <option key={k} value={k}>{channelName(k, channelsCfg)}</option>
              ))}
            </select>
          </div>
        )}
        {mode === "channel" && (
          <div className="flex flex-col gap-1">
            <label className="text-sm">Metrik</label>
            <select className="border rounded p-2" value={metric} onChange={(e) => setMetric(e.target.value as ChannelMetric)}>
              <option value="Temperature">Temperatur (℃)</option>
              <option value="Luftfeuchtigkeit">Luftfeuchte (%)</option>
              <option value="Taupunkt">Taupunkt (℃)</option>
              <option value="Wärmeindex">Wärmeindex (℃)</option>
            </select>
          </div>
        )}
      </div>

      {/* Ansicht: Hauptsensoren (gestapelte Charts) */}
      {mode === "main" && dataMain && (
        <div className="rounded-lg border border-gray-200 bg-white dark:bg-black">
          <div className="px-3 py-2 border-b border-gray-200 text-sm font-medium">Hauptdaten (A) • Datei: {dataMain.file}</div>
          <div className="p-3 flex flex-col gap-4">
            {renderMainCharts(dataMain, xBaseMain)}
          </div>
        </div>
      )}

      {/* Ansicht: Ein Sensor (CH1–CH8) mit gewählter Metrik */}
      {mode === "channel" && dataAll && (
        <div className="rounded-lg border border-gray-200 bg-white dark:bg-black">
          <div className="px-3 py-2 border-b border-gray-200 text-sm font-medium">{channelName(selectedChannel, channelsCfg)} • {metric} • Datei: {dataAll.file}</div>
          <div className="p-3 flex flex-col gap-4">
            {renderChannelChart(dataAll, selectedChannel, metric, channelsCfg, xBaseAll)}
          </div>
        </div>
      )}
    </div>
  );
}

function renderChannelChart(data: DataResp, chKey: string, metric: ChannelMetric, channelsCfg: ChannelsConfig, xBase: number | null) {
  const rows = data.rows || [];
  if (!rows.length || !xBase) return <div className="text-xs text-gray-500">Keine Daten</div>;
  const times = rows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
  const xVals = times.map((t) => Math.round((t.getTime() - xBase) / 60000));
  const chNum = (chKey.match(/\d+/)?.[0]) || "1";
  const col = headerKeyForAllsensors(data.header || [], metric, chNum);
  const label = `${channelName(chKey, channelsCfg)} ${metric}`;
  const fmt = makeTimeTickFormatter(xBase);
  const series: LineSeries = {
    id: label,
    color: COLORS[0],
    points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
  };
  if (!series.points.some((p) => Number.isFinite(p.y))) return <div className="text-xs text-gray-500">Keine numerischen Werte</div>;
  return (
    <div className="rounded border border-gray-200 p-3">
      <LineChart series={[series]} yLabel={label} xLabel="Zeit" xTickFormatter={fmt} showLegend={false} />
    </div>
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

function channelName(key: string, cfg: ChannelsConfig) {
  const c = cfg[key];
  if (!c) return key.toUpperCase();
  return c.name || key.toUpperCase();
}

function getChannelKeys(cfg: ChannelsConfig): string[] {
  const keys = Object.keys(cfg);
  if (keys.length) return keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return ["ch1","ch2","ch3","ch4","ch5","ch6","ch7","ch8"];
}

function headerKeyForAllsensors(header: string[], metric: string, chNum: string): string {
  // Prefer CHx <metric>
  const direct = header.find((h) => h.startsWith(`CH${chNum} ${metric}`));
  if (direct) return direct;
  // Humidity alternative from WN35CHxhum
  if (metric === "Luftfeuchtigkeit") {
    const alt = header.find((h) => h.startsWith(`WN35CH${chNum}hum`));
    if (alt) return alt;
  }
  // fallback to first CH for metric
  return header.find((h) => h.includes(metric)) || header[1] || "";
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

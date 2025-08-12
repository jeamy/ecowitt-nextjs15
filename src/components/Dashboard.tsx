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
  const [dataset, setDataset] = useState<Dataset>("allsensors");
  const [resolution, setResolution] = useState<Resolution>("minute");
  const [month, setMonth] = useState<string>("");
  const [data, setData] = useState<DataResp | null>(null);
  const [channelsCfg, setChannelsCfg] = useState<ChannelsConfig>({});

  // Allsensors-specific
  const [metric, setMetric] = useState<"Temperature" | "Luftfeuchtigkeit" | "Taupunkt" | "Wärmeindex">("Temperature");
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["ch1", "ch2", "ch3", "ch4"]);

  // Main-specific
  const [selectedMainCols, setSelectedMainCols] = useState<string[]>([]);

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
    const url = dataset === "allsensors" ? "/api/data/allsensors" : "/api/data/main";
    const u = new URL(url, window.location.origin);
    u.searchParams.set("month", month);
    u.searchParams.set("resolution", resolution);
    fetch(u.toString())
      .then((r) => r.json())
      .then((j: DataResp) => {
        setData(j);
        if (dataset === "main") {
          const numericCols = inferNumericColumns(j);
          setSelectedMainCols((prev) => prev.length ? prev.filter((c) => numericCols.includes(c)) : numericCols.slice(0, 3));
        }
      })
      .catch(() => {});
  }, [dataset, month, resolution]);

  const series: LineSeries[] = useMemo(() => {
    if (!data) return [];
    const rows = data.rows ?? [];
    if (rows.length === 0) return [];

    // Build time base: minutes since first sample
    const times = rows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
    if (!times.length) return [];
    const t0 = times[0].getTime();
    const xVals = times.map((t) => Math.round((t.getTime() - t0) / 60000));

    if (dataset === "allsensors") {
      const chNums = selectedChannels.map((k) => k.replace(/[^\d]/g, "")).filter(Boolean);
      const metrics = metric; // one metric across channels
      const cols = chNums.map((n) => headerKeyForAllsensors(data.header, metrics, n));
      return cols.map((col, i) => ({
        id: labelForChannel(selectedChannels[i], channelsCfg),
        color: COLORS[i % COLORS.length],
        points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
      })).filter((s) => s.points.some((p) => Number.isFinite(p.y)));
    } else {
      const cols = selectedMainCols;
      return cols.map((col, i) => ({
        id: col,
        color: COLORS[i % COLORS.length],
        points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
      })).filter((s) => s.points.some((p) => Number.isFinite(p.y)));
    }
  }, [data, dataset, selectedChannels, metric, channelsCfg, selectedMainCols]);

  const yLabel = dataset === "allsensors" ? metric : (selectedMainCols[0] || "Value");

  return (
    <div className="w-full max-w-screen-lg mx-auto flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Wetterstation Dashboard</h1>

      <Controls
        months={months}
        month={month}
        setMonth={setMonth}
        dataset={dataset}
        setDataset={setDataset}
        resolution={resolution}
        setResolution={setResolution}
        metric={metric}
        setMetric={setMetric}
        channelsCfg={channelsCfg}
        selectedChannels={selectedChannels}
        setSelectedChannels={setSelectedChannels}
        data={data}
        selectedMainCols={selectedMainCols}
        setSelectedMainCols={setSelectedMainCols}
      />

      <div className="rounded-lg border border-gray-200 p-3 bg-white dark:bg-black">
        <div className="text-xs text-gray-500 mb-2">x-Achse: Minuten seit Beginn • Datei: {data?.file || "-"}</div>
        <LineChart series={series} yLabel={yLabel} />
      </div>

      {data && (
        <div className="text-xs text-gray-500">
          <div>Stützpunkte: {data.rows.length}</div>
        </div>
      )}
    </div>
  );
}

function Controls(props: {
  months: string[];
  month: string;
  setMonth: (m: string) => void;
  dataset: Dataset;
  setDataset: (d: Dataset) => void;
  resolution: Resolution;
  setResolution: (r: Resolution) => void;
  metric: "Temperature" | "Luftfeuchtigkeit" | "Taupunkt" | "Wärmeindex";
  setMetric: (m: any) => void;
  channelsCfg: ChannelsConfig;
  selectedChannels: string[];
  setSelectedChannels: (chs: string[]) => void;
  data: DataResp | null;
  selectedMainCols: string[];
  setSelectedMainCols: (cols: string[]) => void;
}) {
  const {
    months, month, setMonth,
    dataset, setDataset,
    resolution, setResolution,
    metric, setMetric,
    channelsCfg, selectedChannels, setSelectedChannels,
    data, selectedMainCols, setSelectedMainCols,
  } = props;

  const numericMainCols = useMemo(() => inferNumericColumns(data), [data]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-sm">Datensatz</label>
        <select className="border rounded p-2" value={dataset} onChange={(e) => setDataset(e.target.value as Dataset)}>
          <option value="allsensors">Allsensors (CH1-CH8)</option>
          <option value="main">Hauptdaten (A)</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm">Monat</label>
        <select className="border rounded p-2" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm">Auflösung</label>
        <select className="border rounded p-2" value={resolution} onChange={(e) => setResolution(e.target.value as any)}>
          <option value="minute">Minuten</option>
          <option value="hour">Stunden</option>
          <option value="day">Tage</option>
        </select>
      </div>

      {dataset === "allsensors" ? (
        <div className="flex flex-col gap-1">
          <label className="text-sm">Metrik</label>
          <select className="border rounded p-2" value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="Temperature">Temperatur (℃)</option>
            <option value="Luftfeuchtigkeit">Luftfeuchte (%)</option>
            <option value="Taupunkt">Taupunkt (℃)</option>
            <option value="Wärmeindex">Wärmeindex (℃)</option>
          </select>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label className="text-sm">Hauptdaten-Spalten</label>
          <div className="flex flex-wrap gap-2">
            {numericMainCols.map((col) => (
              <label key={col} className="text-xs inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={selectedMainCols.includes(col)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedMainCols([...selectedMainCols, col]);
                    else setSelectedMainCols(selectedMainCols.filter((c) => c !== col));
                  }}
                />
                {col}
              </label>
            ))}
          </div>
        </div>
      )}

      {dataset === "allsensors" && (
        <div className="sm:col-span-2">
          <label className="text-sm">Kanäle</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {Object.keys(channelsCfg).map((key) => (
              <button
                key={key}
                onClick={() => toggleChannel(key, selectedChannels, setSelectedChannels)}
                className={`text-xs px-2 py-1 rounded border ${selectedChannels.includes(key) ? "bg-blue-600 text-white border-blue-600" : "bg-transparent"}`}
              >
                {labelForChannel(key, channelsCfg)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
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
  return header.find((h) => h.includes(metric)) || header[1];
}

function labelForChannel(key: string, cfg: ChannelsConfig) {
  const c = cfg[key];
  if (!c) return key.toUpperCase();
  return c.name || key.toUpperCase();
}

function toggleChannel(key: string, selected: string[], setSelected: (arr: string[]) => void) {
  if (selected.includes(key)) setSelected(selected.filter((k) => k !== key));
  else setSelected([...selected, key]);
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
  return numeric.slice(0, 16); // limit for UI
}

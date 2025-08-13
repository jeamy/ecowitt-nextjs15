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

function renderChannelCardCharts(
  data: DataResp,
  channelsCfg: ChannelsConfig,
  xBase: number | null,
  chKey: string
) {
  const rows = data.rows || [];
  if (!rows.length || !xBase) return <div className="text-xs text-gray-500">Keine Daten</div>;
  const times = rows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
  const xVals = times.map((t) => Math.round((t.getTime() - xBase) / 60000));
  const fmt = makeTimeTickFormatter(xBase);
  const metrics: ChannelMetric[] = ["Temperature", "Luftfeuchtigkeit", "Taupunkt", "Wärmeindex"];
  const chNum = (chKey.match(/\d+/)?.[0]) || "1";
  const out: React.ReactNode[] = [];
  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i];
    const col = headerKeyForAllsensors(data.header || [], metric, chNum);
    if (!col) continue;
    const series: LineSeries = {
      id: `${channelName(chKey, channelsCfg)} ${metric}`,
      color: COLORS[i % COLORS.length],
      points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
    };
    if (!series.points.some((p) => Number.isFinite(p.y))) continue;
    out.push(
      <div key={`${chKey}-${metric}`} className="rounded border border-gray-100 p-3">
        <LineChart series={[series]} yLabel={`${metric}`} xLabel="Zeit" xTickFormatter={fmt} showLegend={false} />
      </div>
    );
  }
  if (!out.length) return <div className="text-xs text-gray-500">Keine numerischen Werte</div>;
  return <>{out}</>;
}

function renderAllChannelsCharts(data: DataResp, channelsCfg: ChannelsConfig, xBase: number | null) {
  const rows = data.rows || [];
  if (!rows.length || !xBase) return <div className="text-xs text-gray-500">Keine Daten</div>;
  const times = rows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
  const xVals = times.map((t) => Math.round((t.getTime() - xBase) / 60000));
  const fmt = makeTimeTickFormatter(xBase);
  const metrics: ChannelMetric[] = ["Temperature", "Luftfeuchtigkeit", "Taupunkt", "Wärmeindex"];
  const out: React.ReactNode[] = [];
  for (const chKey of getChannelKeys(channelsCfg)) {
    const chNum = (chKey.match(/\d+/)?.[0]) || "1";
    const channelCharts: React.ReactNode[] = [];
    for (let i = 0; i < metrics.length; i++) {
      const metric = metrics[i];
      const col = headerKeyForAllsensors(data.header || [], metric, chNum);
      if (!col) continue;
      const series: LineSeries = {
        id: `${channelName(chKey, channelsCfg)} ${metric}`,
        color: COLORS[i % COLORS.length],
        points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
      };
      if (!series.points.some((p) => Number.isFinite(p.y))) continue;
      channelCharts.push(
        <div key={`${chKey}-${metric}`} className="rounded border border-gray-100 p-3">
          <LineChart series={[series]} yLabel={`${metric}`} xLabel="Zeit" xTickFormatter={fmt} showLegend={false} />
        </div>
      );
    }
    if (channelCharts.length) {
      out.push(
        <div key={`ch-card-${chKey}`} className="rounded-lg border border-gray-200 bg-white dark:bg-black">
          <div className="px-3 py-2 border-b border-gray-200 text-sm font-medium">{channelName(chKey, channelsCfg)}</div>
          <div className="p-3 flex flex-col gap-4">
            {channelCharts}
          </div>
        </div>
      );
    }
  }
  if (!out.length) return <div className="text-xs text-gray-500">Keine numerischen Werte</div>;
  return <>{out}</>;
}

function GlobalRangeControls(props: {
  min: Date | null;
  max: Date | null;
  pctStart: number; // 0..1000
  pctEnd: number;   // 0..1000
  setPctStart: (n: number) => void;
  setPctEnd: (n: number) => void;
}) {
  const { min, max, pctStart, pctEnd, setPctStart, setPctEnd } = props;
  if (!min || !max) return null;
  const span = max.getTime() - min.getTime();
  const startMs = min.getTime() + Math.round(span * (pctStart / 1000));
  const endMs = min.getTime() + Math.round(span * (pctEnd / 1000));
  const start = new Date(Math.min(Math.max(startMs, min.getTime()), max.getTime()));
  const end = new Date(Math.min(Math.max(endMs, min.getTime()), max.getTime()));
  const startDisp = formatDisplay(start);
  const endDisp = formatDisplay(end);
  const startLocal = formatLocal(start);
  const endLocal = formatLocal(end);

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:bg-black p-3">
      <div className="text-sm font-medium mb-2">Gesamter Zeitraum</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm">Start</label>
          <input
            type="datetime-local"
            className="border rounded p-2"
            value={startLocal}
            onChange={(e) => {
              const d = new Date(e.target.value);
              if (isNaN(d.getTime())) return;
              const p = Math.round(((d.getTime() - min.getTime()) / span) * 1000);
              setPctStart(Math.min(Math.max(p, 0), Math.max(0, pctEnd - 1)));
            }}
          />
          <div className="text-xs text-gray-500">{startDisp}</div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm">Ende</label>
          <input
            type="datetime-local"
            className="border rounded p-2"
            value={endLocal}
            onChange={(e) => {
              const d = new Date(e.target.value);
              if (isNaN(d.getTime())) return;
              const p = Math.round(((d.getTime() - min.getTime()) / span) * 1000);
              setPctEnd(Math.max(Math.min(p, 1000), Math.min(1000, pctStart + 1)));
            }}
          />
          <div className="text-xs text-gray-500">{endDisp}</div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <input
          type="range"
          min={0}
          max={999}
          value={Math.min(pctStart, pctEnd - 1)}
          onChange={(e) => setPctStart(Math.min(Number(e.target.value), pctEnd - 1))}
        />
        <input
          type="range"
          min={1}
          max={1000}
          value={Math.max(pctEnd, pctStart + 1)}
          onChange={(e) => setPctEnd(Math.max(Number(e.target.value), pctStart + 1))}
        />
        <div className="text-xs text-gray-500">{startDisp} — {endDisp}</div>
      </div>
    </div>
  );
}

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
  const [mode, setMode] = useState<"main" | "channel">("channel");
  const [selectedChannel, setSelectedChannel] = useState<string>("ch1");
  const [metric, setMetric] = useState<ChannelMetric>("Temperature");
  const [dataAll, setDataAll] = useState<DataResp | null>(null);
  const [dataMain, setDataMain] = useState<DataResp | null>(null);
  const [channelsCfg, setChannelsCfg] = useState<ChannelsConfig>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [errAll, setErrAll] = useState<string | null>(null);
  const [errMain, setErrMain] = useState<string | null>(null);

  // Globaler Zeitbereich (über alle Monate/Jahre)
  const [useGlobalRange, setUseGlobalRange] = useState<boolean>(false);
  const [extentMin, setExtentMin] = useState<Date | null>(null);
  const [extentMax, setExtentMax] = useState<Date | null>(null);
  const [pctStart, setPctStart] = useState<number>(0);    // 0..1000
  const [pctEnd, setPctEnd] = useState<number>(1000);     // 0..1000

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
  // Datenfetch wird weiter unten ausgelöst, nachdem Start/End berechnet sind.
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

  // Extent laden (globaler Min/Max-Zeitpunkt)
  useEffect(() => {
    if (!useGlobalRange) return;
    fetch("/api/data/extent")
      .then((r) => r.json())
      .then((j) => {
        if (j?.min && j?.max) {
          const dMin = new Date(j.min.replace(" ", "T"));
          const dMax = new Date(j.max.replace(" ", "T"));
          if (!isNaN(dMin.getTime()) && !isNaN(dMax.getTime())) {
            setExtentMin(dMin);
            setExtentMax(dMax);
            setPctStart(0);
            setPctEnd(1000);
            return;
          }
        }
        // Fallback auf Monatsmodus, wenn Extent nicht ermittelbar
        setUseGlobalRange(false);
      })
      .catch(() => { setUseGlobalRange(false); });
  }, [useGlobalRange]);

  // Start/End-Parameter bestimmen
  const startParam = useMemo(() => {
    if (useGlobalRange && extentMin && extentMax) {
      const span = extentMax.getTime() - extentMin.getTime();
      const ms = extentMin.getTime() + Math.round(span * (pctStart / 1000));
      return formatForApi(new Date(ms));
    }
    return undefined;
  }, [useGlobalRange, extentMin, extentMax, pctStart]);
  const endParam = useMemo(() => {
    if (useGlobalRange && extentMin && extentMax) {
      const span = extentMax.getTime() - extentMin.getTime();
      const ms = extentMin.getTime() + Math.round(span * (pctEnd / 1000));
      return formatForApi(new Date(ms));
    }
    return undefined;
  }, [useGlobalRange, extentMin, extentMax, pctEnd]);

  useEffect(() => {
    // Preconditions: Only proceed when required params are ready
    if (useGlobalRange) {
      if (!startParam || !endParam) return; // wait for extent mapping
    } else {
      if (!year || !mon) return; // wait for month selection
    }

    setLoading(true);
    setErrAll(null);
    setErrMain(null);
    const uAll = new URL("/api/data/allsensors", window.location.origin);
    const uMain = new URL("/api/data/main", window.location.origin);
    if (useGlobalRange) {
      uAll.searchParams.set("resolution", resolution);
      uMain.searchParams.set("resolution", resolution);
      if (startParam) uAll.searchParams.set("start", startParam);
      if (endParam) uAll.searchParams.set("end", endParam);
      if (startParam) uMain.searchParams.set("start", startParam);
      if (endParam) uMain.searchParams.set("end", endParam);
    } else {
      const monthStr = `${year}${mon}`;
      uAll.searchParams.set("month", monthStr);
      uMain.searchParams.set("month", monthStr);
      uAll.searchParams.set("resolution", resolution);
      uMain.searchParams.set("resolution", resolution);
    }
    Promise.all([
      fetch(uAll.toString()).then(async (r) => ({ ok: r.ok, body: await r.json() })).catch(() => ({ ok: false, body: null })),
      fetch(uMain.toString()).then(async (r) => ({ ok: r.ok, body: await r.json() })).catch(() => ({ ok: false, body: null })),
    ])
      .then(([a, m]) => {
        if (!a.ok || !a.body || a.body.error) {
          setErrAll(a.body?.error || "Fehler beim Laden Allsensors");
          setDataAll(null);
        } else {
          setDataAll(a.body);
        }
        if (!m.ok || !m.body || m.body.error) {
          setErrMain(m.body?.error || "Fehler beim Laden Hauptdaten");
          setDataMain(null);
        } else {
          setDataMain(m.body);
        }
      })
      .finally(() => setLoading(false));
  }, [useGlobalRange, year, mon, resolution, startParam, endParam]);

  return (
    <div className="w-full max-w-screen-lg mx-auto flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Wetterstation Dashboard</h1>
      {/* Steuerung: Zeitraum, Jahr/Monat (optional), Auflösung, Ansicht, Kanal/Metrik */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="flex items-center gap-2">
          <input id="global-range" type="checkbox" checked={useGlobalRange} onChange={(e) => setUseGlobalRange(e.target.checked)} />
          <label htmlFor="global-range" className="text-sm">Gesamten Zeitraum verwenden</label>
        </div>
        {!useGlobalRange && (
          <>
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
          </>
        )}
        {useGlobalRange && (
          <div className="sm:col-span-2 lg:col-span-3">
            <GlobalRangeControls
              min={extentMin}
              max={extentMax}
              pctStart={pctStart}
              pctEnd={pctEnd}
              setPctStart={setPctStart}
              setPctEnd={setPctEnd}
            />
          </div>
        )}
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
            <label className="text-sm">Kanal</label>
            <select
              className="border rounded p-2"
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
            >
              {getChannelKeys(channelsCfg).map((k) => (
                <option key={k} value={k}>{channelName(k, channelsCfg)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading && (
        <div className="rounded border border-yellow-300 bg-yellow-50 text-yellow-800 p-3 text-sm">Lade Daten…</div>
      )}
      {errMain && (
        <div className="rounded border border-red-300 bg-red-50 text-red-800 p-3 text-sm">{errMain}</div>
      )}
      {errAll && (
        <div className="rounded border border-red-300 bg-red-50 text-red-800 p-3 text-sm">{errAll}</div>
      )}
      {/* Ansicht: Hauptsensoren (gestapelte Charts) */}
      {mode === "main" && dataMain && (
        <div className="rounded-lg border border-gray-200 bg-white dark:bg-black">
          <div className="px-3 py-2 border-b border-gray-200 text-sm font-medium">Hauptdaten (A) • Datei: {dataMain.file}</div>
          <div className="p-3 flex flex-col gap-4">
            {renderMainCharts(dataMain, xBaseMain)}
          </div>
        </div>
      )}

      {/* Ansicht: Einzelner Channel (Auswahl) */}
      {mode === "channel" && dataAll && (
        <div className="rounded-lg border border-gray-200 bg-white dark:bg-black">
          <div className="px-3 py-2 border-b border-gray-200 text-sm font-medium">{channelName(selectedChannel, channelsCfg)} • Datei: {dataAll.file}</div>
          <div className="p-3 flex flex-col gap-4">
            {renderChannelCardCharts(dataAll, channelsCfg, xBaseAll, selectedChannel)}
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

// Helpers for time range controls
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function nearestIndex(times: Date[], ms: number) {
  if (!times.length) return 0;
  let lo = 0, hi = times.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = times[mid].getTime();
    if (t === ms) return mid;
    if (t < ms) lo = mid + 1; else hi = mid - 1;
  }
  const i0 = clamp(lo, 0, times.length - 1);
  const i1 = clamp(hi, 0, times.length - 1);
  const d0 = Math.abs(times[i0].getTime() - ms);
  const d1 = Math.abs(times[i1].getTime() - ms);
  return d0 < d1 ? i0 : i1;
}
function formatDisplay(d: Date) {
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
}
function formatLocal(d: Date) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function formatForApi(d: Date) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
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
  const synonyms: Record<string, string[]> = {
    Temperature: ["Temperature", "Temperatur"],
    Luftfeuchtigkeit: ["Luftfeuchtigkeit"],
    Taupunkt: ["Taupunkt"],
    "Wärmeindex": ["Wärmeindex"],
  };
  const metricsToTry = synonyms[metric as keyof typeof synonyms] || [metric];
  let direct: string | undefined;
  for (const m of metricsToTry) {
    direct = header.find((h) => h.startsWith(`CH${chNum} ${m}`));
    if (direct) break;
  }
  if (direct) return direct;
  // Humidity alternative from WN35CHxhum
  if (metric === "Luftfeuchtigkeit") {
    const alt = header.find((h) => h.startsWith(`WN35CH${chNum}hum`));
    if (alt) return alt;
  }
  // fallback to first CH for metric
  for (const m of metricsToTry) {
    const any = header.find((h) => h.includes(m));
    if (any) return any;
  }
  return header[1] || "";
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

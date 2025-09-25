"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { API_ENDPOINTS } from "@/constants";
import type { StatisticsPayload, YearStats, MonthStats, ThresholdList } from "@/types/statistics";
import StatisticsKpis from "@/components/StatisticsKpis";
import StatisticsLegend from "@/components/StatisticsLegend";
import CalendarHeatmap from "@/components/CalendarHeatmap";
import TopExtremes from "@/components/TopExtremes";

function fmtNum(n: number | null | undefined, fraction = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: fraction, minimumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "–";
  const [y, m, day] = d.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, day || 1);
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function tempColorClass(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  if (v <= -10) return "text-blue-900"; // dunkelblau
  if (v <= 0) return "text-blue-500";   // hellblau
  if (v <= 20) return "text-green-600";  // grün
  if (v <= 25) return "text-orange-500"; // orange
  if (v < 30) return "text-orange-600";  // Richtung rot
  return "text-red-600";                  // rot
}

function ThresholdItem({ label, td, className, unit }: { label: string; td?: ThresholdList; className?: string; unit?: string }) {
  const [open, setOpen] = useState(false);
  const [sortBy, setSortBy] = useState<"date" | "value">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const items = useMemo(() => {
    const anyTd: any = td as any;
    if (!anyTd) return [] as { date: string; value: number }[];
    if (Array.isArray(anyTd.items)) return anyTd.items as { date: string; value: number }[];
    if (Array.isArray(anyTd.dates)) return (anyTd.dates as string[]).map((d) => ({ date: d, value: NaN }));
    return [] as { date: string; value: number }[];
  }, [td]);
  const sorted = useMemo(() => {
    const arr = items.slice();
    arr.sort((a, b) => {
      if (sortBy === "value") {
        const av = Number.isFinite(a.value) ? a.value : Number.NEGATIVE_INFINITY;
        const bv = Number.isFinite(b.value) ? b.value : Number.NEGATIVE_INFINITY;
        return (av - bv) * (sortDir === "asc" ? 1 : -1);
      }
      return (a.date.localeCompare(b.date)) * (sortDir === "asc" ? 1 : -1);
    });
    return arr;
  }, [items, sortBy, sortDir]);
  const count = (td && typeof (td as any).count === "number") ? (td as any).count as number : items.length;
  return (
    <div className="mb-2">
      <button
        className={"text-sm font-medium hover:underline " + (className || "text-blue-600")}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {label}: {count}
      </button>
      {open && items.length > 0 && (
        <div className="mt-1 mb-1 text-[11px] text-gray-600 flex items-center gap-2">
          <span>Sort:</span>
          <button className="underline" onClick={() => setSortBy("date")}>Date</button>
          <button className="underline" onClick={() => setSortBy("value")}>Value</button>
          <button className="underline" onClick={() => setSortDir((d) => d === "asc" ? "desc" : "asc")}>{sortDir.toUpperCase()}</button>
        </div>
      )}
      {open && items.length > 0 && (
        <ul className="mt-1 ml-4 list-disc text-sm text-gray-700 dark:text-gray-300">
          {sorted.map((it) => {
            const badgeBase = "inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-neutral-800";
            const colorCls = unit === "°C" ? tempColorClass(it.value) : "";
            return (
              <li key={it.date}>
                {fmtDate(it.date)} — <span className={`${badgeBase} ${colorCls}`}>{fmtNum(it.value)}{unit ? ` ${unit}` : ""}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TemperatureBlock({ y, stacked }: { y: YearStats | MonthStats; stacked?: boolean }) {
  const { t } = useTranslation();
  const temp = y.temperature;
  return (
    <div className="p-3 rounded border border-gray-200 dark:border-neutral-800">
      <div className="font-semibold mb-2">{t("statistics.temperature", "Temperature")}</div>
      {stacked ? (
        <div className="text-sm space-y-1">
          <div>
            {t("dashboard.highestTemperature")} : <span className={tempColorClass(temp.max)}>{fmtNum(temp.max)} °C</span><br />
            <span className="text-xs text-gray-600">({fmtDate(temp.maxDate)})</span>
          </div>
          <div>
            {t("dashboard.lowestTemperature")} : <span className={tempColorClass(temp.min)}>{fmtNum(temp.min)} °C</span><br />
            <span className="text-xs text-gray-600">({fmtDate(temp.minDate)})</span>
          </div>
          <div>
            {t("dashboard.average")} : {fmtNum(temp.avg)} °C
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div>{t("dashboard.highestTemperature")} : <span className={tempColorClass(temp.max)}>{fmtNum(temp.max)} °C</span> ({fmtDate(temp.maxDate)})</div>
          <div>{t("dashboard.lowestTemperature")} : <span className={tempColorClass(temp.min)}>{fmtNum(temp.min)} °C</span> ({fmtDate(temp.minDate)})</div>
          <div>{t("dashboard.average")} : {fmtNum(temp.avg)} °C</div>
        </div>
      )}
      <div className="mt-2">
        <ThresholdItem className="text-red-600" label={t("dashboard.daysOver30C")} td={temp.over30} unit="°C" />
        <ThresholdItem className="text-orange-500" label={t("statistics.daysOver25C", "Days > 25 °C")} td={temp.over25} unit="°C" />
        <ThresholdItem className="text-green-600" label={t("statistics.daysOver20C", "Days > 20 °C")} td={temp.over20} unit="°C" />
        <ThresholdItem className="text-blue-500" label={t("dashboard.daysUnder0C")} td={temp.under0} unit="°C" />
        <ThresholdItem className="text-blue-900" label={t("statistics.daysUnder10C", "Days < -10 °C")} td={temp.under10} unit="°C" />
      </div>
    </div>
  );
}

function PrecipitationBlock({ y, stacked }: { y: YearStats | MonthStats; stacked?: boolean }) {
  const { t } = useTranslation();
  const p = y.precipitation;
  return (
    <div className="p-3 rounded border border-gray-200 dark:border-neutral-800">
      <div className="font-semibold mb-2">{t("statistics.precipitation", "Precipitation")}</div>
      {stacked ? (
        <div className="text-sm space-y-1">
          <div>{t("dashboard.total")} : {fmtNum(p.total)} mm</div>
          <div>
            {t("statistics.maxDay", "Max day")} : {fmtNum(p.maxDay)} mm<br />
            <span className="text-xs text-gray-600">({fmtDate(p.maxDayDate)})</span>
          </div>
          <div>
            {t("statistics.minDay", "Min day")} : {fmtNum(p.minDay)} mm<br />
            <span className="text-xs text-gray-600">({fmtDate(p.minDayDate)})</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div>{t("dashboard.total")} : {fmtNum(p.total)} mm</div>
          <div>{t("statistics.maxDay", "Max day")} : {fmtNum(p.maxDay)} mm ({fmtDate(p.maxDayDate)})</div>
          <div>{t("statistics.minDay", "Min day")} : {fmtNum(p.minDay)} mm ({fmtDate(p.minDayDate)})</div>
        </div>
      )}
      <div className="mt-2">
        <ThresholdItem label={t("statistics.daysOver20mm", "Days ≥ 20 mm")} td={p.over20mm} unit="mm" />
        <ThresholdItem label={t("dashboard.daysOver30mm")} td={p.over30mm} unit="mm" />
      </div>
    </div>
  );
}

function WindBlock({ y, stacked }: { y: YearStats | MonthStats; stacked?: boolean }) {
  const { t } = useTranslation();
  const w = y.wind;
  return (
    <div className="p-3 rounded border border-gray-200 dark:border-neutral-800">
      <div className="font-semibold mb-2">{t("statistics.wind", "Wind")}</div>
      {stacked ? (
        <div className="text-sm space-y-1">
          <div>
            {t("dashboard.highestWind")} : {fmtNum(w.max)} km/h<br />
            <span className="text-xs text-gray-600">({fmtDate(w.maxDate)})</span>
          </div>
          <div>
            {t("dashboard.highestGust")} : {fmtNum(w.gustMax)} km/h<br />
            <span className="text-xs text-gray-600">({fmtDate(w.gustMaxDate)})</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div>{t("dashboard.highestWind")} : {fmtNum(w.max)} km/h ({fmtDate(w.maxDate)})</div>
          <div>{t("dashboard.highestGust")} : {fmtNum(w.gustMax)} km/h ({fmtDate(w.gustMaxDate)})</div>
        </div>
      )}
    </div>
  );
}

function MonthSection({ m }: { m: MonthStats }) {
  const [open, setOpen] = useState(false);
  const monthLabel = useMemo(() => {
    const dt = new Date(m.year, m.month - 1, 1);
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(dt);
  }, [m.year, m.month]);
  const t = m.temperature;
  const p = m.precipitation;
  return (
    <div className="stat-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2"
        aria-expanded={open}
      >
        <div className="font-medium">{monthLabel}</div>
        {!open && (
          <div className="text-xs text-gray-600 mt-1">
            Tmax {fmtNum(t.max)} °C · Tmin {fmtNum(t.min)} °C · Rain {fmtNum(p.total)} mm
          </div>
        )}
      </button>
      {open && (
        <div className="p-3 grid gap-3">
          <TemperatureBlock y={m} stacked />
          <PrecipitationBlock y={m} stacked />
          <WindBlock y={m} stacked />
        </div>
      )}
    </div>
  );
}

function YearSection({ y }: { y: YearStats }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2 rounded bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700"
        aria-expanded={open}
      >
        <span className="font-semibold mr-2">{t("dashboard.year")}: {y.year}</span>
      </button>
      {open && (
        <div className="mt-2 grid gap-3">
          <TemperatureBlock y={y} />
          <PrecipitationBlock y={y} />
          <WindBlock y={y} />
          <div className="mt-2">
            <div className="font-medium mb-2">{t("dashboard.month")}</div>
            <div className="stat-grid">
              {y.months.map((m) => (
                <MonthSection key={`${y.year}-${m.month}`} m={m} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Statistics() {
  const { t } = useTranslation();
  const [data, setData] = useState<StatisticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(API_ENDPOINTS.STATISTICS, { signal: ac.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json?.ok) throw new Error(String(json?.error || "unknown error"));
        // Ensure stable sorting regardless of cached order
        const yearsSorted = (json.years || [])
          .slice()
          .sort((a: any, b: any) => (b?.year ?? 0) - (a?.year ?? 0))
          .map((y: any) => ({
            ...y,
            months: (y.months || []).slice().sort((m1: any, m2: any) => (m1?.month ?? 0) - (m2?.month ?? 0)),
          }));
        if (!cancelled) setData({ updatedAt: json.updatedAt, years: yearsSorted });
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if (cancelled) return; // effect cleaned up
        // Ignore abort errors (HMR/tab switch cleanup)
        if (e?.name === "AbortError" || msg.toLowerCase().includes("abort")) {
          return;
        }
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  const yearsSorted = useMemo(() => {
    return (data?.years || []).slice().sort((a, b) => (b?.year ?? 0) - (a?.year ?? 0));
  }, [data?.years]);

  // Default selection to latest year when data arrives
  useEffect(() => {
    if (!selectedYear && yearsSorted.length > 0) {
      setSelectedYear(yearsSorted[0].year);
    }
  }, [yearsSorted, selectedYear]);

  const currentYearStats = useMemo(() => {
    if (yearsSorted.length === 0) return null;
    if (selectedYear == null) return yearsSorted[0];
    return yearsSorted.find((y) => y.year === selectedYear) || yearsSorted[0];
  }, [yearsSorted, selectedYear]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("tabs.statistics", "Statistics")}</h2>
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-500">
            {t("dashboard.year")}:&nbsp;
            <select
              className="text-xs bg-white dark:bg-neutral-900 border border-gray-300 dark:border-neutral-700 rounded px-2 py-1"
              value={currentYearStats?.year ?? ""}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {yearsSorted.map((y) => (
                <option key={y.year} value={y.year}>{y.year}</option>
              ))}
            </select>
          </label>
          <div className="text-xs text-gray-500">
            {t("statuses.lastUpdate")} {data?.updatedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.updatedAt)) : "–"}
          </div>
        </div>
      </div>
      {currentYearStats && (
        <div>
          <StatisticsKpis y={currentYearStats} />
          <StatisticsLegend />
          <CalendarHeatmap year={currentYearStats.year} />
          <TopExtremes year={currentYearStats.year} />
        </div>
      )}
      {loading && <div className="text-sm text-gray-600 dark:text-gray-300">{t("statuses.loading")}</div>}
      {error && <div className="text-sm text-red-600">{t("statuses.error")}: {error}</div>}
      {!loading && !error && data && data.years.length === 0 && (
        <div className="text-sm text-gray-600 dark:text-gray-300">{t("statuses.noData")}</div>
      )}
      {!loading && !error && yearsSorted.length > 0 && (
        <div>
          {yearsSorted.map((y) => (
            <YearSection key={y.year} y={y} />
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { API_ENDPOINTS } from "@/constants";
import type { StatisticsPayload, YearStats, MonthStats, ThresholdDates } from "@/types/statistics";

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

function ThresholdItem({ label, td, className }: { label: string; td?: ThresholdDates; className?: string }) {
  const [open, setOpen] = useState(false);
  const safe = td ?? { count: 0, dates: [] as string[] };
  return (
    <div className="mb-2">
      <button
        className={"text-sm font-medium hover:underline " + (className || "text-blue-600")}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {label}: {safe.count}
      </button>
      {open && safe.dates.length > 0 && (
        <ul className="mt-1 ml-4 list-disc text-sm text-gray-700 dark:text-gray-300">
          {safe.dates.map((d) => (
            <li key={d}>{fmtDate(d)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TemperatureBlock({ y }: { y: YearStats | MonthStats }) {
  const { t } = useTranslation();
  const temp = y.temperature;
  return (
    <div className="p-3 rounded border border-gray-200 dark:border-neutral-800">
      <div className="font-semibold mb-2">{t("statistics.temperature", "Temperature")}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <div>{t("dashboard.highestTemperature")} : <span className={tempColorClass(temp.max)}>{fmtNum(temp.max)} °C</span> ({fmtDate(temp.maxDate)})</div>
        <div>{t("dashboard.lowestTemperature")} : <span className={tempColorClass(temp.min)}>{fmtNum(temp.min)} °C</span> ({fmtDate(temp.minDate)})</div>
        <div>{t("dashboard.average")} : {fmtNum(temp.avg)} °C</div>
      </div>
      <div className="mt-2">
        <ThresholdItem className="text-red-600" label={t("dashboard.daysOver30C")} td={temp.over30} />
        <ThresholdItem className="text-orange-500" label={t("statistics.daysOver25C", "Days > 25 °C")} td={temp.over25} />
        <ThresholdItem className="text-green-600" label={t("statistics.daysOver20C", "Days > 20 °C")} td={temp.over20} />
        <ThresholdItem className="text-blue-500" label={t("dashboard.daysUnder0C")} td={temp.under0} />
        <ThresholdItem className="text-blue-900" label={t("statistics.daysUnder10C", "Days < -10 °C")} td={temp.under10} />
      </div>
    </div>
  );
}

function PrecipitationBlock({ y }: { y: YearStats | MonthStats }) {
  const { t } = useTranslation();
  const p = y.precipitation;
  return (
    <div className="p-3 rounded border border-gray-200 dark:border-neutral-800">
      <div className="font-semibold mb-2">{t("statistics.precipitation", "Precipitation")}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <div>{t("dashboard.total")} : {fmtNum(p.total)} mm</div>
        <div>{t("statistics.maxDay", "Max day")} : {fmtNum(p.maxDay)} mm ({fmtDate(p.maxDayDate)})</div>
        <div>{t("statistics.minDay", "Min day")} : {fmtNum(p.minDay)} mm ({fmtDate(p.minDayDate)})</div>
      </div>
      <div className="mt-2">
        <ThresholdItem label={t("statistics.daysOver20mm", "Days ≥ 20 mm")} td={p.over20mm} />
        <ThresholdItem label={t("dashboard.daysOver30mm")} td={p.over30mm} />
      </div>
    </div>
  );
}

function WindBlock({ y }: { y: YearStats | MonthStats }) {
  const { t } = useTranslation();
  const w = y.wind;
  return (
    <div className="p-3 rounded border border-gray-200 dark:border-neutral-800">
      <div className="font-semibold mb-2">{t("statistics.wind", "Wind")}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <div>{t("dashboard.highestWind")} : {fmtNum(w.max)} km/h ({fmtDate(w.maxDate)})</div>
        <div>{t("dashboard.highestGust")} : {fmtNum(w.gustMax)} km/h ({fmtDate(w.gustMaxDate)})</div>
      </div>
    </div>
  );
}

function MonthSection({ m }: { m: MonthStats }) {
  const [open, setOpen] = useState(false);
  const monthLabel = useMemo(() => {
    const dt = new Date(m.year, m.month - 1, 1);
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(dt);
  }, [m.year, m.month]);
  return (
    <div className="border border-gray-200 dark:border-neutral-800 rounded">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2 bg-gray-50 dark:bg-neutral-900 hover:bg-gray-100 dark:hover:bg-neutral-800"
        aria-expanded={open}
      >
        <span className="font-medium">{monthLabel}</span>
      </button>
      {open && (
        <div className="p-3 grid gap-3">
          <TemperatureBlock y={m} />
          <PrecipitationBlock y={m} />
          <WindBlock y={m} />
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
            <div className="grid gap-2">
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

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("tabs.statistics", "Statistics")}</h2>
        <div className="text-xs text-gray-500">
          {t("statuses.lastUpdate")} {data?.updatedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.updatedAt)) : "–"}
        </div>
      </div>
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

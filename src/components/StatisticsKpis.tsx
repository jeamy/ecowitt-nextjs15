"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { YearStats, MonthStats } from "@/types/statistics";
import { API_ENDPOINTS } from "@/constants";

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
  if (v <= -10) return "stat-temp--very-cold";
  if (v <= 0) return "stat-temp--cold";
  if (v <= 20) return "stat-temp--mild";
  if (v <= 25) return "stat-temp--warm";
  if (v < 30) return "stat-temp--hot";
  return "stat-temp--very-hot";
}

export default function StatisticsKpis({ y }: { y: YearStats | MonthStats }) {
  const { t } = useTranslation();
  const temp = y.temperature;
  const p = y.precipitation;
  const w = y.wind;
  const year = (y as any)?.year as number | undefined;

  // Daily series for sparklines (yearly)
  const [daily, setDaily] = useState<any[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!year) return;
      try {
        const res = await fetch(`${API_ENDPOINTS.STATISTICS_DAILY}?year=${year}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json?.ok) throw new Error(String(json?.error || "bad response"));
        if (!cancelled) setDaily(Array.isArray(json.days) ? json.days : []);
      } catch {
        if (!cancelled) setDaily([]);
      }
    })();
    return () => { cancelled = true; };
  }, [year]);

  const spark = useMemo(() => {
    const rows = daily || [];
    const xs = rows.map((_r: any, i: number) => i);
    const tmaxs = rows.map((r: any) => (Number.isFinite(r.tmax) ? Number(r.tmax) : null));
    const tmins = rows.map((r: any) => (Number.isFinite(r.tmin) ? Number(r.tmin) : null));
    const rains = rows.map((r: any) => (Number.isFinite(r.rain_day) ? Number(r.rain_day) : 0));
    const tvals = [...tmaxs.filter((v) => v !== null) as number[], ...tmins.filter((v) => v !== null) as number[]];
    const tMin = tvals.length ? Math.min(...tvals) : 0;
    const tMax = tvals.length ? Math.max(...tvals) : 1;
    const rMax = rains.length ? Math.max(...rains) : 1;
    const W = 220, H = 40, pad = 1;
    const sx = (i: number) => rows.length > 1 ? pad + (i / (rows.length - 1)) * (W - 2 * pad) : W / 2;
    const syT = (v: number) => {
      if (tMax === tMin) return H / 2;
      const ratio = (v - tMin) / (tMax - tMin);
      return H - pad - ratio * (H - 2 * pad);
    };
    const syR = (v: number) => {
      if (rMax <= 0) return H - pad;
      const ratio = v / rMax;
      return H - pad - ratio * (H - 2 * pad);
    };
    const pathFrom = (vals: (number | null)[], sy: (v: number) => number) => {
      const parts: string[] = [];
      vals.forEach((v, i) => {
        if (v === null) return;
        const x = sx(i), y = sy(v);
        if (parts.length === 0) parts.push(`M ${x} ${y}`);
        else parts.push(`L ${x} ${y}`);
      });
      return parts.join(" ");
    };
    return {
      W, H,
      dMax: pathFrom(tmaxs, syT),
      dMin: pathFrom(tmins, syT),
      dRain: pathFrom(rains, syR),
    };
  }, [daily]);

  // Combine wind/gust headline for compact 6-card layout
  const windHeadline = useMemo(() => {
    const wmax = fmtNum(w.max);
    const gmax = fmtNum(w.gustMax);
    if (wmax === "–" && gmax === "–") return "–";
    if (wmax !== "–" && gmax !== "–") return `${wmax} / ${gmax} km/h`;
    if (wmax !== "–") return `${wmax} km/h`;
    return `${gmax} km/h`;
  }, [w.max, w.gustMax]);

  return (
    <div className="stat-grid mb-3" role="region" aria-label={t("statistics.kpis", "Jahres-Kennzahlen")}> 
      <div className="stat-card">
        <div className="kpi-label">{t("dashboard.highestTemperature")}</div>
        <div className={`kpi-value ${tempColorClass(temp.max)}`}>{fmtNum(temp.max)} °C</div>
        <div className="kpi-sub">{fmtDate(temp.maxDate)}</div>
        {daily === null && (<div className="skeleton skeleton-spark" aria-hidden />)}
        {daily && daily.length > 0 && (
          <div className="stat-spark" aria-hidden>
            <svg viewBox={`0 0 ${spark.W} ${spark.H}`}>
              <path className="line-max" d={spark.dMax} />
              <path className="line-min" d={spark.dMin} />
            </svg>
          </div>
        )}
      </div>
      <div className="stat-card">
        <div className="kpi-label">{t("dashboard.lowestTemperature")}</div>
        <div className={`kpi-value ${tempColorClass(temp.min)}`}>{fmtNum(temp.min)} °C</div>
        <div className="kpi-sub">{fmtDate(temp.minDate)}</div>
      </div>
      <div className="stat-card">
        <div className="kpi-label">{t("dashboard.average")}</div>
        <div className="kpi-value">{fmtNum(temp.avg)} °C</div>
        <div className="kpi-sub">{t("statistics.temperature", "Temperature")}</div>
      </div>
      <div className="stat-card">
        <div className="kpi-label">{t("dashboard.total")}</div>
        <div className="kpi-value">{fmtNum(p.total)} mm</div>
        <div className="kpi-sub">{t("statistics.precipitation", "Precipitation")}</div>
        {daily === null && (<div className="skeleton skeleton-spark" aria-hidden />)}
        {daily && daily.length > 0 && (
          <div className="stat-spark" aria-hidden>
            <svg viewBox={`0 0 ${spark.W} ${spark.H}`}>
              <path className="line-rain" d={spark.dRain} />
            </svg>
          </div>
        )}
      </div>
      <div className="stat-card">
        <div className="kpi-label">{t("statistics.maxDay", "Max day")}</div>
        <div className="kpi-value">{fmtNum(p.maxDay)} mm</div>
        <div className="kpi-sub">{fmtDate(p.maxDayDate)}</div>
      </div>
      <div className="stat-card">
        <div className="kpi-label">{t("statistics.wind", "Wind")} / {t("dashboard.highestGust")}</div>
        <div className="kpi-value">{windHeadline}</div>
        <div className="kpi-sub">{fmtDate(w.maxDate)} / {fmtDate(w.gustMaxDate)}</div>
      </div>
    </div>
  );
}

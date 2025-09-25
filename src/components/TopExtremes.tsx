"use client";

import React, { useEffect, useMemo, useState } from "react";
import { API_ENDPOINTS } from "@/constants";
import { useTranslation } from "react-i18next";

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

function rainClass(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "stat-badge";
  if (v >= 30) return "stat-badge stat-rain--very-high";
  if (v >= 20) return "stat-badge stat-rain--high";
  if (v >= 10) return "stat-badge stat-rain--med";
  if (v > 0) return "stat-badge stat-rain--low";
  return "stat-badge";
}

export default function TopExtremes({ year }: { year: number }) {
  const { t } = useTranslation();
  const [days, setDays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_ENDPOINTS.STATISTICS_DAILY}?year=${year}`);
        const json = await res.json();
        if (!cancelled && json?.ok && Array.isArray(json.days)) setDays(json.days);
      } catch {}
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [year]);

  const { hot, cold, wet, gust } = useMemo(() => {
    const hot = days
      .filter((r) => Number.isFinite(r.tmax))
      .slice()
      .sort((a, b) => (b.tmax as number) - (a.tmax as number))
      .slice(0, 5);
    const cold = days
      .filter((r) => Number.isFinite(r.tmin))
      .slice()
      .sort((a, b) => (a.tmin as number) - (b.tmin as number))
      .slice(0, 5);
    const wet = days
      .filter((r) => Number.isFinite(r.rain_day) && r.rain_day > 0)
      .slice()
      .sort((a, b) => (b.rain_day as number) - (a.rain_day as number))
      .slice(0, 5);
    const gust = days
      .filter((r) => Number.isFinite(r.gust_max) || Number.isFinite(r.wind_max))
      .slice()
      .sort((a, b) => (Number(b.gust_max ?? b.wind_max ?? 0) - Number(a.gust_max ?? a.wind_max ?? 0)))
      .slice(0, 5);
    return { hot, cold, wet, gust };
  }, [days]);

  return (
    <div className="stat-grid stat-grid--extremes mb-3">
      <div className="stat-card">
        <div className="kpi-label">{t("statistics.topHotDays", "Top 5 hot days")}</div>
        {loading ? (
          <div className="mt-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton skeleton-line" />)}
          </div>
        ) : (
          <ul className="mt-1 text-sm">
            {hot.map((r) => (
              <li key={r.day}>
                {fmtDate(r.day)} — <span className={`stat-badge ${tempColorClass(r.tmax)}`}>{fmtNum(r.tmax)} °C</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="stat-card">
        <div className="kpi-label">{t("statistics.coldestDays", "Top 5 coldest days")}</div>
        {loading ? (
          <div className="mt-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton skeleton-line" />)}
          </div>
        ) : (
          <ul className="mt-1 text-sm">
            {cold.map((r) => (
              <li key={r.day}>
                {fmtDate(r.day)} — <span className={`stat-badge ${tempColorClass(r.tmin)}`}>{fmtNum(r.tmin)} °C</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="stat-card">
        <div className="kpi-label">{t("statistics.wettestDays", "Top 5 wettest days")}</div>
        {loading ? (
          <div className="mt-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton skeleton-line" />)}
          </div>
        ) : (
          <ul className="mt-1 text-sm">
            {wet.map((r) => (
              <li key={r.day}>
                {fmtDate(r.day)} — <span className={rainClass(r.rain_day)}>{fmtNum(r.rain_day)} mm</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="stat-card">
        <div className="kpi-label">{t("statistics.strongestGusts", "Top 5 strongest gusts")}</div>
        {loading ? (
          <div className="mt-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton skeleton-line" />)}
          </div>
        ) : (
          <ul className="mt-1 text-sm">
            {gust.map((r) => (
              <li key={r.day}>
                {fmtDate(r.day)} — <span className="stat-badge">{fmtNum(r.gust_max ?? r.wind_max)} km/h</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

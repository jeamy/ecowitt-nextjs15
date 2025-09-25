"use client";

import React, { useEffect, useMemo, useState } from "react";
import { API_ENDPOINTS } from "@/constants";
import { useTranslation } from "react-i18next";

interface DayRec {
  day: string; // YYYY-MM-DD
  tmax: number | null;
  tmin: number | null;
  tavg: number | null;
  rain_day: number | null;
}

function parseISO(d: string): Date {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(y, (m || 1) - 1, dd || 1);
}

function tempBgClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "bg-temp-none";
  if (v <= -10) return "bg-temp-very-cold";
  if (v <= 0) return "bg-temp-cold";
  if (v <= 20) return "bg-temp-mild";
  if (v <= 25) return "bg-temp-warm";
  if (v < 30) return "bg-temp-hot";
  return "bg-temp-very-hot";
}

export default function CalendarHeatmap({ year }: { year: number }) {
  const { t } = useTranslation();
  const [days, setDays] = useState<DayRec[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_ENDPOINTS.STATISTICS_DAILY}?year=${year}`);
        const json = await res.json();
        if (!cancelled && json?.ok && Array.isArray(json.days)) setDays(json.days);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [year]);

  const cells = useMemo(() => {
    // Build a map by date for quick lookup
    const byDate = new Map<string, DayRec>();
    for (const r of days) {
      if (r?.day) byDate.set(r.day, r as any);
    }
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    const firstWeekdayMon0 = ((start.getDay() + 6) % 7); // 0..6, Monday=0
    const totalDays = Math.floor((end.getTime() - start.getTime()) / (24*3600*1000)) + 1;

    const list: { key: string; col: number; row: number; cls: string; rain: boolean; title: string }[] = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(year, 0, 1 + i);
      const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const row = ((d.getDay() + 6) % 7); // Monday=0
      const col = Math.floor((i + firstWeekdayMon0) / 7);
      const rec = byDate.get(ymd);
      const tmax = (rec && Number.isFinite((rec as any).tmax)) ? Number((rec as any).tmax) : null;
      const rain = (rec && Number.isFinite((rec as any).rain_day)) ? Number((rec as any).rain_day) : 0;
      const cls = `${tempBgClass(tmax)}${rain > 0 ? " cal-cell--rain" : ""}`;
      const title = `${ymd}${tmax !== null ? ` | Tmax ${tmax} °C` : ""}${rain > 0 ? ` | Rain ${rain} mm` : ""}`;
      list.push({ key: ymd, col, row, cls, rain: rain>0, title });
    }
    const cols = list.reduce((m, c) => Math.max(m, c.col), 0) + 1;
    return { list, cols };
  }, [days, year]);

  if (loading) return (
    <div className="cal-wrap" aria-hidden>
      <div className="cal-title">{t("statistics.heatmap", "Kalender-Heatmap (Tages-Tmax)")}</div>
      <div className="skeleton skeleton-heatmap" />
    </div>
  );
  return (
    <div className="cal-wrap" role="region" aria-label={t("statistics.heatmap", "Kalender-Heatmap (Tages-Tmax)")}>
      <div className="cal-title">{t("statistics.heatmap", "Kalender-Heatmap (Tages-Tmax)")}</div>
      <div className="cal-scroll">
        <div
          className="cal-grid"
          style={{ gridTemplateColumns: `repeat(${cells.cols}, var(--cal-cell, 12px))` } as React.CSSProperties}
        >
          {cells.list.map(c => (
            <div
              key={c.key}
              className={`cal-cell ${c.cls}`}
              style={{ gridColumn: c.col + 1, gridRow: c.row + 1 } as React.CSSProperties}
              title={c.title}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

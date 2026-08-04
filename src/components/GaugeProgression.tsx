"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { API_ENDPOINTS } from "@/constants";
import LineChartChartJS, { type LineSeries } from "./LineChartChartJS";

export type SeriesConfig = {
  label: string;
  color: string;
  /** Return true if the CSV column name belongs to this series. */
  match: (normalized: string, original: string) => boolean;
  yUnit?: string;
  yAxisID?: string;
};

export type YScaleConfig = Record<string, { position?: 'left' | 'right'; title?: string; min?: number; max?: number; suggestedMin?: number; suggestedMax?: number }>;

type MainDataResponse = {
  header?: string[];
  rows?: Array<Record<string, string | number | null>>;
};

function normalizeColumnName(name: string): string {
  const map: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };
  return name
    .replace(/[äöüÄÖÜß]/g, (ch) => map[ch] || ch)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function todayIsoRange(): { start: string; end: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return {
    start: `${yyyy}-${mm}-${dd}T00:00:00`,
    end: `${yyyy}-${mm}-${dd}T23:59:59`,
  };
}

function parseTimeToMs(value: string | number | null): number | null {
  if (value == null) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

/**
 * A wrapper that renders its children (a gauge card) and toggles to a daily
 * progression line chart when clicked. Another click returns to the gauge view.
 */
export function ProgressionToggle({
  children,
  series,
  cardTitle,
  className = "",
  progressionClassName,
  yScales,
  enabled = true,
}: {
  children: React.ReactNode;
  series: SeriesConfig[];
  cardTitle?: string;
  className?: string;
  progressionClassName?: string;
  yScales?: YScaleConfig;
  enabled?: boolean;
}) {
  const { t } = useTranslation();
  const [showProgression, setShowProgression] = useState(false);
  const titleAttr = enabled ? t("gauges.clickToToggleProgression") : undefined;

  if (!enabled || series.length === 0) {
    return <>{children}</>;
  }

  const activeClasses = showProgression && progressionClassName ? progressionClassName : className;
  return (
    <div
      className={`${activeClasses} cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800/50`.trim()}
      title={titleAttr}
      onClick={() => setShowProgression((v) => !v)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setShowProgression((v) => !v);
        }
      }}
    >
      {showProgression ? (
        <ProgressionChart series={series} cardTitle={cardTitle} yScales={yScales} />
      ) : (
        children
      )}
    </div>
  );
}

function ProgressionChart({
  series,
  cardTitle,
  yScales,
}: {
  series: SeriesConfig[];
  cardTitle?: string;
  yScales?: YScaleConfig;
}) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<MainDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const { start, end } = todayIsoRange();
        const url = new URL(API_ENDPOINTS.DATA_MAIN, window.location.origin);
        url.searchParams.set("start", start);
        url.searchParams.set("end", end);
        url.searchParams.set("resolution", "hour");
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as MainDataResponse;
        if (!cancelled) setData(json ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  const chartSeries = useMemo<LineSeries[]>(() => {
    if (!data?.header?.length || !data?.rows?.length) return [];
    const matched = series
      .map((s) => {
        const original = data.header!.find((h) => {
          const n = normalizeColumnName(h);
          return s.match(n, h);
        });
        if (!original) return null;
        const points = data
          .rows!.map((r) => ({
            x: parseTimeToMs(r.time),
            y: typeof r[original] === "number" ? (r[original] as number) : null,
          }))
          .filter((p): p is { x: number; y: number } => p.x != null && p.y != null && Number.isFinite(p.y));
        if (!points.length) return null;
        return { id: s.label, color: s.color, points, yAxisID: s.yAxisID } as LineSeries;
      })
      .filter((s): s is LineSeries => s != null);
    return matched;
  }, [data, series]);

  const timeFormatter = (ms: number) =>
    new Date(ms).toLocaleTimeString(i18n.language || "de", { hour: "2-digit", minute: "2-digit" });

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-gray-500">
        {t("gauges.loadingProgression")}
      </div>
    );
  }

  if (error || chartSeries.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-sm text-gray-500 gap-2">
        <div>{t("gauges.noProgressionData")}</div>
        {cardTitle && <div className="text-xs text-gray-400">{cardTitle}</div>}
      </div>
    );
  }

  const yUnit = chartSeries.length === 1 ? chartSeries[0].points[0]?.y != null ? series[0]?.yUnit : undefined : undefined;

  return (
    <div className="w-full">
      <div className="text-xs text-gray-500 mb-2 flex items-center justify-between">
        <span>{t("gauges.dailyProgression")}</span>
        {cardTitle && <span className="text-gray-400">{cardTitle}</span>}
      </div>
      <LineChartChartJS
        series={chartSeries}
        height={220}
        xTickFormatter={timeFormatter}
        hoverTimeFormatter={timeFormatter}
        showLegend={chartSeries.length > 1}
        yUnit={yUnit}
        yScales={yScales}
      />
    </div>
  );
}

export default ProgressionToggle;

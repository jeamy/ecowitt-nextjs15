"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { API_ENDPOINTS } from "@/constants";
import LineChart, { type LineSeries } from "@/components/LineChartChartJS";
import { CheckIcon } from "@heroicons/react/24/outline";
import styles from "./StoredDataLayout.module.css";

/**
 * Represents the response from the months API endpoint.
 * @private
 */
type MonthsResp = { months: string[] };

/**
 * Represents the response from the data API endpoints.
 * @private
 */
type DataResp = {
  file: string;
  header: string[];
  rows: Array<Record<string, number | string | null>>; // time as string, numeric values averaged
};

/**
 * Represents the channel configuration.
 * @private
 */
type ChannelsConfig = Record<string, { name: string }>; // { ch1: { name: "Living" }, ... }

function StatusCard({ message, tone }: { message: string; tone: "info" | "error" }) {
  const className = `${styles.card} ${styles.statusMessage} ${tone === "info" ? styles.statusInfo : styles.statusError}`;
  return <div className={className}>{message}</div>;
}

/**
 * Renders the charts for a single channel card.
 * @private
 */
function renderChannelCardCharts(
  data: DataResp,
  channelsCfg: ChannelsConfig,
  xBase: number | null,
  chKey: string,
  minuteDataAll: DataResp | null,
  t: (key: string) => string,
  locale: string,
  serverChannelStats?: any
) {
  const rows = data.rows || [];
  if (!rows.length || !xBase) return <div className="text-xs text-gray-500">{t('statuses.noData')}</div>;
  const times = rows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
  const xVals = times.map((t) => Math.round((t.getTime() - xBase) / 60000));
  const spanMin = times.length >= 2 ? Math.round((times[times.length - 1].getTime() - times[0].getTime()) / 60000) : 0;
  const fmt = makeTimeTickFormatter(xBase, spanMin, locale);
  const hoverFmt = makeHoverTimeFormatter(xBase, locale);
  
  // Group temperature metrics
  const tempMetrics: ChannelMetric[] = ["Temperatur", "Taupunkt", "Gefühlte Temperatur"];
  const chNum = (chKey.match(/\d+/)?.[0]) || "1";
  const out: React.ReactNode[] = [];
  
  // Create temperature chart
  const tempSeries: LineSeries[] = [];
  for (let i = 0; i < tempMetrics.length; i++) {
    const metric = tempMetrics[i];
    const col = headerKeyForAllsensors(data.header || [], metric, chNum);
    if (!col) continue;
    const series: LineSeries = {
      id: `${metricDisplayLabel(metric, t)}`,
      color: COLORS[i % COLORS.length],
      points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
    };
    if (series.points.some((p) => Number.isFinite(p.y))) {
      tempSeries.push(series);
    }
  }
  
  if (tempSeries.length > 0) {
    out.push(
      <div key={`${chKey}-temperatures`} className="rounded border border-gray-100 p-3">
        <LineChart 
          series={tempSeries} 
          yLabel={`${t('fields.temperature')} (°C)`} 
          xLabel={t('dashboard.time')} 
          xTickFormatter={fmt} 
          hoverTimeFormatter={hoverFmt} 
          showLegend={true} 
          yUnit="°C" 
        />
        {/* Temperatur-Statistiken für diesen Kanal (nur echte Temperatur; Minutenbasis falls vorhanden) */}
        {(() => {
          const chNum = (chKey.match(/\d+/)?.[0]) || "1";
          const tempCol = headerKeyForAllsensors(data.header || [], "Temperatur", chNum);
          const feltCol = headerKeyForAllsensors(data.header || [], "Gefühlte Temperatur", chNum);
          // Standard: aktuelle aufgelöste Daten
          let statsRows = rows;
          let statsTimes = times;
          let tempColResolved = tempCol;
          let feltColResolved = feltCol;
          // Durchschnitt aus Chart-Daten (nicht Minutendaten)
          const avgOfCol = (rs: typeof rows, col?: string | null) => {
            if (!col) return NaN;
            let sum = 0, count = 0;
            for (const r of rs) {
              const v = numOrNaN(r[col]);
              if (Number.isFinite(v)) { sum += v; count++; }
            }
            return count ? (sum / count) : NaN;
          };
          const avgTemp = tempCol ? avgOfCol(rows, tempCol) : NaN;
          // Minutenbasis verwenden, wenn vorhanden
          if (minuteDataAll && minuteDataAll.rows && minuteDataAll.rows.length > 0) {
            const mHeader = minuteDataAll.header || [];
            tempColResolved = mHeader.find(h => h === tempCol) || tempCol;
            feltColResolved = feltCol ? (mHeader.find(h => h === feltCol) || feltCol) : feltCol;
            statsRows = minuteDataAll.rows;
            statsTimes = statsRows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
          }
          const tempCols = tempColResolved ? [tempColResolved] : [];
          const feltCols = feltColResolved ? [feltColResolved] : [];
          const statsTemp = tempCols.length ? calculateTemperatureStats(statsRows, statsTimes, tempCols) : null;
          const statsFelt = feltCols.length ? calculateTemperatureStats(statsRows, statsTimes, feltCols) : null;
          if (!statsTemp && !statsFelt) return null;
          return (
            <div className="mt-2 text-sm border-t border-gray-100 pt-2">
              {statsTemp && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
                  <div className="bg-amber-50 p-2 rounded">
                    <div className="font-medium text-amber-700">{t('dashboard.daysOver30C')}</div>
                    <div className="text-lg">{statsTemp.daysOver30} <span className="text-xs text-gray-500">{t('dashboard.of')} {statsTemp.totalPeriodDays}</span></div>
                  </div>
                  <div className="bg-blue-50 p-2 rounded">
                    <div className="font-medium text-blue-700">{t('dashboard.daysUnder0C')}</div>
                    <div className="text-lg">{statsTemp.daysUnder0} <span className="text-xs text-gray-500">{t('dashboard.of')} {statsTemp.totalPeriodDays}</span></div>
                  </div>
                  <div className="bg-rose-50 p-2 rounded">
                    <div className="font-medium text-rose-700">{t('dashboard.highestTemperature')}</div>
                    <div className="text-lg">{Number.isFinite(statsTemp.maxTemp) ? `${statsTemp.maxTemp.toFixed(1)} °C` : "—"}</div>
                    {statsTemp.maxTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsTemp.maxTime, locale)}</div>)}
                  </div>
                  <div className="bg-indigo-50 p-2 rounded">
                    <div className="font-medium text-indigo-700">{t('dashboard.lowestTemperature')}</div>
                    <div className="text-lg">{Number.isFinite(statsTemp.minTemp) ? `${statsTemp.minTemp.toFixed(1)} °C` : "—"}</div>
                    {statsTemp.minTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsTemp.minTime, locale)}</div>)}
                  </div>
                  <div className="bg-teal-50 p-2 rounded">
                    <div className="font-medium text-teal-700">{t('dashboard.average')}</div>
                    <div className="text-lg">{Number.isFinite(avgTemp) ? `${avgTemp.toFixed(1)} °C` : "—"}</div>
                  </div>
                </div>
              )}
              {/* Feels-like statistics: prefer server-side channel stats */}
              {serverChannelStats?.stats?.feels ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-orange-50 p-2 rounded">
                    <div className="font-medium text-orange-700">{t('dashboard.feelsLikeMax')}</div>
                    <div className="text-lg">{Number.isFinite(serverChannelStats.stats.feels.max) ? `${serverChannelStats.stats.feels.max.toFixed(1)} °C` : '—'}</div>
                    {serverChannelStats.stats.feels.maxDate && (<div className="text-xs text-gray-500">{formatDisplayLocale(new Date(String(serverChannelStats.stats.feels.maxDate) + 'T12:00'), locale)}</div>)}
                  </div>
                  <div className="bg-cyan-50 p-2 rounded">
                    <div className="font-medium text-cyan-700">{t('dashboard.feelsLikeMin')}</div>
                    <div className="text-lg">{Number.isFinite(serverChannelStats.stats.feels.min) ? `${serverChannelStats.stats.feels.min.toFixed(1)} °C` : '—'}</div>
                    {serverChannelStats.stats.feels.minDate && (<div className="text-xs text-gray-500">{formatDisplayLocale(new Date(String(serverChannelStats.stats.feels.minDate) + 'T12:00'), locale)}</div>)}
                  </div>
                </div>
              ) : (
                statsFelt && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-orange-50 p-2 rounded">
                      <div className="font-medium text-orange-700">{t('dashboard.feelsLikeMax')}</div>
                      <div className="text-lg">{Number.isFinite(statsFelt.maxTemp) ? `${statsFelt.maxTemp.toFixed(1)} °C` : "—"}</div>
                      {statsFelt.maxTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsFelt.maxTime, locale)}</div>)}
                    </div>
                    <div className="bg-cyan-50 p-2 rounded">
                      <div className="font-medium text-cyan-700">{t('dashboard.feelsLikeMin')}</div>
                      <div className="text-lg">{Number.isFinite(statsFelt.minTemp) ? `${statsFelt.minTemp.toFixed(1)} °C` : "—"}</div>
                      {statsFelt.minTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsFelt.minTime, locale)}</div>)}
                    </div>
                  </div>
                )
              )}
            </div>
          );
        })()}
      </div>
    );
  }
  
  // Luftfeuchtigkeit separat darstellen
  const humidityMetric: ChannelMetric = "Luftfeuchtigkeit";
  const humidityCol = headerKeyForAllsensors(data.header || [], humidityMetric, chNum);
  if (humidityCol) {
    const humiditySeries: LineSeries = {
      id: `${metricDisplayLabel(humidityMetric, t)}`,
      color: COLORS[3],
      points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[humidityCol]) })),
    };
    if (humiditySeries.points.some((p) => Number.isFinite(p.y))) {
      out.push(
        <div key={`${chKey}-${humidityMetric}`} className="rounded border border-gray-100 p-3">
          <LineChart 
            series={[humiditySeries]} 
            yLabel={`${metricDisplayLabel(humidityMetric, t)}`} 
            xLabel={t('dashboard.time')} 
            xTickFormatter={fmt} 
            hoverTimeFormatter={hoverFmt} 
            showLegend={false} 
            yUnit={unitForMetric(humidityMetric)} 
          />
        </div>
      );
    }
  }
  
  if (!out.length) return <div className="text-xs text-gray-500">{t('statuses.noNumeric')}</div>;
  return <>{out}</>;
}

function renderAllChannelsCharts(data: DataResp, channelsCfg: ChannelsConfig, xBase: number | null, minuteDataAll: DataResp | null, t: (key: string) => string, locale: string) {
  const rows = data.rows || [];
  if (!rows.length || !xBase) return <div className="text-xs text-gray-500">{t('statuses.noData')}</div>;
  const times = rows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
  const xVals = times.map((t) => Math.round((t.getTime() - xBase) / 60000));
  const fmt = makeTimeTickFormatter(xBase, 0, locale);
  const hoverFmt = makeHoverTimeFormatter(xBase, locale);
  
  // Temperaturmetriken und Luftfeuchtigkeit definieren
  const tempMetrics: ChannelMetric[] = ["Temperatur", "Taupunkt", "Gefühlte Temperatur"];
  const out: React.ReactNode[] = [];
  
  for (const chKey of getChannelKeys(channelsCfg)) {
    const chNum = (chKey.match(/\d+/)?.[0]) || "1";
    const channelCharts: React.ReactNode[] = [];
    
    // Temperaturdiagramm erstellen
    const tempSeries: LineSeries[] = [];
    for (let i = 0; i < tempMetrics.length; i++) {
      const metric = tempMetrics[i];
      const col = headerKeyForAllsensors(data.header || [], metric, chNum);
      if (!col) continue;
      const series: LineSeries = {
        id: `${metricDisplayLabel(metric, t)}`,
        color: COLORS[i % COLORS.length],
        points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
      };
      if (series.points.some((p) => Number.isFinite(p.y))) {
        tempSeries.push(series);
      }
    }
    
    if (tempSeries.length > 0) {
      const chNumLocal = chNum;
      channelCharts.push(
        <div key={`${chKey}-temperatures`} className="rounded border border-gray-100 p-3">
          <LineChart 
            series={tempSeries} 
            yLabel={`${t('fields.temperature')} (°C)`} 
            xLabel={t('dashboard.time')} 
            xTickFormatter={fmt} 
            hoverTimeFormatter={hoverFmt} 
            showLegend={true} 
            yUnit="°C" 
          />
          {(() => {
            const tempCol = headerKeyForAllsensors(data.header || [], "Temperatur", chNumLocal);
            const feltCol = headerKeyForAllsensors(data.header || [], "Gefühlte Temperatur", chNumLocal);
            let statsRows = rows;
            let statsTimes = times;
            let tempColResolved = tempCol;
            let feltColResolved = feltCol;
            // Durchschnitt aus Chart-Daten (nicht Minutendaten)
            const avgOfCol = (rs: typeof rows, col?: string | null) => {
              if (!col) return NaN;
              let sum = 0, count = 0;
              for (const r of rs) {
                const v = numOrNaN(r[col]);
                if (Number.isFinite(v)) { sum += v; count++; }
              }
              return count ? (sum / count) : NaN;
            };
            const avgTemp = tempCol ? avgOfCol(rows, tempCol) : NaN;
            if (minuteDataAll && minuteDataAll.rows && minuteDataAll.rows.length > 0) {
              const mHeader = minuteDataAll.header || [];
              tempColResolved = mHeader.find(h => h === tempCol) || tempCol;
              statsRows = minuteDataAll.rows;
              statsTimes = statsRows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
            }
            const statsTemp = tempColResolved ? calculateTemperatureStats(statsRows, statsTimes, [tempColResolved]) : null;
            const statsFelt = feltColResolved ? calculateTemperatureStats(statsRows, statsTimes, [feltColResolved]) : null;
            if (!statsTemp && !statsFelt) return null;
            return (
              <div className="mt-2 text-sm border-t border-gray-100 pt-2">
                {statsTemp && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
                    <div className="bg-amber-50 p-2 rounded">
                      <div className="font-medium text-amber-700">{t('dashboard.daysOver30C')}</div>
                      <div className="text-lg">{statsTemp.daysOver30} <span className="text-xs text-gray-500">{t('dashboard.of')} {statsTemp.totalPeriodDays}</span></div>
                    </div>
                    <div className="bg-blue-50 p-2 rounded">
                      <div className="font-medium text-blue-700">{t('dashboard.daysUnder0C')}</div>
                      <div className="text-lg">{statsTemp.daysUnder0} <span className="text-xs text-gray-500">{t('dashboard.of')} {statsTemp.totalPeriodDays}</span></div>
                    </div>
                    <div className="bg-rose-50 p-2 rounded">
                      <div className="font-medium text-rose-700">{t('dashboard.highestTemperature')}</div>
                      <div className="text-lg">{Number.isFinite(statsTemp.maxTemp) ? `${statsTemp.maxTemp.toFixed(1)} °C` : "—"}</div>
                      {statsTemp.maxTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsTemp.maxTime, locale)}</div>)}
                    </div>
                    <div className="bg-indigo-50 p-2 rounded">
                      <div className="font-medium text-indigo-700">{t('dashboard.lowestTemperature')}</div>
                      <div className="text-lg">{Number.isFinite(statsTemp.minTemp) ? `${statsTemp.minTemp.toFixed(1)} °C` : "—"}</div>
                      {statsTemp.minTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsTemp.minTime, locale)}</div>)}
                    </div>
                    <div className="bg-teal-50 p-2 rounded">
                      <div className="font-medium text-teal-700">{t('dashboard.average')}</div>
                      <div className="text-lg">{Number.isFinite(avgTemp) ? `${avgTemp.toFixed(1)} °C` : "—"}</div>
                    </div>
                  </div>
                )}
                {statsFelt && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-orange-50 p-2 rounded">
                      <div className="font-medium text-orange-700">{t('dashboard.feelsLikeMax')}</div>
                      <div className="text-lg">{Number.isFinite(statsFelt.maxTemp) ? `${statsFelt.maxTemp.toFixed(1)} °C` : "—"}</div>
                      {statsFelt.maxTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsFelt.maxTime, locale)}</div>)}
                    </div>
                    <div className="bg-cyan-50 p-2 rounded">
                      <div className="font-medium text-cyan-700">{t('dashboard.feelsLikeMin')}</div>
                      <div className="text-lg">{Number.isFinite(statsFelt.minTemp) ? `${statsFelt.minTemp.toFixed(1)} °C` : "—"}</div>
                      {statsFelt.minTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsFelt.minTime, locale)}</div>)}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      );
    }
    
    // Luftfeuchtigkeit separat darstellen
    const humidityMetric: ChannelMetric = "Luftfeuchtigkeit";
    const humidityCol = headerKeyForAllsensors(data.header || [], humidityMetric, chNum);
    if (humidityCol) {
      const humiditySeries: LineSeries = {
        id: `${metricDisplayLabel(humidityMetric, t)}`,
        color: COLORS[3],
        points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[humidityCol]) })),
      };
      if (humiditySeries.points.some((p) => Number.isFinite(p.y))) {
        channelCharts.push(
          <div key={`${chKey}-${humidityMetric}`} className="rounded border border-gray-100 p-3">
            <LineChart 
              series={[humiditySeries]} 
              yLabel={`${metricDisplayLabel(humidityMetric, t)}`} 
              xLabel={t('dashboard.time')} 
              xTickFormatter={fmt} 
              hoverTimeFormatter={hoverFmt} 
              showLegend={false} 
              yUnit={unitForMetric(humidityMetric)} 
            />
          </div>
        );
      }
    }
    
    if (channelCharts.length) {
      out.push(
        <div key={`ch-card-${chKey}`} className="rounded-lg border border-gray-200 bg-white dark:bg-black">
          <div className="px-3 py-2 border-b border-emerald-100 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-sm font-medium">{channelName(chKey, channelsCfg)}</div>
          <div className="p-3 flex flex-col gap-4">
            {channelCharts}
          </div>
        </div>
      );
    }
  }
  
  if (!out.length) return <div className="text-xs text-gray-500">{t('statuses.noNumeric')}</div>;
  return <>{out}</>;
}

/**
 * Renders the global time range selection controls.
 * This includes datetime-local inputs and range sliders to define a start and end time.
 * @param props - The component props.
 * @param props.min - The absolute minimum date for the range.
 * @param props.max - The absolute maximum date for the range.
 * @param props.pctStart - The start of the selected range as a percentage (0-1000) of the total range.
 * @param props.pctEnd - The end of the selected range as a percentage (0-1000) of the total range.
 * @param props.setPctStart - Callback to set the start percentage.
 * @param props.setPctEnd - Callback to set the end percentage.
 * @param props.setDateRangeChanged - Optional callback to signal that the date range has been modified by the user.
 * @param props.setConfirmButtonActive - Optional callback to activate the confirmation button.
 * @returns A React component for global range controls.
 * @private
 */
function GlobalRangeControls(props: {
  min: Date | null;
  max: Date | null;
  pctStart: number; // 0..1000
  pctEnd: number;   // 0..1000
  setPctStart: (n: number) => void;
  setPctEnd: (n: number) => void;
  setDateRangeChanged?: (changed: boolean) => void;
  setConfirmButtonActive?: (active: boolean) => void;
}) {
  const { min, max, pctStart, pctEnd, setPctStart, setPctEnd, setDateRangeChanged, setConfirmButtonActive } = props;
  const { t, i18n } = useTranslation();
  if (!min || !max) return null;
  const span = max.getTime() - min.getTime();
  const startMs = min.getTime() + Math.round(span * (pctStart / 1000));
  const endMs = min.getTime() + Math.round(span * (pctEnd / 1000));
  const start = new Date(Math.min(Math.max(startMs, min.getTime()), max.getTime()));
  const end = new Date(Math.min(Math.max(endMs, min.getTime()), max.getTime()));
  const startDisp = formatDisplayLocale(start, i18n.language || 'de');
  const endDisp = formatDisplayLocale(end, i18n.language || 'de');
  const startLocal = formatLocal(start);
  const endLocal = formatLocal(end);

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:bg-black p-3">
      <div className="text-sm font-medium mb-2">{t('dashboard.globalRange')}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm">{t('dashboard.start')}</label>
          <input
            type="datetime-local"
            className="border rounded p-2"
            value={startLocal}
            onChange={(e) => {
              const d = new Date(e.target.value);
              if (isNaN(d.getTime())) return;
              const p = Math.round(((d.getTime() - min.getTime()) / span) * 1000);
              setPctStart(Math.min(Math.max(p, 0), Math.max(0, pctEnd - 1)));
              if (setDateRangeChanged) setDateRangeChanged(true);
              if (setConfirmButtonActive) setConfirmButtonActive(true);
            }}
          />
          <div className="text-xs text-gray-500">{startDisp}</div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm">{t('dashboard.end')}</label>
          <input
            type="datetime-local"
            className="border rounded p-2"
            value={endLocal}
            onChange={(e) => {
              const d = new Date(e.target.value);
              if (isNaN(d.getTime())) return;
              const p = Math.round(((d.getTime() - min.getTime()) / span) * 1000);
              setPctEnd(Math.max(Math.min(p, 1000), Math.min(1000, pctStart + 1)));
              if (setDateRangeChanged) setDateRangeChanged(true);
              if (setConfirmButtonActive) setConfirmButtonActive(true);
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
          onChange={(e) => {
            setPctStart(Math.min(Number(e.target.value), pctEnd - 1));
            if (setDateRangeChanged) setDateRangeChanged(true);
            if (setConfirmButtonActive) setConfirmButtonActive(true);
          }}
        />
        <input
          type="range"
          min={1}
          max={1000}
          value={Math.max(pctEnd, pctStart + 1)}
          onChange={(e) => {
            setPctEnd(Math.max(Number(e.target.value), pctStart + 1));
            if (setDateRangeChanged) setDateRangeChanged(true);
            if (setConfirmButtonActive) setConfirmButtonActive(true);
          }}
        />
        <div className="text-xs text-gray-500">{startDisp} — {endDisp}</div>
      </div>
    </div>
  );
}

/**
 * Pads a number with a leading zero if it's less than 10.
 * @param n - The number to pad.
 * @returns The padded string.
 * @private
 */
function pad2(n: number) { return n < 10 ? `0${n}` : String(n); }

/**
 * Calculates temperature statistics from the provided data.
 * This includes counting days above 30°C and below 0°C, and finding the min/max temperatures.
 * @param rows - The data rows.
 * @param times - The corresponding timestamps for each row.
 * @param tempColumns - The names of the columns containing temperature data.
 * @returns An object with calculated temperature statistics.
 * @private
 */
function calculateTemperatureStats(rows: Array<Record<string, number | string | null>>, times: Date[], tempColumns: string[]) {
  // Gruppiere nach Tagen
  const dayMap = new Map<string, { date: Date; maxTemp: number; minTemp: number; hasOver30: boolean; hasUnder0: boolean }>(); 
  
  // Bestimme den gesamten Zeitraum (alle Tage zwischen erstem und letztem Datum)
  let minDate: Date | null = null;
  let maxDate: Date | null = null;
  
  // Globale Min/Max im Zeitraum (über alle Temperaturspalten)
  let globalMaxTemp = -Infinity;
  let globalMinTemp = Infinity;
  let globalMaxTime: Date | null = null;
  let globalMinTime: Date | null = null;
  
  for (let i = 0; i < rows.length; i++) {
    const d = times[i];
    if (!d) continue;
    
    if (!minDate || d < minDate) minDate = new Date(d);
    if (!maxDate || d > maxDate) maxDate = new Date(d);
    
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    let entry = dayMap.get(key);
    
    if (!entry) {
      entry = { 
        date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), 
        maxTemp: -Infinity, 
        minTemp: Infinity,
        hasOver30: false,
        hasUnder0: false
      };
      dayMap.set(key, entry);
    }
    
    // Prüfe alle Temperaturwerte in dieser Zeile
    for (const col of tempColumns) {
      const temp = numOrNaN(rows[i][col]);
      if (!Number.isFinite(temp)) continue;
      
      // pro Tag
      entry.maxTemp = Math.max(entry.maxTemp, temp);
      entry.minTemp = Math.min(entry.minTemp, temp);
      
      // globaler Min/Max
      if (temp > globalMaxTemp) { globalMaxTemp = temp; globalMaxTime = new Date(d); }
      if (temp < globalMinTemp) { globalMinTemp = temp; globalMinTime = new Date(d); }
      
      if (temp > 30) entry.hasOver30 = true;
      if (temp < 0) entry.hasUnder0 = true;
    }
  }
  
  // Berechne die Gesamtzahl der Tage im Zeitraum
  let totalPeriodDays = 0;
  if (minDate && maxDate) {
    const dayInMs = 24 * 60 * 60 * 1000;
    totalPeriodDays = Math.round((maxDate.getTime() - minDate.getTime()) / dayInMs) + 1;
  }
  
  // Zähle Tage mit bestimmten Bedingungen
  let daysOver30 = 0;
  let daysUnder0 = 0;
  
  for (const entry of dayMap.values()) {
    if (entry.hasOver30) daysOver30++;
    if (entry.hasUnder0) daysUnder0++;
  }
  
  return { 
    daysOver30, 
    daysUnder0, 
    totalDays: dayMap.size, 
    totalPeriodDays,
    maxTemp: Number.isFinite(globalMaxTemp) ? globalMaxTemp : NaN,
    minTemp: Number.isFinite(globalMinTemp) ? globalMinTemp : NaN,
    maxTime: globalMaxTime,
    minTime: globalMinTime,
  };
}

/**
 * Calculates rain statistics from the provided data.
 * This includes counting days with heavy rain (>30mm) and the total number of rain days.
 * @param rows - The data rows.
 * @param times - The corresponding timestamps for each row.
 * @param rainColumn - The name of the column containing rain data.
 * @returns An object with calculated rain statistics.
 * @private
 */
function calculateRainStats(rows: Array<Record<string, number | string | null>>, times: Date[], rainColumn: string | null) {
  if (!rainColumn) return { daysOver30mm: 0, totalDays: 0, totalPeriodDays: 0 };
  
  // Gruppiere Regendaten nach Tagen und summiere
  const dailyRain = new Map<string, number>();
  
  // Bestimme den gesamten Zeitraum (alle Tage zwischen erstem und letztem Datum)
  let minDate: Date | null = null;
  let maxDate: Date | null = null;
  
  // Wenn die Daten bereits nach Tagen aggregiert sind (z.B. bei Tagesauflösung),
  // können wir sie direkt verwenden
  for (let i = 0; i < times.length; i++) {
    const d = times[i];
    if (!d) continue;
    
    if (!minDate || d < minDate) minDate = new Date(d);
    if (!maxDate || d > maxDate) maxDate = new Date(d);
    
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const rain = numOrNaN(rows[i][rainColumn]);
    
    if (!Number.isFinite(rain)) continue;
    
    // Bei Tagesauflösung ist der Wert bereits der Tageswert
    const current = dailyRain.get(key) || 0;
    dailyRain.set(key, current + rain);
  }
  
  // Berechne die Gesamtzahl der Tage im Zeitraum
  let totalPeriodDays = 0;
  if (minDate && maxDate) {
    const dayInMs = 24 * 60 * 60 * 1000;
    totalPeriodDays = Math.round((maxDate.getTime() - minDate.getTime()) / dayInMs) + 1;
  }
  
  // Zähle Tage mit Regen > 30mm
  let daysOver30mm = 0;
  let rainDays = 0;
  
  for (const amount of dailyRain.values()) {
    if (amount > 0) rainDays++;
    if (amount > 30) daysOver30mm++;
  }
  
  return { daysOver30mm, totalDays: rainDays, totalPeriodDays };
}

/**
 * Calculates the minimum and maximum values for a specific numeric column.
 * @param rows - The data rows.
 * @param times - The corresponding timestamps for each row.
 * @param column - The name of the column to analyze.
 * @returns An object containing the min and max values and their corresponding timestamps.
 * @private
 */
function calculateMinMaxForColumn(
  rows: Array<Record<string, number | string | null>>,
  times: Date[],
  column: string
) {
  let globalMax = -Infinity;
  let globalMin = Infinity;
  let maxTime: Date | null = null;
  let minTime: Date | null = null;
  for (let i = 0; i < rows.length; i++) {
    const d = times[i];
    if (!d) continue;
    const v = numOrNaN(rows[i][column]);
    if (!Number.isFinite(v)) continue;
    if (v > globalMax) { globalMax = v; maxTime = new Date(d); }
    if (v < globalMin) { globalMin = v; minTime = new Date(d); }
  }
  return {
    max: Number.isFinite(globalMax) ? globalMax : NaN,
    min: Number.isFinite(globalMin) ? globalMin : NaN,
    maxTime,
    minTime,
  };
}

/**
 * Creates a formatter function for chart x-axis time ticks.
 * @param t0 - The baseline timestamp (in milliseconds) for the x-axis.
 * @param spanMin - The total time span in minutes (not currently used).
 * @param locale - The locale string (e.g., 'en-US', 'de').
 * @returns A function that formats a minute offset into a date string.
 * @private
 */
function makeTimeTickFormatter(t0: number, spanMin: number = 0, locale: string) {
  return (v: number) => {
    const d = new Date(t0 + Math.round(v) * 60000);
    try {
      return new Intl.DateTimeFormat(locale || 'de', { day: '2-digit', month: '2-digit' }).format(d);
    } catch {
      const dd = pad2(d.getDate());
      const mm = pad2(d.getMonth() + 1);
      return `${dd}.${mm}.`;
    }
  };
}

/**
 * Creates a formatter function for the tooltip displayed on chart hover.
 * @param t0 - The baseline timestamp (in milliseconds) for the x-axis.
 * @param locale - The locale string (e.g., 'en-US', 'de').
 * @returns A function that formats a minute offset into a full date-time string.
 * @private
 */
function makeHoverTimeFormatter(t0: number, locale: string) {
  return (v: number) => {
    const d = new Date(t0 + Math.round(v) * 60000);
    return formatDisplayLocale(d, locale);
  };
}

/**
 * Formats a Date object into a locale-aware string with a safe fallback.
 * @param d - The Date object to format.
 * @param locale - The locale string.
 * @returns The formatted date-time string.
 * @private
 */
function formatDisplayLocale(d: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale || 'de', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
  } catch {
    const dd = pad2(d.getDate());
    const mm = pad2(d.getMonth() + 1);
    const yyyy = d.getFullYear();
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return `${dd}.${mm}.${yyyy} ${hh}:${mi}:${ss}`;
  }
}

/**
 * Gets the localized name of a month.
 * @param month - The month number (1-12).
 * @param locale - The locale string.
 * @returns The full month name.
 * @private
 */
function getMonthName(month: number, locale: string): string {
  const m = Math.max(1, Math.min(12, Math.floor(month)));
  try {
    const d = new Date(2000, m - 1, 1);
    const s = new Intl.DateTimeFormat(locale || 'de', { month: 'long' }).format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    // Fallback to numeric month if Intl is unavailable
    return String(m).padStart(2, '0');
  }
}

/**
 * Defines the types of metrics available for channel sensors.
 * @private
 */
type ChannelMetric = "Temperatur" | "Luftfeuchtigkeit" | "Taupunkt" | "Gefühlte Temperatur";

/**
 * Gets the internationalized display label for a given metric.
 * @param metric - The metric to get the label for.
 * @param t - The translation function.
 * @returns The translated display label.
 * @private
 */
function metricDisplayLabel(metric: ChannelMetric, t: (key: string) => string): string {
  const map: Record<string, string> = {
    "Temperatur": t('fields.temperature'),
    "Taupunkt": t('fields.dewPoint'),
    "Gefühlte Temperatur": t('fields.feelsLike'),
    "Luftfeuchtigkeit": t('fields.humidity'),
  };
  return map[metric] || metric;
}

/**
 * Defines the available datasets for fetching data.
 * `allsensors` includes all channel sensor data, while `main` is for the main weather station sensors.
 * @private
 */
type Dataset = "allsensors" | "main";

/**
 * Defines the available data resolutions for API requests.
 * @private
 */
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

/**
 * The main component for the dashboard page.
 * It manages state for data fetching, user selections (like year, month, resolution),
 * and renders the appropriate charts based on user input.
 *
 * @returns The main dashboard component.
 */
export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'de';
  const subtitle = t('dashboard.subtitle', { defaultValue: 'Auswertung gespeicherter Wetterdaten' });
  const controlsHeading = t('dashboard.controlsHeading', { defaultValue: 'Zeitraum & Anzeige' });
  const viewLabel = t('dashboard.view');
  const channelLabel = t('dashboard.channel');
  const [months, setMonths] = useState<string[]>([]);
  const [year, setYear] = useState<string>("");
  const [mon, setMon] = useState<string>(""); // MM
  const [resolution, setResolution] = useState<Resolution>("day");
  const [mode, setMode] = useState<"main" | "channel">("channel");
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  const [dataAll, setDataAll] = useState<DataResp | null>(null);
  const [dataMain, setDataMain] = useState<DataResp | null>(null);
  // Minutendaten für Statistikberechnung
  const [minuteDataMain, setMinuteDataMain] = useState<DataResp | null>(null);
  // Serverseitig berechnete Statistiken für den gewählten Zeitraum (Main-Sensoren)
  const [rangeStats, setRangeStats] = useState<any | null>(null);
  // Serverseitig berechnete Statistiken für den ausgewählten Kanal (im Single-Channel-Modus)
  const [channelStats, setChannelStats] = useState<any | null>(null);
  const [minuteDataAll, setMinuteDataAll] = useState<DataResp | null>(null);
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
  const [dateRangeChanged, setDateRangeChanged] = useState<boolean>(false);
  const [confirmButtonActive, setConfirmButtonActive] = useState<boolean>(false);

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
    fetch(API_ENDPOINTS.DATA_MONTHS)
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
    fetch(API_ENDPOINTS.CONFIG_CHANNELS)
      .then((r) => r.json())
      .then((cfg) => setChannelsCfg(cfg))
      .catch(() => {});
  }, [year, mon]);
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
    fetch(API_ENDPOINTS.DATA_EXTENT)
      .then((r) => r.json())
      .then((j) => {
        if (j?.min && j?.max) {
          const dMin = new Date(j.min.replace(" ", "T"));
          const dMax = new Date(j.max.replace(" ", "T"));
          if (!isNaN(dMin.getTime()) && !isNaN(dMax.getTime())) {
            setExtentMin(dMin);
            setExtentMax(dMax);
            // Default: aktuelles Jahr als Zeitraum (auf Extent begrenzt)
            const now = new Date();
            const y = now.getFullYear();
            const yStart = new Date(y, 0, 1, 0, 0, 0, 0);
            const yEnd = new Date(y, 11, 31, 23, 59, 59, 999);
            const defStartMs = Math.max(dMin.getTime(), yStart.getTime());
            const defEndMs = Math.min(dMax.getTime(), yEnd.getTime());
            if (defStartMs <= defEndMs) {
              const span = dMax.getTime() - dMin.getTime();
              const pStart = Math.round(((defStartMs - dMin.getTime()) / span) * 1000);
              const pEnd = Math.round(((defEndMs - dMin.getTime()) / span) * 1000);
              const safeStart = Math.max(0, Math.min(pStart, 999));
              const safeEnd = Math.max(Math.min(pEnd, 1000), Math.min(1000, safeStart + 1));
              setPctStart(safeStart);
              setPctEnd(safeEnd);
            } else {
              // Falls aktuelles Jahr ausserhalb des Extents liegt, gesamten Extent verwenden
              setPctStart(0);
              setPctEnd(1000);
            }
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

  // Function to fetch data when the confirmation button is clicked
  const fetchData = useCallback(() => {
    // Preconditions: Only proceed when required params are ready
    if (useGlobalRange) {
      if (!startParam || !endParam) return; // wait for extent mapping
    } else {
      if (!year || !mon) return; // wait for month selection
    }

    setLoading(true);
    setErrAll(null);
    setErrMain(null);
    const uAll = new URL(API_ENDPOINTS.DATA_ALLSENSORS, window.location.origin);
    const uMain = new URL(API_ENDPOINTS.DATA_MAIN, window.location.origin);
    // Serverseitige Statistik-Endpoints
    const uRange = new URL(API_ENDPOINTS.STATISTICS_RANGE, window.location.origin);
    // Kanal-Statistiken nur im Single-Channel-Modus abrufen
    const needsChannelStats = (mode === "channel" && selectedChannel !== "all");
    const uChannel = new URL(API_ENDPOINTS.STATISTICS_CHANNELS, window.location.origin);
    
    if (useGlobalRange) {
      uAll.searchParams.set("resolution", resolution);
      uMain.searchParams.set("resolution", resolution);
      
      if (startParam) {
        uAll.searchParams.set("start", startParam);
        uMain.searchParams.set("start", startParam);
        uRange.searchParams.set("start", startParam);
        if (needsChannelStats) {
          uChannel.searchParams.set("start", startParam);
        }
      }
      
      if (endParam) {
        uAll.searchParams.set("end", endParam);
        uMain.searchParams.set("end", endParam);
        uRange.searchParams.set("end", endParam);
        if (needsChannelStats) {
          uChannel.searchParams.set("end", endParam);
        }
      }
      if (needsChannelStats) {
        uChannel.searchParams.set("ch", selectedChannel);
      }
    } else {
      const monthStr = `${year}${mon}`;
      uAll.searchParams.set("month", monthStr);
      uMain.searchParams.set("month", monthStr);
      uRange.searchParams.set("month", monthStr);
      if (needsChannelStats) {
        uChannel.searchParams.set("month", monthStr);
        uChannel.searchParams.set("ch", selectedChannel);
      }
      
      uAll.searchParams.set("resolution", resolution);
      uMain.searchParams.set("resolution", resolution);
    }
    
    const promises: Promise<{ ok: boolean; body: any }>[] = [
      fetch(uAll.toString()).then(async (r) => ({ ok: r.ok, body: await r.json() })).catch(() => ({ ok: false, body: null })),
      fetch(uMain.toString()).then(async (r) => ({ ok: r.ok, body: await r.json() })).catch(() => ({ ok: false, body: null })),
      fetch(uRange.toString()).then(async (r) => ({ ok: r.ok, body: await r.json() })).catch(() => ({ ok: false, body: null })),
      needsChannelStats
        ? fetch(uChannel.toString()).then(async (r) => ({ ok: r.ok, body: await r.json() })).catch(() => ({ ok: false, body: null }))
        : Promise.resolve({ ok: true, body: null }),
    ];

    Promise.all(promises)
      .then(([a, m, rs, cs]) => {
        if (!a.ok || !a.body || a.body.error) {
          setErrAll(a.body?.error || t('statuses.loadErrorAllsensors'));
          setDataAll(null);
        } else {
          setDataAll(a.body);
        }
        
        if (!m.ok || !m.body || m.body.error) {
          setErrMain(m.body?.error || t('statuses.loadErrorMain'));
          setDataMain(null);
        } else {
          setDataMain(m.body);
        }
        // Serverseitige Bereichs-Statistiken
        if (!rs.ok || !rs.body || rs.body.ok === false) {
          console.warn('[Dashboard] Range stats failed:', rs.body?.error);
          setRangeStats(null);
        } else {
          console.log('[Dashboard] Range stats loaded:', rs.body);
          setRangeStats(rs.body);
        }
        // Kanal-Statistik optional
        if (!needsChannelStats || !cs.ok || !cs.body || cs.body.ok === false) {
          setChannelStats(null);
        } else {
          setChannelStats(cs.body);
        }
        // Minutendaten nicht mehr clientseitig laden
        setMinuteDataMain(null);
        setMinuteDataAll(null);
      })
      .finally(() => setLoading(false));
  }, [useGlobalRange, startParam, endParam, year, mon, resolution, mode, selectedChannel]);

  const handleModeSwitch = useCallback((nextMode: "main" | "channel") => {
    setMode(nextMode);
    if (useGlobalRange) {
      setDateRangeChanged(true);
      setConfirmButtonActive(true);
    } else {
      fetchData();
    }
  }, [useGlobalRange, fetchData]);

  const handleChannelSwitch = useCallback((nextChannel: string) => {
    setSelectedChannel(nextChannel);
    if (useGlobalRange) {
      setDateRangeChanged(true);
      setConfirmButtonActive(true);
    } else {
      fetchData();
    }
  }, [useGlobalRange, fetchData]);

  // Function to handle date range confirmation
  const handleConfirmDateRange = () => {
    if (confirmButtonActive && useGlobalRange) {
      setDateRangeChanged(false);
      setConfirmButtonActive(false);
      fetchData();
    }
  };

  // Effect to check if parameters have changed and update the confirm button state
  useEffect(() => {
    // Check if we have valid parameters to enable the button
    const hasValidParams = useGlobalRange ? 
      (!!startParam && !!endParam) : 
      (!!year && !!mon);
    
    if (hasValidParams) {
      if (useGlobalRange) {
        // In global range mode, just update button state
        setDateRangeChanged(true);
        setConfirmButtonActive(true);
      } else {
        // In month/year mode, fetch data automatically
        fetchData();
      }
    }
  }, [useGlobalRange, year, mon, resolution, startParam, endParam, fetchData]);

  // Effect for initial data loading on component mount
  useEffect(() => {
    // Only load data initially if we have valid parameters
    const hasValidParams = useGlobalRange ? 
      (!!startParam && !!endParam) : 
      (!!year && !!mon);
    
    if (hasValidParams && !dataMain && !dataAll) {
      // Initial data load
      fetchData();
    }
  }, [year, mon, startParam, endParam, useGlobalRange, dataMain, dataAll, fetchData]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('dashboard.title')}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </header>

      <section className={styles.card}>
        <span className={styles.sectionTitle}>{controlsHeading}</span>
        <div className={styles.controlGrid}>
          <label className={styles.toggleRow}>
            <input
              id="global-range"
              type="checkbox"
              className={styles.checkbox}
              checked={useGlobalRange}
              onChange={(e) => {
                setUseGlobalRange(e.target.checked);
                setDateRangeChanged(true);
                setConfirmButtonActive(true);
              }}
            />
            <span>{t('dashboard.useGlobalRange')}</span>
          </label>

          {!useGlobalRange && (
            <>
              <div className={styles.inputField}>
                <label className={styles.inputLabel} htmlFor="dashboard-year">{t('dashboard.year')}</label>
                <select
                  id="dashboard-year"
                  className={styles.select}
                  value={year}
                  onChange={(e) => {
                    setYear(e.target.value);
                    setDateRangeChanged(true);
                    setConfirmButtonActive(true);
                  }}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div className={styles.inputField}>
                <label className={styles.inputLabel} htmlFor="dashboard-month">{t('dashboard.month')}</label>
                <select
                  id="dashboard-month"
                  className={styles.select}
                  value={mon}
                  onChange={(e) => {
                    setMon(e.target.value);
                    setDateRangeChanged(true);
                    setConfirmButtonActive(true);
                  }}
                >
                  {(monthsByYear[year] || []).map((m) => (
                    <option key={m} value={m}>{getMonthName(Number(m), i18n.language || 'de') || m}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className={styles.inputField}>
            <label className={styles.inputLabel} htmlFor="dashboard-resolution">{t('dashboard.resolution')}</label>
            <select
              id="dashboard-resolution"
              className={styles.select}
              value={resolution}
              onChange={(e) => {
                setResolution(e.target.value as Resolution);
                if (useGlobalRange) {
                  setDateRangeChanged(true);
                  setConfirmButtonActive(true);
                } else {
                  fetchData();
                }
              }}
            >
              <option value="minute">{t('dashboard.minutes')}</option>
              <option value="hour">{t('dashboard.hours')}</option>
              <option value="day">{t('dashboard.days')}</option>
            </select>
          </div>

          <div className={styles.inputField}>
            <label className={styles.inputLabel} htmlFor="dashboard-view">{viewLabel}</label>
            <select
              id="dashboard-view"
              className={styles.select}
              value={mode}
              onChange={(e) => handleModeSwitch(e.target.value as "main" | "channel")}
            >
              <option value="main">{t('dashboard.mainSensors')}</option>
              <option value="channel">{t('dashboard.channelSensorsOption')}</option>
            </select>
          </div>

          {mode === "channel" && (
            <div className={styles.inputField}>
              <label className={styles.inputLabel} htmlFor="dashboard-channel">{channelLabel}</label>
              <select
                id="dashboard-channel"
                className={styles.select}
                value={selectedChannel}
                onChange={(e) => handleChannelSwitch(e.target.value)}
              >
                <option value="all">{t('dashboard.allChannels')}</option>
                {getChannelKeys(channelsCfg).map((k) => (
                  <option key={k} value={k}>{channelName(k, channelsCfg)}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {useGlobalRange && (
          <div className={styles.rangeRow}>
            <div className={styles.rangeControls}>
              <GlobalRangeControls
                min={extentMin}
                max={extentMax}
                pctStart={pctStart}
                pctEnd={pctEnd}
                setPctStart={setPctStart}
                setPctEnd={setPctEnd}
                setDateRangeChanged={setDateRangeChanged}
                setConfirmButtonActive={setConfirmButtonActive}
              />
            </div>
            <button
              type="button"
              onClick={handleConfirmDateRange}
              disabled={!confirmButtonActive}
              className={styles.confirmButton}
              title={t('statuses.ok')}
              aria-label={t('statuses.ok')}
            >
              <CheckIcon className="h-5 w-5" />
            </button>
          </div>
        )}
      </section>

      {loading && (
        <div className={`${styles.card} ${styles.statusMessage} ${styles.statusInfo}`}>
          {t('statuses.loading')}
        </div>
      )}
      {errMain && (
        <div className={`${styles.card} ${styles.statusMessage} ${styles.statusError}`}>
          {errMain}
        </div>
      )}
      {errAll && (
        <div className={`${styles.card} ${styles.statusMessage} ${styles.statusError}`}>
          {errAll}
        </div>
      )}

      {!loading && (
        <section className={`${styles.card} ${styles.tabsWrapper}`}>
          <div className={styles.tabList} role="tablist" aria-label={viewLabel}>
            <button
              type="button"
              className={`${styles.tabButton} ${mode === "main" ? styles.tabButtonActive : ""}`}
              role="tab"
              aria-selected={mode === "main"}
              onClick={() => handleModeSwitch("main")}
            >
              {t('dashboard.mainSensors')}
            </button>
            <button
              type="button"
              className={`${styles.tabButton} ${mode === "channel" ? styles.tabButtonActive : ""}`}
              role="tab"
              aria-selected={mode === "channel"}
              onClick={() => handleModeSwitch("channel")}
            >
              {t('dashboard.channelSensorsOption')}
            </button>
          </div>

          <div className={styles.contentSections}>
            {mode === "main" && (
              <div className={styles.sectionCard}>
                {dataMain
                  ? renderMainCharts(dataMain, xBaseMain, minuteDataMain, t, locale, rangeStats)
                  : <div className={styles.emptyState}>{t('statuses.noData')}</div>}
              </div>
            )}

            {mode === "channel" && (
              <div className={styles.tabsWrapper}>
                <div className={styles.secondaryTabList} role="tablist" aria-label={channelLabel}>
                  <button
                    type="button"
                    className={`${styles.secondaryTabButton} ${selectedChannel === "all" ? styles.secondaryTabButtonActive : ""}`}
                    role="tab"
                    aria-selected={selectedChannel === "all"}
                    onClick={() => handleChannelSwitch("all")}
                  >
                    {t('dashboard.allChannels')}
                  </button>
                  {getChannelKeys(channelsCfg).map((chKey) => (
                    <button
                      key={chKey}
                      type="button"
                      className={`${styles.secondaryTabButton} ${selectedChannel === chKey ? styles.secondaryTabButtonActive : ""}`}
                      role="tab"
                      aria-selected={selectedChannel === chKey}
                      onClick={() => handleChannelSwitch(chKey)}
                    >
                      {channelName(chKey, channelsCfg)}
                    </button>
                  ))}
                </div>

                <div className={styles.sectionCard}>
                  {dataAll
                    ? (selectedChannel === "all"
                      ? renderAllChannelsCharts(dataAll, channelsCfg, xBaseAll, minuteDataAll, t, locale)
                      : renderChannelCardCharts(dataAll, channelsCfg, xBaseAll, selectedChannel, minuteDataAll, t, locale, channelStats))
                    : <div className={styles.emptyState}>{t('statuses.noData')}</div>}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Renders a single line chart for a specific metric of a specific channel.
 * @param data - The data for all sensors.
 * @param chKey - The key of the channel to render (e.g., 'ch1').
 * @param metric - The metric to display.
 * @param channelsCfg - The channel configuration.
 * @param xBase - The baseline timestamp for the x-axis.
 * @param t - The translation function.
 * @param locale - The current locale.
 * @returns A React component containing the line chart.
 * @private
 */
function renderChannelChart(data: DataResp, chKey: string, metric: ChannelMetric, channelsCfg: ChannelsConfig, xBase: number | null, t: (key: string) => string, locale: string) {
  const rows = data.rows || [];
  if (!rows.length || !xBase) return <div className="text-xs text-gray-500">{t('statuses.noData')}</div>;
  const times = rows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
  const xVals = times.map((t) => Math.round((t.getTime() - xBase) / 60000));
  const chNum = (chKey.match(/\d+/)?.[0]) || "1";
  const col = headerKeyForAllsensors(data.header || [], metric, chNum);
  const label = `${channelName(chKey, channelsCfg)} ${metricDisplayLabel(metric, t)}`;
  const spanMin = times.length >= 2 ? Math.round((times[times.length - 1].getTime() - times[0].getTime()) / 60000) : 0;
  const fmt = makeTimeTickFormatter(xBase, spanMin, locale);
  const hoverFmt = makeHoverTimeFormatter(xBase, locale);
  const series: LineSeries = {
    id: label,
    color: COLORS[0],
    points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
  };
  if (!series.points.some((p) => Number.isFinite(p.y))) return <div className="text-xs text-gray-500">{t('statuses.noNumeric')}</div>;
  return (
    <div className="rounded border border-gray-200 p-3">
      <LineChart series={[series]} yLabel={label} xLabel={t('dashboard.time')} xTickFormatter={fmt} hoverTimeFormatter={hoverFmt} showLegend={false} yUnit={unitForMetric(metric)} />
    </div>
  );
}

/**
 * Renders all charts for the main weather station sensors.
 * This includes temperature, rain, wind, and other metrics, along with statistical cards.
 * @param data - The data from the 'main' dataset.
 * @param xBase - The baseline timestamp for the x-axis.
 * @param minuteData - Higher-resolution minute data for more accurate statistics.
 * @param t - The translation function.
 * @param locale - The current locale.
 * @returns A React fragment containing all the charts for the main sensors.
 * @private
 */
function renderMainCharts(data: DataResp, xBase: number | null, minuteData: DataResp | null, t: (key: string) => string, locale: string, serverRangeStats?: any) {
  const rows = data.rows || [];
  if (!rows.length || !xBase) return <div className="text-xs text-gray-500">{t('statuses.noData')}</div>;
  const times = rows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
  const xVals = times.map((t) => Math.round((t.getTime() - xBase) / 60000));
  const cols = inferNumericColumns(data);
  const spanMin = times.length >= 2 ? Math.round((times[times.length - 1].getTime() - times[0].getTime()) / 60000) : 0;
  const fmt = makeTimeTickFormatter(xBase, spanMin, locale);
  const hoverFmt = makeHoverTimeFormatter(xBase, locale);
  const header = (data.header || []).slice();
  // Debug main headers and sample row
  try {
    console.debug("[Main] Header:", header);
    console.debug("[Main] Numeric cols:", cols);
    console.debug("[Main] First row keys:", Object.keys(rows[0] || {}));
    console.debug("[Main] First row sample:", rows[0]);
  } catch {}
  
  // Temperaturmetriken identifizieren und gruppieren
  const tempColumns = findTemperatureColumns(header);
  console.debug("[Main] Detected temp columns:", tempColumns);
  
  // Regenmetriken identifizieren und gruppieren
  const rainColumns = findRainColumns(header);
  console.debug("[Main] Detected rain columns:", rainColumns);
  
  // Windmetriken identifizieren (Geschwindigkeit & Böe)
  const { windCol, gustCol } = findWindColumns(header);
  // Solar/UVI identifizieren
  const { solarCol, uvCol } = findSolarUvColumns(header);
  
  const nonTempRainColumns = cols.filter(col => !tempColumns.includes(col) && !rainColumns.includes(col));
  
  // Temperaturdiagramm erstellen
  const tempSeries: LineSeries[] = [];
  const tempColors = [COLORS[0], COLORS[2], COLORS[4]]; // Blau, Orange, Lila
  
  for (let i = 0; i < tempColumns.length; i++) {
    const col = tempColumns[i];
    // Debug values for this column
    try {
      const samples = rows.slice(0, 5).map((r) => ({ v: r[col], t: typeof r[col] }));
      console.debug(`[Main] Column '${col}' samples:`, samples);
    } catch {}
    const series: LineSeries = {
      id: col,
      color: tempColors[i % tempColors.length],
      points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
    };
    if (series.points.some((p) => Number.isFinite(p.y))) {
      tempSeries.push(series);
    }
  }
  console.debug("[Main] tempSeries length:", tempSeries.length);
  
  // Regendiagramm erstellen
  const rainSeries: LineSeries[] = [];
  const rainColors = [COLORS[1], COLORS[3], COLORS[5]]; // Grün, Gelb, Rot
  
  for (let i = 0; i < rainColumns.length; i++) {
    const col = rainColumns[i];
    const series: LineSeries = {
      id: col,
      color: rainColors[i % rainColors.length],
      points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
    };
    if (series.points.some((p) => Number.isFinite(p.y))) {
      rainSeries.push(series);
    }
  }
  
  // Detect daily rain column for bar chart
  const pickRain = () => {
    // prefer daily rain, then hourly, then generic rain (exclude rate/year/month/week)
    const daily = header.find((h) => {
      const s = h.toLowerCase();
      return (s.includes("rain") || s.includes("regen")) && (s.includes("daily") || s.includes("tag")) && !s.includes("rate");
    });
    if (daily) return { mode: "daily" as const, col: daily };
    const hourly = header.find((h) => {
      const s = h.toLowerCase();
      return (s.includes("rain") || s.includes("regen")) && (s.includes("hour") || s.includes("stunde")) && !s.includes("rate");
    });
    if (hourly) return { mode: "hourly" as const, col: hourly };
    const generic = header.find((h) => {
      const s = h.toLowerCase();
      if (!(s.includes("rain") || s.includes("regen"))) return false;
      if (s.includes("rate")) return false;
      if (s.includes("year") || s.includes("jahr")) return false;
      if (s.includes("month") || s.includes("monat")) return false;
      if (s.includes("week") || s.includes("woche")) return false;
      return true;
    });
    if (generic) return { mode: "interval" as const, col: generic };
    return null;
  };
  const rainSel = pickRain();
  
  // Finde Regen/Stunde für Balkendiagramm
  const hourlyRainCol = header.find(h => {
    const s = h.toLowerCase();
    return (s.includes("rain") || s.includes("regen")) && 
           (s.includes("hour") || s.includes("stunde")) && 
           !s.includes("rate");
  });
  
  // Entferne Regen/Stunde aus den nonTempRainColumns, damit es nicht als separate Linie angezeigt wird
  const nonTempRainColumnsFiltered = nonTempRainColumns.filter(col => col !== hourlyRainCol);
  
  // Aggregate to per-day totals (mm)
  const rainPoints: { x: number; y: number }[] = [];
  if (rainSel) {
    const byDay = new Map<string, { date: Date; sum: number; max: number }>();
    for (let i = 0; i < rows.length; i++) {
      const d = times[i];
      if (!d) continue;
      const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const rec = byDay.get(key) || { date: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0), sum: 0, max: 0 };
      const v = numOrNaN(rows[i][rainSel.col]);
      if (Number.isFinite(v)) {
        if (rainSel.mode === "daily") {
          rec.max = Math.max(rec.max, v);
        } else {
          rec.sum += v; // hourly or interval
        }
      }
      byDay.set(key, rec);
    }
    const entries = Array.from(byDay.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    for (const e of entries) {
      const y = rainSel.mode === "daily" ? e.max : e.sum;
      if (!Number.isFinite(y)) continue;
      const x = Math.round((e.date.getTime() - xBase) / 60000);
      rainPoints.push({ x, y });
    }
  }
  
  // Regen/Stunde als Balkendiagramm
  const hourlyRainPoints: { x: number; y: number }[] = [];
  if (hourlyRainCol) {
    for (let i = 0; i < rows.length; i++) {
      const d = times[i];
      if (!d) continue;
      const v = numOrNaN(rows[i][hourlyRainCol]);
      if (!Number.isFinite(v) || v === 0) continue; // Nur Werte > 0 anzeigen
      const x = Math.round((d.getTime() - xBase) / 60000);
      hourlyRainPoints.push({ x, y: v });
    }
  }
  
  // Regenstatistik berechnen
  const rainStats = calculateRainStats(rows, times, hourlyRainCol || null);
  
  const totalRain = rainPoints.reduce((acc, p) => acc + (Number.isFinite(p.y) ? p.y : 0), 0);
  const nonRainColumns = nonTempRainColumnsFiltered.filter(c => rainSel ? c !== rainSel.col : true);
  
  return (
    <>
      {/* Außentemperatur */}
      {(() => {
        const outsideCol = (data.header || []).find(h => h.startsWith("Temperatur Aussen"));
        if (!outsideCol) return null;
        const series: LineSeries = {
          id: outsideCol,
          color: COLORS[0],
          points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[outsideCol]) })),
        };
        if (!series.points.some((p) => Number.isFinite(p.y))) return null;
        // Stats & avg
        let statsRows = rows;
        let statsTimes = times;
        let resolvedCol = outsideCol;
        const avgOfCol = (rs: typeof rows, col?: string | null) => {
          if (!col) return NaN;
          let sum = 0, count = 0;
          for (const r of rs) {
            const v = numOrNaN(r[col]);
            if (Number.isFinite(v)) { sum += v; count++; }
          }
          return count ? (sum / count) : NaN;
        };
        const avgTempOutside = avgOfCol(rows, outsideCol);
        if (minuteData && minuteData.rows && minuteData.rows.length > 0) {
          const mHeader = minuteData.header || [];
          resolvedCol = mHeader.find(h => h === outsideCol) || outsideCol;
          statsRows = minuteData.rows;
          statsTimes = statsRows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
        }
        const statsOutside = calculateTemperatureStats(statsRows, statsTimes, [resolvedCol]);
        // Feels like (only with outside)
        let statsFelt: ReturnType<typeof calculateTemperatureStats> | null = null;
        const feltBase = (data.header || []).find(h => h.startsWith("Gefühlte Temperatur"));
        if (feltBase) {
          let feltCol = feltBase;
          if (minuteData && minuteData.rows && minuteData.rows.length > 0) {
            const mHeader = minuteData.header || [];
            feltCol = mHeader.find(h => h === feltBase) || feltBase;
          }
          statsFelt = calculateTemperatureStats(statsRows, statsTimes, [feltCol]);
        }
        return (
          <div className="rounded border border-gray-200 p-3">
            {(() => {
              const seriesList: LineSeries[] = [series];
              // Taupunkt Außen
              const dewOutsideCol = (data.header || []).find(h => h.startsWith("Taupunkt Aussen")) 
                || (data.header || []).find(h => h.startsWith("Taupunkt") && !h.toLowerCase().includes("innen"));
              if (dewOutsideCol) {
                const s: LineSeries = {
                  id: metricDisplayLabel("Taupunkt", t),
                  color: COLORS[1],
                  points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[dewOutsideCol]) })),
                };
                if (s.points.some(p => Number.isFinite(p.y))) seriesList.push(s);
              }
              // Gefühlte Temperatur (nur außen)
              const feltBase2 = (data.header || []).find(h => h.startsWith("Gefühlte Temperatur"));
              if (feltBase2) {
                const s: LineSeries = {
                  id: metricDisplayLabel("Gefühlte Temperatur", t),
                  color: COLORS[2],
                  points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[feltBase2]) })),
                };
                if (s.points.some(p => Number.isFinite(p.y))) seriesList.push(s);
              }
              return (
                <LineChart 
                  series={seriesList} 
                  yLabel={`${t('fields.outdoorTemperature')} (°C)`}
                  xLabel={t('dashboard.time')} 
                  xTickFormatter={fmt} 
                  hoverTimeFormatter={hoverFmt} 
                  showLegend={true} 
                  yUnit="°C" 
                />
              );
            })()}
            <div className="mt-2 text-sm border-t border-gray-100 pt-2">
              {/* Prefer server-side statistics for the range if available */}
              {serverRangeStats?.stats?.temp ? (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
                  <div className="bg-amber-50 p-2 rounded">
                    <div className="font-medium text-amber-700">{t('dashboard.daysOver30C')}</div>
                    <div className="text-lg">{serverRangeStats.stats.temp.over30?.count ?? '—'} <span className="text-xs text-gray-500">{t('dashboard.of')} {serverRangeStats.totalPeriodDays ?? '—'}</span></div>
                  </div>
                  <div className="bg-blue-50 p-2 rounded">
                    <div className="font-medium text-blue-700">{t('dashboard.daysUnder0C')}</div>
                    <div className="text-lg">{serverRangeStats.stats.temp.under0?.count ?? '—'} <span className="text-xs text-gray-500">{t('dashboard.of')} {serverRangeStats.totalPeriodDays ?? '—'}</span></div>
                  </div>
                  <div className="bg-rose-50 p-2 rounded">
                    <div className="font-medium text-rose-700">{t('dashboard.highestTemperature')}</div>
                    <div className="text-lg">{Number.isFinite(serverRangeStats.stats.temp.max) ? `${serverRangeStats.stats.temp.max.toFixed(1)} °C` : '—'}</div>
                    {serverRangeStats.stats.temp.maxDate && (<div className="text-xs text-gray-500">{formatDisplayLocale(new Date(String(serverRangeStats.stats.temp.maxDate) + 'T12:00'), locale)}</div>)}
                  </div>
                  <div className="bg-indigo-50 p-2 rounded">
                    <div className="font-medium text-indigo-700">{t('dashboard.lowestTemperature')}</div>
                    <div className="text-lg">{Number.isFinite(serverRangeStats.stats.temp.min) ? `${serverRangeStats.stats.temp.min.toFixed(1)} °C` : '—'}</div>
                    {serverRangeStats.stats.temp.minDate && (<div className="text-xs text-gray-500">{formatDisplayLocale(new Date(String(serverRangeStats.stats.temp.minDate) + 'T12:00'), locale)}</div>)}
                  </div>
                  <div className="bg-teal-50 p-2 rounded">
                    <div className="font-medium text-teal-700">{t('dashboard.average')}</div>
                    <div className="text-lg">{Number.isFinite(serverRangeStats.stats.temp.avg) ? `${serverRangeStats.stats.temp.avg.toFixed(1)} °C` : '—'}</div>
                  </div>
                </div>
              ) : (
              statsOutside && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
                  <div className="bg-amber-50 p-2 rounded">
                    <div className="font-medium text-amber-700">{t('dashboard.daysOver30C')}</div>
                    <div className="text-lg">{statsOutside.daysOver30} <span className="text-xs text-gray-500">{t('dashboard.of')} {statsOutside.totalPeriodDays}</span></div>
                  </div>
                  <div className="bg-blue-50 p-2 rounded">
                    <div className="font-medium text-blue-700">{t('dashboard.daysUnder0C')}</div>
                    <div className="text-lg">{statsOutside.daysUnder0} <span className="text-xs text-gray-500">{t('dashboard.of')} {statsOutside.totalPeriodDays}</span></div>
                  </div>
                  <div className="bg-rose-50 p-2 rounded">
                    <div className="font-medium text-rose-700">{t('dashboard.highestTemperature')}</div>
                    <div className="text-lg">{Number.isFinite(statsOutside.maxTemp) ? `${statsOutside.maxTemp.toFixed(1)} °C` : "—"}</div>
                    {statsOutside.maxTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsOutside.maxTime, locale)}</div>)}
                  </div>
                  <div className="bg-indigo-50 p-2 rounded">
                    <div className="font-medium text-indigo-700">{t('dashboard.lowestTemperature')}</div>
                    <div className="text-lg">{Number.isFinite(statsOutside.minTemp) ? `${statsOutside.minTemp.toFixed(1)} °C` : "—"}</div>
                    {statsOutside.minTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsOutside.minTime, locale)}</div>)}
                  </div>
                  <div className="bg-teal-50 p-2 rounded">
                    <div className="font-medium text-teal-700">{t('dashboard.average')}</div>
                    <div className="text-lg">{Number.isFinite(avgTempOutside) ? `${avgTempOutside.toFixed(1)} °C` : "—"}</div>
                  </div>
                </div>
              ))}
              {/* Feels-like statistics: prefer server-side range stats */}
              {serverRangeStats?.stats?.feels ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-orange-50 p-2 rounded">
                    <div className="font-medium text-orange-700">{t('dashboard.feelsLikeMax')}</div>
                    <div className="text-lg">{Number.isFinite(serverRangeStats.stats.feels.max) ? `${serverRangeStats.stats.feels.max.toFixed(1)} °C` : '—'}</div>
                    {serverRangeStats.stats.feels.maxDate && (<div className="text-xs text-gray-500">{formatDisplayLocale(new Date(String(serverRangeStats.stats.feels.maxDate) + 'T12:00'), locale)}</div>)}
                  </div>
                  <div className="bg-cyan-50 p-2 rounded">
                    <div className="font-medium text-cyan-700">{t('dashboard.feelsLikeMin')}</div>
                    <div className="text-lg">{Number.isFinite(serverRangeStats.stats.feels.min) ? `${serverRangeStats.stats.feels.min.toFixed(1)} °C` : '—'}</div>
                    {serverRangeStats.stats.feels.minDate && (<div className="text-xs text-gray-500">{formatDisplayLocale(new Date(String(serverRangeStats.stats.feels.minDate) + 'T12:00'), locale)}</div>)}
                  </div>
                </div>
              ) : (
                statsFelt && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-orange-50 p-2 rounded">
                      <div className="font-medium text-orange-700">{t('dashboard.feelsLikeMax')}</div>
                      <div className="text-lg">{Number.isFinite(statsFelt.maxTemp) ? `${statsFelt.maxTemp.toFixed(1)} °C` : "—"}</div>
                      {statsFelt.maxTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsFelt.maxTime, locale)}</div>)}
                    </div>
                    <div className="bg-cyan-50 p-2 rounded">
                      <div className="font-medium text-cyan-700">{t('dashboard.feelsLikeMin')}</div>
                      <div className="text-lg">{Number.isFinite(statsFelt.minTemp) ? `${statsFelt.minTemp.toFixed(1)} °C` : "—"}</div>
                      {statsFelt.minTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsFelt.minTime, locale)}</div>)}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        );
      })()}

      {/* Innentemperatur */}
      {(() => {
        const insideCol = (data.header || []).find(h => h.startsWith("Temperatur Innen"));
        if (!insideCol) return null;
        const series: LineSeries = {
          id: insideCol,
          color: COLORS[2],
          points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[insideCol]) })),
        };
        if (!series.points.some((p) => Number.isFinite(p.y))) return null;
        // Stats & avg
        let statsRows = rows;
        let statsTimes = times;
        let resolvedCol = insideCol;
        const avgOfCol = (rs: typeof rows, col?: string | null) => {
          if (!col) return NaN;
          let sum = 0, count = 0;
          for (const r of rs) {
            const v = numOrNaN(r[col]);
            if (Number.isFinite(v)) { sum += v; count++; }
          }
          return count ? (sum / count) : NaN;
        };
        const avgTempInside = avgOfCol(rows, insideCol);
        if (minuteData && minuteData.rows && minuteData.rows.length > 0) {
          const mHeader = minuteData.header || [];
          resolvedCol = mHeader.find(h => h === insideCol) || insideCol;
          statsRows = minuteData.rows;
          statsTimes = statsRows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
        }
        const statsInside = calculateTemperatureStats(statsRows, statsTimes, [resolvedCol]);
        return (
          <div className="rounded border border-gray-200 p-3">
            {(() => {
              const seriesList: LineSeries[] = [series];
              // Taupunkt Innen
              const dewInsideCol = (data.header || []).find(h => h.startsWith("Taupunkt Innen")) 
                || (data.header || []).find(h => h.startsWith("Taupunkt") && h.toLowerCase().includes("innen"));
              if (dewInsideCol) {
                const s: LineSeries = {
                  id: metricDisplayLabel("Taupunkt", t),
                  color: COLORS[1],
                  points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[dewInsideCol]) })),
                };
                if (s.points.some(p => Number.isFinite(p.y))) seriesList.push(s);
              }
              // Gefühlte Temperatur Innen (bzw. Wärmeindex Innen), falls vorhanden
              const feltInsideCol = (data.header || []).find(h => h.startsWith("Gefühlte Temperatur Innen"))
                || (data.header || []).find(h => h.startsWith("Wärmeindex Innen"))
                || (data.header || []).find(h => h.toLowerCase().includes("innen") && (h.startsWith("Gefühlte Temperatur") || h.startsWith("Wärmeindex")));
              if (feltInsideCol) {
                const s: LineSeries = {
                  id: metricDisplayLabel("Gefühlte Temperatur", t),
                  color: COLORS[3],
                  points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[feltInsideCol]) })),
                };
                if (s.points.some(p => Number.isFinite(p.y))) seriesList.push(s);
              }
              return (
                <LineChart 
                  series={seriesList} 
                  yLabel={`${t('fields.indoorTemperature')} (°C)`}
                  xLabel={t('dashboard.time')} 
                  xTickFormatter={fmt} 
                  hoverTimeFormatter={hoverFmt} 
                  showLegend={true} 
                  yUnit="°C" 
                />
              );
            })()}
            <div className="mt-2 text-sm border-t border-gray-100 pt-2">
              {statsInside && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
                  <div className="bg-amber-50 p-2 rounded">
                    <div className="font-medium text-amber-700">{t('dashboard.daysOver30C')}</div>
                    <div className="text-lg">{statsInside.daysOver30} <span className="text-xs text-gray-500">{t('dashboard.of')} {statsInside.totalPeriodDays}</span></div>
                  </div>
                  <div className="bg-blue-50 p-2 rounded">
                    <div className="font-medium text-blue-700">{t('dashboard.daysUnder0C')}</div>
                    <div className="text-lg">{statsInside.daysUnder0} <span className="text-xs text-gray-500">{t('dashboard.of')} {statsInside.totalPeriodDays}</span></div>
                  </div>
                  <div className="bg-rose-50 p-2 rounded">
                    <div className="font-medium text-rose-700">{t('dashboard.highestTemperature')}</div>
                    <div className="text-lg">{Number.isFinite(statsInside.maxTemp) ? `${statsInside.maxTemp.toFixed(1)} °C` : "—"}</div>
                    {statsInside.maxTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsInside.maxTime, locale)}</div>)}
                  </div>
                  <div className="bg-indigo-50 p-2 rounded">
                    <div className="font-medium text-indigo-700">{t('dashboard.lowestTemperature')}</div>
                    <div className="text-lg">{Number.isFinite(statsInside.minTemp) ? `${statsInside.minTemp.toFixed(1)} °C` : "—"}</div>
                    {statsInside.minTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(statsInside.minTime, locale)}</div>)}
                  </div>
                  <div className="bg-teal-50 p-2 rounded">
                    <div className="font-medium text-teal-700">{t('dashboard.average')}</div>
                    <div className="text-lg">{Number.isFinite(avgTempInside) ? `${avgTempInside.toFixed(1)} °C` : "—"}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      
      {/* Andere Metriken */}
      {nonRainColumns.map((col, i) => {
        const series: LineSeries = {
          id: col,
          color: COLORS[i % COLORS.length],
          points: rows.map((r, idx) => ({ x: xVals[idx], y: numOrNaN(r[col]) })),
        };
        if (!series.points.some((p) => Number.isFinite(p.y))) return null;
        
        // Wind-/Böe- sowie Solar-/UVI-Statistiken (Minutenbasis, falls verfügbar)
        const isWind = (windCol != null) && (col === windCol);
        const isGust = (gustCol != null) && (col === gustCol);
        const isSolar = (solarCol != null) && (col === solarCol);
        const isUv = (uvCol != null) && (col === uvCol);
        let stats: { max: number; min: number; maxTime: Date | null; minTime: Date | null } | null = null;
        if (isWind || isGust || isSolar || isUv) {
          let statsRows = rows;
          let statsTimes = times;
          let resolvedCol = col;
          if (minuteData && minuteData.rows && minuteData.rows.length > 0) {
            const mHeader = minuteData.header || [];
            resolvedCol = mHeader.find(h => h === col) || col;
            statsRows = minuteData.rows;
            statsTimes = statsRows.map((r) => toDate(r.time as string)).filter(Boolean) as Date[];
          }
          stats = calculateMinMaxForColumn(statsRows, statsTimes, resolvedCol);
          // Prefer server-side wind/gust statistics if available
          if (serverRangeStats?.stats?.wind && (isWind || isGust)) {
            const w = serverRangeStats.stats.wind;
            if (isWind && Number.isFinite(w.max)) {
              stats = { max: w.max, min: NaN as any, maxTime: w.maxDate ? new Date(String(w.maxDate) + 'T12:00') : null, minTime: null };
            }
            if (isGust && Number.isFinite(w.gustMax)) {
              stats = { max: w.gustMax, min: NaN as any, maxTime: w.gustMaxDate ? new Date(String(w.gustMaxDate) + 'T12:00') : null, minTime: null };
            }
          }
        }
        const unit = unitForHeader(col) || "";

        return (
          <div key={col} className="rounded border border-gray-200 p-3">
            <LineChart series={[series]} yLabel={col} xLabel={t('dashboard.time')} xTickFormatter={fmt} hoverTimeFormatter={hoverFmt} showLegend={false} yUnit={unitForHeader(col)} />
            {(isWind || isGust || isSolar || isUv) && stats && (
              <div className="mt-2 text-sm border-t border-gray-100 pt-2">
                <div className="grid grid-cols-1 gap-2">
                  <div className="bg-rose-50 p-2 rounded">
                    <div className="font-medium text-rose-700">{
                      isWind ? t('dashboard.highestWind') :
                      isGust ? t('dashboard.highestGust') :
                      isSolar ? t('dashboard.highestSolar') :
                      t('dashboard.highestUvi')
                    }</div>
                    <div className="text-lg">{Number.isFinite(stats.max) ? `${stats.max.toFixed(1)} ${unit}` : "—"}</div>
                    {stats.maxTime && (<div className="text-xs text-gray-500">{formatDisplayLocale(stats.maxTime, locale)}</div>)}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      
      {/* Regen */}
      {rainColumns.length > 0 && (
        <div className="mb-4">
          <h3 className="text-lg font-medium mb-2">{`${t('gauges.precipitation')} (mm)`}</h3>
          <LineChart 
            series={rainSeries} 
            yLabel={`${t('gauges.precipitation')} (mm)`} 
            xLabel={t('dashboard.time')} 
            xTickFormatter={fmt} 
            hoverTimeFormatter={hoverFmt} 
            showLegend={true} 
            yUnit="mm" 
          />
        </div>
      )}
      
      {/* Täglicher Regen (Balkendiagramm) */}
      {rainPoints.length > 0 && (
        <div className="rounded border border-gray-200 p-3">
          <div className="mb-2 text-sm text-gray-700 dark:text-gray-300">
            <span className="font-medium">{t('dashboard.sumInPeriod')}</span> {totalRain.toFixed(1)} mm
          </div>
          <LineChart
            series={[{ id: t('dashboard.rainPerDay'), color: COLORS[1], points: rainPoints }]}
            yLabel={t('dashboard.rainPerDay')}
            xLabel={t('dashboard.time')}
            xTickFormatter={fmt}
            hoverTimeFormatter={hoverFmt}
            showLegend={false}
            bars
            yUnit="mm"
            barWidthPx={2}
          />
          
          {/* Regenstatistik */}
          {(() => {
            // Bevorzugt serverseitige Regenstatistik
            const rainStats = serverRangeStats?.stats?.rain;
            const rainDays = serverRangeStats?.stats?.rainDays;
            
            return (
              <div className="mt-2 text-sm border-t border-gray-100 pt-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-blue-50 p-2 rounded">
                    <div className="font-medium text-blue-700">{t('dashboard.daysOver30mm')}</div>
                    <div className="text-lg">{rainStats?.over30mm?.count ?? '—'} <span className="text-xs text-gray-500">{t('dashboard.of')} {serverRangeStats?.totalPeriodDays ?? '—'}</span></div>
                  </div>
                  <div className="bg-gray-50 p-2 rounded">
                    <div className="font-medium text-gray-700">{t('dashboard.rainDays')}</div>
                    <div className="text-lg">{rainDays ?? '—'} <span className="text-xs text-gray-500">{t('dashboard.of')} {serverRangeStats?.totalPeriodDays ?? '—'}</span></div>
                  </div>
                  <div className="bg-emerald-50 p-2 rounded">
                    <div className="font-medium text-emerald-700">{t('dashboard.total')}</div>
                    <div className="text-lg">{Number.isFinite(serverRangeStats?.stats?.rain?.total) ? `${serverRangeStats.stats.rain.total.toFixed(1)} ` : `${totalRain.toFixed(1)} `}<span className="text-xs text-gray-500">mm</span></div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
      
      {/* Stündlicher Regen (Balkendiagramm) */}
      {hourlyRainPoints.length > 0 && (
        <div className="rounded border border-gray-200 p-3">
          <LineChart
            series={[{ id: t('dashboard.rainPerHour'), color: COLORS[3], points: hourlyRainPoints }]}
            yLabel={t('dashboard.rainPerHour')}
            xLabel={t('dashboard.time')}
            xTickFormatter={fmt}
            hoverTimeFormatter={hoverFmt}
            showLegend={false}
            bars
            yUnit="mm"
            barWidthPx={2}
          />
        </div>
      )}
    </>
  );
}

/**
 * Finds columns related to temperature from a list of headers.
 * @param header - An array of header strings.
 * @returns An array of header strings that are identified as temperature metrics.
 * @private
 */
function findTemperatureColumns(header: string[]): string[] {
  const tempColumns: string[] = [];
  
  // Suche nach den Temperatur-Strings (nur Anfang prüfen)
  for (const h of header) {
    if (h.startsWith("Temperatur Aussen") ||
        h.startsWith("Temperatur Innen") ||
        h.startsWith("Taupunkt") ||
        h.startsWith("Gefühlte Temperatur")) {
      tempColumns.push(h);
    }
  }
  
  console.debug("Detected temperature metrics:", tempColumns);
  return tempColumns;
}

/**
 * Finds columns related to rain from a list of headers.
 * It specifically looks for weekly, monthly, and yearly totals.
 * @param header - An array of header strings.
 * @returns An array of header strings identified as rain total metrics.
 * @private
 */
function findRainColumns(header: string[]): string[] {
  const rainColumns: string[] = [];
  
  console.debug("Available headers for rain detection:", header);
  
  // Suche nach Regen/Woche
  const regenWoche = header.find(h => {
    const s = h.toLowerCase();
    return (s.includes("rain") || s.includes("regen")) && 
           (s.includes("week") || s.includes("woche"));
  });
  if (regenWoche) {
    console.debug("Rain/week found:", regenWoche);
    rainColumns.push(regenWoche);
  }
  
  // Suche nach Regen/Monat
  const regenMonat = header.find(h => {
    const s = h.toLowerCase();
    return (s.includes("rain") || s.includes("regen")) && 
           (s.includes("month") || s.includes("monat"));
  });
  if (regenMonat) {
    console.debug("Rain/month found:", regenMonat);
    rainColumns.push(regenMonat);
  }
  
  // Suche nach Regen/Jahr
  const regenJahr = header.find(h => {
    const s = h.toLowerCase();
    return (s.includes("rain") || s.includes("regen")) && 
           (s.includes("year") || s.includes("jahr"));
  });
  if (regenJahr) {
    console.debug("Rain/year found:", regenJahr);
    rainColumns.push(regenJahr);
  }
  
  // Wichtig: Regen/Stunde NICHT in die Regenmetriken aufnehmen, da diese als Balkendiagramm dargestellt wird
  
  console.debug("Detected rain metrics:", rainColumns);
  return rainColumns;
}

/**
 * Finds columns for wind speed and wind gust from a list of headers.
 * @param header - An array of header strings.
 * @returns An object containing the identified wind and gust column names, or null if not found.
 * @private
 */
function findWindColumns(header: string[]): { windCol: string | null; gustCol: string | null } {
  let windCol: string | null = null;
  let gustCol: string | null = null;
  for (const h of header) {
    const s = h.toLowerCase();
    // Gust / Böe
    if ((s.includes("gust") || s.includes("böe") || s.includes("b\u00f6e")) && !gustCol) {
      gustCol = h;
      continue;
    }
    // Windgeschwindigkeit (keine Richtung)
    if (s.includes("wind") && !s.includes("direction") && !s.includes("richtung") && !s.includes("gust") && !s.includes("böe") && !s.includes("b\u00f6e") && !windCol) {
      windCol = h;
      continue;
    }
    if ((s.includes("wind speed") || s.includes("windspeed")) && !windCol) {
      windCol = h;
      continue;
    }
  }
  return { windCol, gustCol };
}

/**
 * Finds columns for solar radiation and UV index from a list of headers.
 * @param header - An array of header strings.
 * @returns An object containing the identified solar and UV column names, or null if not found.
 * @private
 */
function findSolarUvColumns(header: string[]): { solarCol: string | null; uvCol: string | null } {
  let solarCol: string | null = null;
  let uvCol: string | null = null;
  for (const h of header) {
    const s = h.toLowerCase();
    if (!uvCol && (s.includes("uv index") || s === "uv" || s.includes("uv"))) {
      uvCol = h;
      continue;
    }
    if (!solarCol && (s.includes("solar") || s.includes("radiation") || s.includes("strahlung") || s.includes("sonne"))) {
      solarCol = h;
      continue;
    }
  }
  return { solarCol, uvCol };
}

/**
 * Parses a string into a Date object.
 * Handles multiple common date formats and provides a fallback.
 * @param s - The date string to parse.
 * @returns A Date object, or null if parsing fails.
 * @private
 */
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

/**
 * Safely converts a value to a number, returning NaN for invalid inputs.
 * @param v - The value to convert.
 * @returns A number or NaN.
 * @private
 */
function numOrNaN(v: any): number {
  if (v == null) return NaN;
  const n = typeof v === "number" ? v : Number(v);
  return isNaN(n) ? NaN : n;
}

/**
 * Clamps a number between a minimum and maximum value.
 * @param n - The number to clamp.
 * @param min - The minimum value.
 * @param max - The maximum value.
 * @returns The clamped number.
 * @private
 */
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

/**
 * Finds the index of the nearest time in an array of dates to a given timestamp.
 * @param times - A sorted array of Date objects.
 * @param ms - The timestamp in milliseconds to find the nearest match for.
 * @returns The index of the nearest time.
 * @private
 */
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

/**
 * Formats a Date object for display in `DD.MM.YYYY HH:MI` format.
 * @param d - The Date object.
 * @returns The formatted string.
 * @private
 */
function formatDisplay(d: Date) {
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
}

/**
 * Formats a Date object into a string suitable for `datetime-local` input fields (`YYYY-MM-DDTHH:MI`).
 * @param d - The Date object.
 * @returns The formatted string.
 * @private
 */
function formatLocal(d: Date) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/**
 * Formats a Date object into a string suitable for API requests (`YYYY-MM-DDTHH:MI`).
 * @param d - The Date object.
 * @returns The formatted string.
 * @private
 */
function formatForApi(d: Date) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/**
 * Generates a pretty label for a sensor header, replacing 'CHx' with its configured name.
 * @param header - The raw header string (e.g., "CH1 Temperatur").
 * @param cfg - The channels configuration.
 * @returns A user-friendly label (e.g., "Living Room Temperatur").
 * @private
 */
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

/**
 * Gets the configured name for a channel key.
 * @param key - The channel key (e.g., 'ch1').
 * @param cfg - The channels configuration.
 * @returns The configured name or the key itself as a fallback.
 * @private
 */
function channelName(key: string, cfg: ChannelsConfig) {
  const c = cfg[key];
  if (!c) return key.toUpperCase();
  return c.name || key.toUpperCase();
}

/**
 * Gets a sorted list of channel keys from the configuration.
 * Provides a default list if the configuration is empty.
 * @param cfg - The channels configuration.
 * @returns A sorted array of channel keys.
 * @private
 */
function getChannelKeys(cfg: ChannelsConfig): string[] {
  const keys = Object.keys(cfg);
  if (keys.length) return keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return ["ch1","ch2","ch3","ch4","ch5","ch6","ch7","ch8"];
}

/**
 * Finds the correct header key for a given metric and channel number in the 'allsensors' dataset.
 * It handles synonyms for metric names.
 * @param header - The array of header strings from the data.
 * @param metric - The metric to find (e.g., "Temperatur").
 * @param chNum - The channel number as a string (e.g., "1").
 * @returns The matching header key, or a fallback.
 * @private
 */
function headerKeyForAllsensors(header: string[], metric: string, chNum: string): string {
  // Prefer CHx <metric>
  const synonyms: Record<string, string[]> = {
    Temperatur: ["Temperature", "Temperatur"],
    Luftfeuchtigkeit: ["Luftfeuchtigkeit"],
    Taupunkt: ["Taupunkt"],
    "Gefühlte Temperatur": ["Wärmeindex", "Gefühlte Temperatur"],
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

/**
 * Infers which columns in a dataset are numeric based on a sample of rows.
 * @param data - The dataset to analyze.
 * @returns An array of header strings that are determined to be numeric.
 * @private
 */
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

/**
 * Returns the appropriate unit for a given channel metric.
 * @param metric - The channel metric.
 * @returns The unit string (e.g., "°C", "%").
 * @private
 */
function unitForMetric(metric: ChannelMetric): string {
  switch (metric) {
    case "Temperatur":
    case "Taupunkt":
    case "Gefühlte Temperatur":
      return "°C";
    case "Luftfeuchtigkeit":
      return "%";
    default:
      return "";
  }
}

/**
 * Infers the measurement unit from a header string.
 * @param header - The header string (e.g., "Temperatur Aussen").
 * @returns The inferred unit string (e.g., "°C", "mm", "km/h").
 * @private
 */
function unitForHeader(header: string): string {
  const s = header.toLowerCase();
  // Rain
  if (s.includes("rain") || s.includes("regen")) {
    if (s.includes("rate") || s.includes("/h") || s.includes("per hour")) return "mm/h";
    return "mm";
  }
  // Temperature family
  if (s.includes("temp") || s.includes("temperatur") || s.includes("taupunkt") || s.includes("dew") || s.includes("wärme") || s.includes("heat index")) return "°C";
  // Humidity
  if (s.includes("humidity") || s.includes("luftfeuchtigkeit") || /\bhum\b/.test(s)) return "%";
  // Pressure
  if (s.includes("druck") || s.includes("pressure") || s.includes("baro")) return "hPa";
  // Wind
  if (s.includes("wind direction") || s.includes("windrichtung") || s.includes("direction")) return "°";
  if (s.includes("wind") || s.includes("gust") || s.includes("böe") || s.includes("b\u00f6e")) return "km/h";
  // Solar/Light
  if (s.includes("uv")) return "";
  if (s.includes("solar") || s.includes("radiation")) return "W/m²";
  if (s.includes("lux")) return "lux";
  // Air quality
  if (s.includes("pm2.5") || s.includes("pm10") || s.includes("pm1")) return "µg/m³";
  if (s.includes("co2")) return "ppm";
  // Soil/Leaf
  if (s.includes("soil") && s.includes("moist")) return "%";
  if (s.includes("soil") && (s.includes("temp") || s.includes("temperatur"))) return "°C";
  return "";
}

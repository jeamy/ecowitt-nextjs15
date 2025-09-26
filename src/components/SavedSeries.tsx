"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { API_ENDPOINTS } from "@/constants";
import LineChart, { type LineSeries } from "@/components/LineChartChartJS";

function pad2(n: number) { return n < 10 ? `0${n}` : String(n); }
function toISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}
function parseTs(s: string): Date | null {
  const d = new Date(s.replace(" ", "T"));
  return Number.isFinite(d.getTime()) ? d : null;
}
function makeTickFormatter(xBase: number, locale: string) {
  return (v: number) => {
    const d = new Date(xBase + Math.round(v) * 60000);
    try {
      return new Intl.DateTimeFormat(locale || 'de', { day: '2-digit', month: '2-digit' }).format(d);
    } catch { return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}.`; }
  };
}
function makeHoverFormatter(xBase: number, locale: string) {
  return (v: number) => {
    const d = new Date(xBase + Math.round(v) * 60000);
    try {
      return new Intl.DateTimeFormat(locale || 'de', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
    } catch {
      return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    }
  };
}

export default function SavedSeries() {
  const { t, i18n } = useTranslation();
  const [preset, setPreset] = useState<'24h'|'7d'|'30d'>('7d');
  const [resolution, setResolution] = useState<'hour'|'day'>('day');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[] | null>(null);
  const [stats, setStats] = useState<Record<string, { min: number|null; max: number|null; avg: number|null; sum: number|null }> | null>(null);
  type ChannelsConfig = Record<string, { name: string }>;
  const [channelsCfg, setChannelsCfg] = useState<ChannelsConfig>({});
  const [selectedCh, setSelectedCh] = useState<string[]>([]);
  const fieldsBase = useMemo(() => ["temp_outdoor","humidity_outdoor","wind","gust","rain_daily","pressure_rel","solar","uv"], []);
  const activeFields = useMemo(() => {
    const extra: string[] = [];
    for (const ch of selectedCh) {
      const num = ch.replace(/\D+/g, "");
      if (!num) continue;
      extra.push(`temp_ch${num}`, `humidity_ch${num}`);
    }
    return [...fieldsBase, ...extra];
  }, [fieldsBase, selectedCh]);

  const { start, end } = useMemo(() => {
    const now = new Date();
    if (preset === '24h') return { start: new Date(now.getTime() - 24*60*60*1000), end: now };
    if (preset === '7d') return { start: new Date(now.getTime() - 7*24*60*60*1000), end: now };
    return { start: new Date(now.getTime() - 30*24*60*60*1000), end: now };
  }, [preset]);

  // Load channel config
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(API_ENDPOINTS.CONFIG_CHANNELS);
        if (!res.ok) return;
        const cfg = await res.json();
        if (!cancelled && cfg && typeof cfg === 'object') setChannelsCfg(cfg);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setData(null);
        setStats(null);
        const url = `${API_ENDPOINTS.SERIES}?start=${encodeURIComponent(toISO(start))}&end=${encodeURIComponent(toISO(end))}&resolution=${resolution}&fields=${encodeURIComponent(activeFields.join(','))}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json?.ok) throw new Error(String(json?.error || 'bad response'));
        if (!cancelled) setData(Array.isArray(json.points) ? json.points : []);
        // Range stats
        const urlStats = `${API_ENDPOINTS.SERIES_RANGE_STATS}?start=${encodeURIComponent(toISO(start))}&end=${encodeURIComponent(toISO(end))}&fields=${encodeURIComponent(activeFields.join(','))}`;
        const resStats = await fetch(urlStats);
        if (resStats.ok) {
          const js = await resStats.json();
          if (!cancelled && js?.ok) setStats(js.stats || {});
        }
      } catch (e) {
        if (!cancelled) { setData([]); setStats({}); }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [start.getTime(), end.getTime(), resolution, activeFields.join(',')]);

  const xBase = useMemo(() => start.getTime(), [start]);
  const fmt = useMemo(() => makeTickFormatter(xBase, i18n.language || 'de'), [xBase, i18n.language]);
  const hoverFmt = useMemo(() => makeHoverFormatter(xBase, i18n.language || 'de'), [xBase, i18n.language]);

  const buildSeries = (key: string, label: string, color: string): LineSeries | null => {
    const rows = data || [];
    const points = rows.map((r: any) => {
      const d = parseTs(r.t);
      const y = Number(r[key]);
      if (!d || !Number.isFinite(y)) return { x: NaN, y: NaN };
      return { x: Math.round((d.getTime() - xBase) / 60000), y };
    }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (!points.length) return null;
    return { id: label, color, points };
  };

  const charts = useMemo(() => {
    const out: React.ReactNode[] = [];
    const temp = buildSeries("temp_outdoor", `${t('fields.temperature')} (°C)`, "#ef4444");
    if (temp) out.push(
      <div key="temp" className="stat-card">
        <LineChart series={[temp]} yLabel={`${t('fields.temperature')} (°C)`} xLabel={t('dashboard.time')} xTickFormatter={fmt} hoverTimeFormatter={hoverFmt} yUnit="°C" />
      </div>
    );
    const hum = buildSeries("humidity_outdoor", t('fields.humidity'), "#0ea5e9");
    if (hum) out.push(
      <div key="hum" className="stat-card">
        <LineChart series={[hum]} yLabel={t('fields.humidity')} xLabel={t('dashboard.time')} xTickFormatter={fmt} hoverTimeFormatter={hoverFmt} yUnit="%" />
      </div>
    );
    const wind = buildSeries("wind", t('gauges.wind'), "#16a34a");
    const gust = buildSeries("gust", t('gauges.gust'), "#a855f7");
    if (wind || gust) out.push(
      <div key="wind" className="stat-card">
        <LineChart series={[...(wind? [wind]: []), ...(gust? [gust]: [])]} yLabel={t('statistics.wind', 'Wind')} xLabel={t('dashboard.time')} xTickFormatter={fmt} hoverTimeFormatter={hoverFmt} yUnit="km/h" />
      </div>
    );
    const rain = buildSeries("rain_daily", t('gauges.precipitation'), "#3b82f6");
    if (rain) out.push(
      <div key="rain" className="stat-card">
        <LineChart series={[rain]} yLabel={t('gauges.precipitation')} xLabel={t('dashboard.time')} xTickFormatter={fmt} hoverTimeFormatter={hoverFmt} yUnit="mm" />
      </div>
    );

    // Per-channel charts (temperature and humidity)
    for (const ch of selectedCh) {
      const num = ch.replace(/\D+/g, "");
      if (!num) continue;
      const sTemp = buildSeries(`temp_ch${num}`, `${t('fields.temperature')} CH${num}`, "#dc2626");
      const sHum = buildSeries(`humidity_ch${num}`, `${t('fields.humidity')} CH${num}`, "#2563eb");
      if (sTemp) out.push(
        <div key={`ch${num}-temp`} className="stat-card">
          <LineChart series={[sTemp]} yLabel={`${t('fields.temperature')} (°C)`} xLabel={t('dashboard.time')} xTickFormatter={fmt} hoverTimeFormatter={hoverFmt} yUnit="°C" />
        </div>
      );
      if (sHum) out.push(
        <div key={`ch${num}-hum`} className="stat-card">
          <LineChart series={[sHum]} yLabel={t('fields.humidity')} xLabel={t('dashboard.time')} xTickFormatter={fmt} hoverTimeFormatter={hoverFmt} yUnit="%" />
        </div>
      );
    }
    return out;
  }, [data, fmt, hoverFmt, t, selectedCh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">{t('dashboard.view')}</label>
        <select className="border rounded px-2 py-1 text-sm" value={preset} onChange={(e) => setPreset(e.target.value as any)}>
          <option value="24h">24h</option>
          <option value="7d">7d</option>
          <option value="30d">30d</option>
        </select>
        <label className="text-sm">{t('dashboard.resolution')}</label>
        <select className="border rounded px-2 py-1 text-sm" value={resolution} onChange={(e) => setResolution(e.target.value as any)}>
          <option value="hour">{t('gauges.hourly')}</option>
          <option value="day">{t('gauges.daily')}</option>
        </select>
        {/* Channel selection */}
        {!!channelsCfg && (
          <div className="flex flex-wrap items-center gap-2 ml-2">
            <span className="text-sm font-medium">CH</span>
            {Object.keys(channelsCfg).map((key) => (
              <label key={key} className="text-xs inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  className="accent-emerald-600"
                  checked={selectedCh.includes(key)}
                  onChange={(e) => setSelectedCh((prev) => e.target.checked ? [...prev, key] : prev.filter(k => k !== key))}
                />
                <span>{key.toUpperCase().replace('CH','CH')}{channelsCfg[key]?.name ? ` – ${channelsCfg[key].name}` : ''}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      {/* KPIs */}
      {loading && (
        <div className="stat-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={`kpi-${i}`} className="stat-card">
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" />
            </div>
          ))}
        </div>
      )}
      {!loading && stats && (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="kpi-label">{t('dashboard.highestTemperature')}</div>
            <div className="kpi-value">{stats.temp_outdoor?.max != null ? `${stats.temp_outdoor.max.toFixed(1)} °C` : '–'}</div>
            <div className="kpi-sub">{t('statistics.temperature','Temperature')}</div>
          </div>
          <div className="stat-card">
            <div className="kpi-label">{t('dashboard.lowestTemperature')}</div>
            <div className="kpi-value">{stats.temp_outdoor?.min != null ? `${stats.temp_outdoor.min.toFixed(1)} °C` : '–'}</div>
            <div className="kpi-sub">{t('statistics.temperature','Temperature')}</div>
          </div>
          <div className="stat-card">
            <div className="kpi-label">{t('dashboard.average')}</div>
            <div className="kpi-value">{stats.temp_outdoor?.avg != null ? `${stats.temp_outdoor.avg.toFixed(1)} °C` : '–'}</div>
            <div className="kpi-sub">{t('statistics.temperature','Temperature')}</div>
          </div>
          <div className="stat-card">
            <div className="kpi-label">{t('dashboard.total')}</div>
            <div className="kpi-value">{stats.rain_daily?.sum != null ? `${stats.rain_daily.sum.toFixed(1)} mm` : '–'}</div>
            <div className="kpi-sub">{t('statistics.precipitation','Precipitation')}</div>
          </div>
          <div className="stat-card">
            <div className="kpi-label">{t('dashboard.highestWind')}</div>
            <div className="kpi-value">{stats.wind?.max != null ? `${stats.wind.max.toFixed(1)} km/h` : '–'}</div>
            <div className="kpi-sub">{t('statistics.wind','Wind')}</div>
          </div>
          <div className="stat-card">
            <div className="kpi-label">{t('dashboard.highestGust')}</div>
            <div className="kpi-value">{stats.gust?.max != null ? `${stats.gust.max.toFixed(1)} km/h` : '–'}</div>
            <div className="kpi-sub">{t('statistics.wind','Wind')}</div>
          </div>
        </div>
      )}
      {loading && (
        <div className="stat-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="stat-card">
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-block" />
              <div className="skeleton skeleton-block" />
            </div>
          ))}
        </div>
      )}
      {!loading && (
        <div className="stat-grid">
          {charts.length ? charts : <div className="text-sm text-gray-500">{t('statuses.noNumeric')}</div>}
        </div>
      )}
    </div>
  );
}

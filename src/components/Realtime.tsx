"use client";

import React, { useEffect, useMemo, useState } from "react";
import { computeAstro, formatTime } from "@/lib/astro";
import { API_ENDPOINTS } from "@/constants";
import { useRealtime } from "@/contexts/RealtimeContext";

import { useTranslation } from "react-i18next";

type RTData = any;

/**
 * A simple component to display a label and a value side-by-side.
 * @param props - The component props.
 * @param props.label - The label to display.
 * @param props.value - The value to display.
 * @returns A React component with a label and value.
 * @private
 */
function LabelValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-gray-600 dark:text-gray-300">{label}</span>
      <span className="font-medium text-gray-900 dark:text-gray-100">{value ?? "—"}</span>
    </div>
  );
}

/**
 * A component to display a temperature value along with its daily min/max values.
 * @param props - The component props.
 * @returns A React component for displaying temperature with min/max data.
 * @private
 */
function TemperatureLabelValue({ 
  label, 
  currentTemp, 
  minMax, 
  field, 
  unit = "°C", 
  t 
}: { 
  label: string; 
  currentTemp: { value: string | number | null; unit?: string }; 
  minMax: any; 
  field: string; 
  unit?: string;
  t: (key: string) => string;
}) {
  const sensorData = minMax?.sensors?.[field];
  
  const formatMinMax = (value: number, time: string, label: string, isMax: boolean) => {
    const timeStr = time ? new Date(time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
    const colorClass = isMax ? 'text-red-600' : 'text-blue-600';
    return (
      <div className={`flex justify-between text-sm ${colorClass}`}>
        <span>{label} {timeStr} Uhr</span>
        <span>{value.toFixed(1)}{unit}</span>
      </div>
    );
  };

  return (
    <div className="py-1">
      <div className="flex items-start justify-between">
        <div className="flex flex-col w-full">
          <div className="flex justify-between items-center">
            <span className="text-gray-600 dark:text-gray-300 text-sm">{label}</span>
            <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{(Number(currentTemp.value) || 0).toFixed(1)}{unit}</span>
          </div>
          {minMax && sensorData && (
            <div className="mt-1 space-y-0.5">
              {sensorData?.min != null && formatMinMax(sensorData.min, sensorData.minTime, 'Min', false)}
              {sensorData?.max != null && formatMinMax(sensorData.max, sensorData.maxTime, 'Max', true)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A component to display a humidity value along with its daily min/max values.
 * @param props - The component props.
 * @returns A React component for displaying humidity with min/max data.
 * @private
 */
function HumidityLabelValue({ 
  label, 
  currentHumidity, 
  minMax, 
  field, 
  unit = "%", 
  t 
}: { 
  label: string; 
  currentHumidity: { value: string | number | null; unit?: string }; 
  minMax: any; 
  field: string; 
  unit?: string;
  t: (key: string) => string;
}) {
  const sensorData = minMax?.humidity?.[field];
  
  const formatMinMax = (value: number, time: string, label: string, isMax: boolean) => {
    const timeStr = time ? new Date(time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
    const colorClass = isMax ? 'text-red-600' : 'text-blue-600';
    return (
      <div className={`flex justify-between text-sm ${colorClass}`}>
        <span>{label} {timeStr} Uhr</span>
        <span>{value.toFixed(1)}{unit}</span>
      </div>
    );
  };

  return (
    <div className="py-1">
      <div className="flex items-start justify-between">
        <div className="flex flex-col w-full">
          <div className="flex justify-between items-center">
            <span className="text-gray-600 dark:text-gray-300 text-sm">{label}</span>
            <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{(Number(currentHumidity.value) || 0).toFixed(1)}{unit}</span>
          </div>
          {minMax && sensorData && (
            <div className="mt-1 space-y-0.5">
              {sensorData?.min != null && formatMinMax(sensorData.min, sensorData.minTime, 'Min', false)}
              {sensorData?.max != null && formatMinMax(sensorData.max, sensorData.maxTime, 'Max', true)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Displays the current value of a sensor along with its daily minimum and maximum.
 * @param props - The component props.
 * @returns A React component showing the current value and min/max stats.
 * @private
 */
function MinMaxDisplay({ 
  current, 
  minMax, 
  field, 
  unit = "°C", 
  t 
}: { 
  current: { value: string | number | null; unit?: string }; 
  minMax: any; 
  field: string; 
  unit?: string;
  t: (key: string) => string;
}) {
  if (!minMax || current.value == null) return <span className="font-medium text-gray-900 dark:text-gray-100">{fmtVU(current, unit)}</span>;
  
  // The API returns data in format: { sensors: { sensorKey: { min, max, minTime, maxTime } } }
  const sensorData = minMax.sensors?.[field];
  const today = new Date().toLocaleDateString('de-DE');
  
  const formatMinMax = (value: number, time: string, label: string, isMax: boolean) => {
    const timeStr = time ? new Date(time).toLocaleTimeString('de-DE') : '';
    const colorClass = isMax ? 'text-red-600' : 'text-blue-600';
    return (
      <div className={`text-sm ${colorClass}`}>
        {label} {timeStr}: {value.toFixed(1)} {unit}
      </div>
    );
  };
  
  return (
    <div>
      <div className="font-medium text-gray-900 dark:text-gray-100 mb-1">{fmtVU(current, unit)}</div>
      <div className="text-sm text-gray-500 mb-1">{today}</div>
      {sensorData?.min != null && formatMinMax(sensorData.min, sensorData.minTime, 'Min', false)}
      {sensorData?.max != null && formatMinMax(sensorData.max, sensorData.maxTime, 'Max', true)}
    </div>
  );
}

/**
 * Safely reads a nested property from an object.
 * @param obj - The object to read from.
 * @param path - The dot-separated path to the property.
 * @returns The property value, or undefined if not found.
 * @private
 */
function tryRead(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => (acc && key in acc ? acc[key] : undefined), obj);
}

/**
 * Safely extracts a numeric value from various possible data structures.
 * @param v - The value to parse.
 * @returns The numeric value, or null if parsing fails.
 * @private
 */
function numVal(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return isNaN(Number(v)) ? null : Number(v);
  if (typeof v === "object" && v) {
    const x = (v as any).value;
    if (x == null) return null;
    if (typeof x === "number") return Number.isFinite(x) ? x : null;
    if (typeof x === "string") return isNaN(Number(x)) ? null : Number(x);
  }
  return null;
}

/**
 * Calculates the dew point.
 * @param temperature - The temperature in Celsius.
 * @param humidity - The relative humidity in percent.
 * @returns The calculated dew point in Celsius.
 * @private
 */
function calculateDewPoint(temperature: number, humidity: number): number {
  // Magnus-Formel für Taupunktberechnung
  const a = 17.27;
  const b = 237.7;
  
  const alpha = ((a * temperature) / (b + temperature)) + Math.log(humidity / 100.0);
  const dewPoint = (b * alpha) / (a - alpha);
  
  return Number.isFinite(dewPoint) ? Math.round(dewPoint * 10) / 10 : temperature;
}

/**
 * Calculates the heat index (apparent temperature).
 * @param temperature - The temperature in Celsius.
 * @param humidity - The relative humidity in percent.
 * @returns The calculated heat index in Celsius.
 * @private
 */
function calculateHeatIndex(temperature: number, humidity: number): number {
  // Vereinfachte Formel für den Wärmeindex (Heat Index)
  if (temperature < 20) {
    // Bei niedrigen Temperaturen ist der Wärmeindex gleich der Temperatur
    return temperature;
  }
  
  // Standardformel für Wärmeindex
  const t = temperature;
  const rh = humidity;
  
  // Koeffizienten für die Rothfusz-Gleichung
  const c1 = -8.78469475556;
  const c2 = 1.61139411;
  const c3 = 2.33854883889;
  const c4 = -0.14611605;
  const c5 = -0.012308094;
  const c6 = -0.0164248277778;
  const c7 = 0.002211732;
  const c8 = 0.00072546;
  const c9 = -0.000003582;
  
  const heatIndex = c1 + (c2 * t) + (c3 * rh) + (c4 * t * rh) + (c5 * t * t) +
                   (c6 * rh * rh) + (c7 * t * t * rh) + (c8 * t * rh * rh) + (c9 * t * t * rh * rh);
  
  return Number.isFinite(heatIndex) ? Math.round(heatIndex * 10) / 10 : temperature;
}

/**
 * Extracts a value and its unit from a potential value-unit object.
 * @param v - The value object.
 * @returns An object containing the value and an optional unit.
 * @private
 */
function valueAndUnit(v: any): { value: string | number | null; unit?: string } {
  if (v == null) return { value: null };
  if (typeof v === "object" && ("value" in v)) {
    return { value: (v as any).value, unit: (v as any).unit };
  }
  return { value: v };
}

/**
 * Formats a value-unit object into a display string.
 * @param vu - The value-unit object.
 * @param fallbackUnit - A fallback unit to use if the object doesn't specify one.
 * @returns A formatted string like "10 °C" or "—" if the value is null.
 * @private
 */
function fmtVU(vu: { value: string | number | null; unit?: string }, fallbackUnit?: string) {
  if (vu.value == null || vu.value === "") return "—";
  const unit = vu.unit ?? fallbackUnit ?? "";
  return `${vu.value}${unit ? ` ${unit}` : ""}`;
}

/**
 * Formats a battery status value into a localized string ("OK" or "Low").
 * @param v - The battery status value.
 * @param t - The translation function.
 * @returns The localized battery status.
 * @private
 */
function fmtBattery(v: any, t: (key: string) => string) {
  const vu = valueAndUnit(v);
  if (vu.value == null || vu.value === "") return "—";
  const n = Number(vu.value);
  if (Number.isNaN(n)) return String(vu.value);
  return n === 0 ? t('statuses.ok') : t('statuses.low');
}

/**
 * Gets a translated, human-readable label for a given data key.
 * @param key - The data key (e.g., "wind_speed").
 * @param t - The translation function.
 * @returns The internationalized label.
 * @private
 */
function i18nLabel(key: string, t: (key: string) => string): string {
  const k = key.toLowerCase();
  const map: Record<string, string> = {
    temperature: t('fields.temperature'),
    humidity: t('fields.humidity'),
    feels_like: t('fields.feelsLike'),
    app_temp: t('fields.appTemp'),
    dew_point: t('fields.dewPoint'),
    wind_speed: t('gauges.wind'),
    wind_gust: t('gauges.gust'),
    wind_direction: t('fields.direction'),
    "10_minute_average_wind_direction": t('fields.direction10min'),
    rain_rate: t('fields.rainRate'),
    solar: t('gauges.solar'),
    uvi: t('gauges.uvIndex'),
  };
  return map[k] || key.replace(/_/g, " ");
}

/**
 * The main component for displaying real-time weather data in a list format.
 * It fetches and displays current conditions, sensor data, astronomical information,
 * and battery statuses.
 *
 * @returns A React component that renders the real-time data view.
 */
export default function Realtime() {
  const { t, i18n } = useTranslation();
  const { data, error, loading, lastUpdated } = useRealtime();
  const [channels, setChannels] = useState<Record<string, { name?: string }>>({});
  const [deviceInfo, setDeviceInfo] = useState<{ timezone: string | null; latitude: number | null; longitude: number | null } | null>(null);
  const [astro, setAstro] = useState<ReturnType<typeof computeAstro> | null>(null);
  const [tempMinMax, setTempMinMax] = useState<any>(null);


  // Load channel display names
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(API_ENDPOINTS.CONFIG_CHANNELS, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        setChannels(json || {});
      } catch {}
    })();
  }, []);

  // Load device info (timezone, lat, lon) and compute astronomy
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(API_ENDPOINTS.DEVICE_INFO, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (json && json.ok) {
          const info = { timezone: json.timezone || null, latitude: json.latitude ?? null, longitude: json.longitude ?? null };
          setDeviceInfo(info);
          if (info.latitude != null && info.longitude != null) {
            setAstro(computeAstro(info.latitude, info.longitude, new Date(), i18n.language));
          }
        }
      } catch {}
    })();
  }, [i18n.language]);

  // Load today's temperature min/max data
  useEffect(() => {
    const fetchTempMinMax = async () => {
      try {
        // Force update all temperatures first
        await fetch(API_ENDPOINTS.TEMP_MINMAX_UPDATE, { method: "POST", cache: "no-store" });
        // Then get the updated data
        const res = await fetch(API_ENDPOINTS.TEMP_MINMAX, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (json && json.ok) {
          setTempMinMax(json.data);
        }
      } catch {}
    };
    
    fetchTempMinMax();
    // Refresh min/max data every 5 minutes
    const id = setInterval(fetchTempMinMax, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const timeText = useMemo(() => {
    if (!lastUpdated) return "—";
    try {
      return new Intl.DateTimeFormat(i18n.language || 'de', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(lastUpdated);
    } catch {
      const d = lastUpdated;
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `${dd}.${mm}.${yyyy} ${hh}:${mi}:${ss}`;
    }
  }, [lastUpdated, i18n.language]);

  const d = data as any;
  const payload = d; // cached payload already unwrapped

  const indoorT = valueAndUnit(tryRead(payload, "indoor.temperature"));
  const indoorH = valueAndUnit(tryRead(payload, "indoor.humidity"));
  const outdoorT = valueAndUnit(tryRead(payload, "outdoor.temperature"));
  const outdoorH = valueAndUnit(tryRead(payload, "outdoor.humidity"));
  const feelsLike = valueAndUnit(tryRead(payload, "outdoor.feels_like"));
  const appTemp = valueAndUnit(tryRead(payload, "outdoor.app_temp"));
  const dewPoint = valueAndUnit(tryRead(payload, "outdoor.dew_point"));
  // Pressure (relative/absolute)
  const pressureRel = valueAndUnit(tryRead(payload, "pressure.relative") ?? tryRead(payload, "barometer.relative") ?? tryRead(payload, "barometer.rel"));
  const pressureAbs = valueAndUnit(tryRead(payload, "pressure.absolute") ?? tryRead(payload, "barometer.absolute") ?? tryRead(payload, "barometer.abs"));
  // Wind
  const wind = valueAndUnit(tryRead(payload, "wind.wind_speed") ?? tryRead(payload, "wind_speed"));
  const gust = valueAndUnit(tryRead(payload, "wind.wind_gust") ?? tryRead(payload, "wind_gust"));
  const windDir = valueAndUnit(tryRead(payload, "wind.wind_direction") ?? tryRead(payload, "wind_direction"));
  const windDir10 = valueAndUnit(tryRead(payload, "wind.10_minute_average_wind_direction"));
  // Rainfall
  const rainRate = valueAndUnit(tryRead(payload, "rainfall.rain_rate") ?? tryRead(payload, "rain.rate"));
  const rainDaily = valueAndUnit(tryRead(payload, "rainfall.daily"));
  const rainHourly = valueAndUnit(tryRead(payload, "rainfall.hourly"));
  const rainWeekly = valueAndUnit(tryRead(payload, "rainfall.weekly"));
  const rainMonthly = valueAndUnit(tryRead(payload, "rainfall.monthly"));
  const rainYearly = valueAndUnit(tryRead(payload, "rainfall.yearly"));
  // Solar & UV
  const solar = valueAndUnit(tryRead(payload, "solar_and_uvi.solar"));
  const uvi = valueAndUnit(tryRead(payload, "solar_and_uvi.uvi"));

  // Detect channel sensor groups (e.g., ch1..ch8 or temp_and_humidity_ch1..ch8)
  const channelKeys = useMemo(() => {
    if (!payload || typeof payload !== "object") return [] as string[];
    return Object.keys(payload)
      .filter((k) => /^ch\d+$/i.test(k) || /_ch\d+$/i.test(k))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [payload]);

  // Astronomy derived visuals for Realtime (auto-updates with RT refresh interval)
  const tz = deviceInfo?.timezone ?? undefined;
  const sunrise = astro?.sunrise ?? null;
  const sunset = astro?.sunset ?? null;
  const sunUp = !!(sunrise && sunset && new Date() >= sunrise && new Date() < sunset);
  const moonIllumPct = astro?.illumination != null ? astro.illumination * 100 : null;
  const moonEmoji = (phase: number | undefined): string => {
    if (phase == null) return "🌙";
    const idx = Math.round((((phase % 1) + 1) % 1) * 7);
    const emojis = ["🌑","🌒","🌓","🌔","🌕","🌖","🌗","🌘"];
    return emojis[idx] ?? "🌙";
  };

  function channelDisplayName(key: string) {
    const m = key.match(/(?:^ch|_ch)(\d+)$/i);
    const id = m ? `ch${m[1]}`.toLowerCase() : key.toLowerCase();
    const name = channels?.[id]?.name;
    if (name) return `${name} (${id.toUpperCase()})`;
    return key.replace(/^temp_and_humidity_/i, "").toUpperCase();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600 dark:text-gray-400">{t('statuses.lastUpdate')} {timeText}</div>
        {loading && <div className="text-xs text-amber-600">{t('statuses.loading')}</div>}
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-emerald-700">{t('realtime.indoor')}</div>
          <TemperatureLabelValue 
            label={t('fields.temperature')} 
            currentTemp={indoorT}
            minMax={tempMinMax}
            field="indoor"
            t={t}
          />
          <HumidityLabelValue 
            label={t('fields.humidity')} 
            currentHumidity={indoorH}
            minMax={tempMinMax}
            field="indoor"
            t={t}
          />
          <LabelValue label={t('gauges.pressureRel')} value={fmtVU(pressureRel, "hPa")} />
          <LabelValue label={t('gauges.pressureAbs')} value={fmtVU(pressureAbs, "hPa")} />
        </div>
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-sky-700">{t('realtime.outdoor')}</div>
          <TemperatureLabelValue 
            label={t('fields.temperature')} 
            currentTemp={outdoorT}
            minMax={tempMinMax}
            field="outdoor"
            t={t}
          />
          <HumidityLabelValue 
            label={t('fields.humidity')} 
            currentHumidity={outdoorH}
            minMax={tempMinMax}
            field="outdoor"
            t={t}
          />
          <LabelValue label={t('fields.feelsLike')} value={fmtVU(feelsLike, "°C")} />
          <LabelValue label={t('fields.appTemp')} value={fmtVU(appTemp, "°C")} />
          <LabelValue label={t('fields.dewPoint')} value={fmtVU(dewPoint, "°C")} />
          <LabelValue label={t('gauges.wind')} value={fmtVU(wind)} />
          <LabelValue label={t('gauges.gust')} value={fmtVU(gust)} />
          <LabelValue label={t('fields.direction')} value={fmtVU(windDir, "º")} />
          <LabelValue label={t('fields.direction10min')} value={fmtVU(windDir10, "º")} />
          <LabelValue label={t('fields.rainRate')} value={fmtVU(rainRate)} />
        </div>
      </div>

      {/* Solar/UV and Precipitation stay here above Sun & Moon */}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-amber-700">{t('realtime.solarUv')}</div>
          <LabelValue label={t('gauges.solar')} value={fmtVU(solar, "W/m²")} />
          <LabelValue label={t('gauges.uvIndex')} value={fmtVU(uvi)} />
        </div>
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-blue-700">{t('gauges.precipitation')}</div>
          <LabelValue label={t('gauges.rate')} value={fmtVU(rainRate)} />
          <LabelValue label={t('gauges.hourly')} value={fmtVU(rainHourly, "mm")} />
          <LabelValue label={t('gauges.daily')} value={fmtVU(rainDaily, "mm")} />
          <LabelValue label={t('gauges.weekly')} value={fmtVU(rainWeekly, "mm")} />
          <LabelValue label={t('gauges.monthly')} value={fmtVU(rainMonthly, "mm")} />
          <LabelValue label={t('gauges.yearly')} value={fmtVU(rainYearly, "mm")} />
        </div>
      </div>

      {/* Sun & Moon (text only) – moved below Solar/UV + Precipitation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Sun (text only) */}
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-amber-700">{t('astro.sun')}</div>
          <div className="text-sm text-gray-600 dark:text-gray-300 text-center">
            {t('astro.sunrise')} <span className="font-bold">{formatTime(sunrise, tz, i18n.language)}</span> — <span className="font-bold">{formatTime(sunset, tz, i18n.language)}</span> {t('astro.sunset')}
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 text-center space-y-0.5">
            <div>{t('astro.civilDawn')} <span className="font-bold">{formatTime(astro?.civilDawn ?? null, tz, i18n.language)}</span> — <span className="font-bold">{formatTime(astro?.civilDusk ?? null, tz, i18n.language)}</span> {t('astro.civilDusk')}</div>
            <div>{t('astro.nauticalDawn')} <span className="font-bold">{formatTime(astro?.nauticalDawn ?? null, tz, i18n.language)}</span> — <span className="font-bold">{formatTime(astro?.nauticalDusk ?? null, tz, i18n.language)}</span> {t('astro.nauticalDusk')}</div>
            <div>{t('astro.astronomicalDawn')} <span className="font-bold">{formatTime(astro?.astronomicalDawn ?? null, tz, i18n.language)}</span> — <span className="font-bold">{formatTime(astro?.astronomicalDusk ?? null, tz, i18n.language)}</span> {t('astro.astronomicalDusk')}</div>
          </div>
          <div className="text-xs text-gray-500 mt-1 text-center space-y-0.5">
            {deviceInfo?.timezone && (<div>{t('astro.timezone')}: <span className="font-bold">{deviceInfo.timezone}</span></div>)}
            {deviceInfo?.latitude != null && (<div>{t('astro.latitude')}: <span className="font-bold">{deviceInfo.latitude.toFixed(4)}°</span></div>)}
            {deviceInfo?.longitude != null && (<div>{t('astro.longitude')}: <span className="font-bold">{deviceInfo.longitude.toFixed(4)}°</span></div>)}
          </div>
        </div>
        {/* Moon (text only) */}
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-stone-700">{t('astro.moon')}</div>
          <div className="text-sm text-gray-600 dark:text-gray-300 text-center">
            {t('astro.moonPhase')}: <span className="font-bold">{astro?.phaseName || "—"}{moonIllumPct != null ? ` (${Math.round(moonIllumPct)}%)` : ''}</span>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-300 text-center">
            {t('astro.moonrise')} <span className="font-bold">{formatTime(astro?.moonrise ?? null, tz, i18n.language)}</span> — <span className="font-bold">{formatTime(astro?.moonset ?? null, tz, i18n.language)}</span> {t('astro.moonset')}
          </div>
          <div className="text-xs text-gray-500 mt-1 text-center space-y-0.5">
            {deviceInfo?.timezone && (<div>{t('astro.timezone')}: <span className="font-bold">{deviceInfo.timezone}</span></div>)}
            {deviceInfo?.latitude != null && (<div>{t('astro.latitude')}: <span className="font-bold">{deviceInfo.latitude.toFixed(4)}°</span></div>)}
            {deviceInfo?.longitude != null && (<div>{t('astro.longitude')}: <span className="font-bold">{deviceInfo.longitude.toFixed(4)}°</span></div>)}
          </div>
        </div>
      </div>

      {channelKeys.length > 0 && (
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-purple-700">{t('gauges.channelSensors')}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {channelKeys.map((ck) => {
              const ch = payload[ck] || {};
              const entries = Object.entries(ch) as [string, any][];
              
              // Extrahiere Temperatur und Luftfeuchtigkeit für Berechnungen
              const temp = numVal(ch?.temperature);
              const humidity = numVal(ch?.humidity);
              
              // Prüfe, ob Taupunkt und Wärmeindex bereits vorhanden sind
              let dewPoint = numVal(ch?.dew_point);
              let heatIndex = numVal(ch?.feels_like);
              
              // Berechne fehlende Werte, wenn Temperatur und Luftfeuchtigkeit vorhanden sind
              if (temp !== null && humidity !== null) {
                // Berechne Taupunkt, wenn nicht vorhanden
                if (dewPoint === null) {
                  dewPoint = calculateDewPoint(temp, humidity);
                }
                
                // Berechne Wärmeindex, wenn nicht vorhanden
                if (heatIndex === null) {
                  heatIndex = calculateHeatIndex(temp, humidity);
                }
              }
              
              return (
                <div key={ck} className="rounded border border-gray-100 p-3">
                  <div className="font-medium mb-1">{channelDisplayName(ck)}</div>
                  {entries.length === 0 && <div className="text-xs text-gray-500">{t('statuses.noData')}</div>}
                  {entries.map(([name, val]) => {
                    const vu = valueAndUnit(val);
                    // Show min/max for temperature and humidity fields
                    if (name === 'temperature') {
                      return (
                        <TemperatureLabelValue 
                          key={name} 
                          label={i18nLabel(name, t)} 
                          currentTemp={vu}
                          minMax={tempMinMax}
                          field={ck}
                          t={t}
                        />
                      );
                    }
                    if (name === 'humidity') {
                      return (
                        <HumidityLabelValue 
                          key={name} 
                          label={i18nLabel(name, t)} 
                          currentHumidity={vu}
                          minMax={tempMinMax}
                          field={ck}
                          t={t}
                        />
                      );
                    }
                    return <LabelValue key={name} label={i18nLabel(name, t)} value={fmtVU(vu)} />;
                  })}
                  
                  {/* Zeige berechnete Werte an, wenn vorhanden */}
                  {temp !== null && humidity !== null && (
                    <>
                      {dewPoint !== null && (
                        <LabelValue label={t('fields.dewPoint')} value={`${dewPoint.toFixed(1)} °C`} />
                      )}
                      {heatIndex !== null && (
                        <LabelValue label={t('fields.heatIndex')} value={`${heatIndex.toFixed(1)} °C`} />
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {payload?.battery && typeof payload.battery === "object" && (
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-stone-700">{t('realtime.battery')}</div>
          {Object.entries(payload.battery as Record<string, any>).map(([name, val]) => (
            <LabelValue key={name} label={name} value={fmtBattery(val, t)} />
          ))}
        </div>
      )}

      <details className="rounded border border-gray-200 p-3">
        <summary className="cursor-pointer text-sm text-gray-700">{t('gauges.rawData')}</summary>
        <pre className="mt-2 text-xs overflow-auto max-h-80 bg-gray-50 dark:bg-neutral-900 p-2 rounded">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}

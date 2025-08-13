"use client";

import React, { useEffect, useMemo, useState } from "react";

type RTData = any;

function LabelValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-gray-600 dark:text-gray-300">{label}</span>
      <span className="font-medium text-gray-900 dark:text-gray-100">{value ?? "—"}</span>
    </div>
  );
}

function tryRead(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => (acc && key in acc ? acc[key] : undefined), obj);
}

function valueAndUnit(v: any): { value: string | number | null; unit?: string } {
  if (v == null) return { value: null };
  if (typeof v === "object" && ("value" in v)) {
    return { value: (v as any).value, unit: (v as any).unit };
  }
  return { value: v };
}

function fmtVU(vu: { value: string | number | null; unit?: string }, fallbackUnit?: string) {
  if (vu.value == null || vu.value === "") return "—";
  const unit = vu.unit ?? fallbackUnit ?? "";
  return `${vu.value}${unit ? ` ${unit}` : ""}`;
}

function fmtBattery(v: any) {
  const vu = valueAndUnit(v);
  if (vu.value == null || vu.value === "") return "—";
  const n = Number(vu.value);
  if (Number.isNaN(n)) return String(vu.value);
  return n === 0 ? "OK" : "Niedrig";
}

function deLabel(key: string): string {
  const k = key.toLowerCase();
  const map: Record<string, string> = {
    temperature: "Temperatur",
    humidity: "Feuchte",
    feels_like: "Gefühlt",
    app_temp: "App-Temp",
    dew_point: "Taupunkt",
    wind_speed: "Wind",
    wind_gust: "Böe",
    wind_direction: "Richtung",
    "10_minute_average_wind_direction": "Richtung (10 min)",
    rain_rate: "Regenrate",
    hourly: "Stündlich",
    daily: "Täglich",
    weekly: "Wöchentlich",
    monthly: "Monatlich",
    yearly: "Jährlich",
    relative: "relativ",
    absolute: "absolut",
    solar: "Solar",
    uvi: "UV-Index"
  };
  return map[k] || key.replace(/_/g, " ");
}

export default function Realtime() {
  const [data, setData] = useState<RTData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [channels, setChannels] = useState<Record<string, { name?: string }>>({});

  const fetchNow = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/rt/last", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rec = await res.json();
      if (!rec || rec.ok === false) {
        const msg = rec?.error || "keine Daten";
        setError(msg);
        return;
      }
      setData(rec.data ?? null);
      setLastUpdated(rec.updatedAt ? new Date(rec.updatedAt) : new Date());
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNow();
    const refreshMs = Number(process.env.NEXT_PUBLIC_RT_REFRESH_MS || 300000); // default 5 min
    const id = setInterval(fetchNow, isFinite(refreshMs) && refreshMs > 0 ? refreshMs : 300000);
    return () => clearInterval(id);
  }, []);

  // Load channel display names
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config/channels", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        setChannels(json || {});
      } catch {}
    })();
  }, []);

  const timeText = useMemo(() => {
    if (!lastUpdated) return "—";
    const d = lastUpdated;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${dd}.${mm}.${yyyy} ${hh}:${mi}:${ss}`;
  }, [lastUpdated]);

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

  function channelDisplayName(key: string) {
    const m = key.match(/(?:^ch|_ch)(\d+)$/i);
    const id = m ? `ch${m[1]}`.toLowerCase() : key.toLowerCase();
    const name = channels?.[id]?.name;
    if (name) return `${name} (${id.toUpperCase()})`;
    return key.replace(/^temp_and_humidity_/i, "").toUpperCase();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-start">
        <div className="text-sm text-gray-600 dark:text-gray-400">Letzte Aktualisierung: {timeText}</div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-emerald-700">Innen</div>
          <LabelValue label="Temperatur" value={fmtVU(indoorT, "°C")} />
          <LabelValue label="Feuchte" value={fmtVU(indoorH, "%")} />
          <LabelValue label="Luftdruck (rel.)" value={fmtVU(pressureRel, "hPa")} />
          <LabelValue label="Luftdruck (abs.)" value={fmtVU(pressureAbs, "hPa")} />
        </div>
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-sky-700">Außen</div>
          <LabelValue label="Temperatur" value={fmtVU(outdoorT, "°C")} />
          <LabelValue label="Feuchte" value={fmtVU(outdoorH, "%")} />
          <LabelValue label="Gefühlt" value={fmtVU(feelsLike, "°C")} />
          <LabelValue label="App-Temp" value={fmtVU(appTemp, "°C")} />
          <LabelValue label="Taupunkt" value={fmtVU(dewPoint, "°C")} />
          <LabelValue label="Wind" value={fmtVU(wind)} />
          <LabelValue label="Böe" value={fmtVU(gust)} />
          <LabelValue label="Richtung" value={fmtVU(windDir, "º")} />
          <LabelValue label="Richtung (10 min)" value={fmtVU(windDir10, "º")} />
          <LabelValue label="Regenrate" value={fmtVU(rainRate)} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-amber-700">Solar / UV</div>
          <LabelValue label="Solar" value={fmtVU(solar, "W/m²")} />
          <LabelValue label="UV Index" value={fmtVU(uvi)} />
        </div>
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-blue-700">Niederschlag</div>
          <LabelValue label="Rate" value={fmtVU(rainRate)} />
          <LabelValue label="Stündlich" value={fmtVU(rainHourly, "mm")} />
          <LabelValue label="Täglich" value={fmtVU(rainDaily, "mm")} />
          <LabelValue label="Wöchentlich" value={fmtVU(rainWeekly, "mm")} />
          <LabelValue label="Monatlich" value={fmtVU(rainMonthly, "mm")} />
          <LabelValue label="Jährlich" value={fmtVU(rainYearly, "mm")} />
        </div>
      </div>

      {channelKeys.length > 0 && (
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-purple-700">Kanalsensoren</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {channelKeys.map((ck) => {
              const ch = payload[ck] || {};
              const entries = Object.entries(ch) as [string, any][];
              return (
                <div key={ck} className="rounded border border-gray-100 p-3">
                  <div className="font-medium mb-1">{channelDisplayName(ck)}</div>
                  {entries.length === 0 && <div className="text-xs text-gray-500">Keine Daten</div>}
                  {entries.map(([name, val]) => {
                    const vu = valueAndUnit(val);
                    return <LabelValue key={name} label={deLabel(name)} value={fmtVU(vu)} />;
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {payload?.battery && typeof payload.battery === "object" && (
        <div className="rounded border border-gray-200 p-3">
          <div className="font-semibold mb-2 text-stone-700">Batterie</div>
          {Object.entries(payload.battery as Record<string, any>).map(([name, val]) => (
            <LabelValue key={name} label={name} value={fmtBattery(val)} />
          ))}
        </div>
      )}

      <details className="rounded border border-gray-200 p-3">
        <summary className="cursor-pointer text-sm text-gray-700">Rohdaten</summary>
        <pre className="mt-2 text-xs overflow-auto max-h-80 bg-gray-50 dark:bg-neutral-900 p-2 rounded">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}

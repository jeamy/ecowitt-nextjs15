"use client";

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import Dashboard from "@/components/Dashboard";
import Forecast from "@/components/Forecast";
import ForecastAnalysis from "@/components/ForecastAnalysis";
import Gauges from "@/components/Gauges";
import Realtime from "@/components/Realtime";
import Statistics from "@/components/Statistics";
import ThemeControls from "@/components/ThemeControls";
import { RealtimeProvider, useRealtime } from "@/contexts/RealtimeContext";
import { useTheme } from "@/lib/theme";

type Tab = "rt" | "gfx" | "forecast" | "analysis" | "stored" | "stats";

const TABS: Array<{ id: Tab; icon: string; key: string; fallback: string }> = [
  { id: "rt", icon: "◉", key: "tabs.realtime", fallback: "Realtime" },
  { id: "gfx", icon: "◌", key: "tabs.graphics", fallback: "Graphics" },
  { id: "forecast", icon: "☁", key: "tabs.forecast", fallback: "Forecast" },
  { id: "analysis", icon: "⌁", key: "tabs.analysis", fallback: "Analysis" },
  { id: "stored", icon: "▤", key: "tabs.saved", fallback: "Saved data" },
  { id: "stats", icon: "▥", key: "tabs.statistics", fallback: "Statistics" },
];

function Shell() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("rt");
  const theme = useTheme();
  const { loading, error, lastUpdated } = useRealtime();
  const language = i18n.language?.startsWith("en") ? "en" : "de";
  const status = error
    ? (language === "de" ? "Verbindung gestört" : "Connection issue")
    : loading && !lastUpdated
      ? t("statuses.loading")
      : lastUpdated
        ? `${t("statuses.lastUpdate")} ${new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(lastUpdated)}`
        : (language === "de" ? "Warte auf Messwerte" : "Waiting for readings");

  return (
    <div className="weather-app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-top-row">
            <div className="app-brand">
              <div className="app-brand-mark" aria-hidden="true">⌁</div>
              <div>
                <div className="app-brand-name">Weather Control</div>
                <div className="app-brand-sub">Ecowitt {language === "de" ? "Wetterstation" : "weather station"}</div>
              </div>
            </div>
            <div className={`app-live ${error ? "is-error" : ""}`}>
              <span className="app-live-dot" />
              <span>{status}</span>
            </div>
            <ThemeControls {...theme} />
          </div>
          <div className="app-nav-scroll">
            <nav className="app-nav" role="tablist" aria-label={language === "de" ? "Hauptnavigation" : "Main navigation"}>
              {TABS.map((item) => (
                <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>
                  <span aria-hidden="true">{item.icon}</span>{t(item.key, item.fallback)}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="app-main" role="tabpanel">
        {tab === "rt" && <Realtime />}
        {tab === "gfx" && <Gauges />}
        {tab === "forecast" && <Forecast />}
        {tab === "analysis" && <ForecastAnalysis />}
        {tab === "stored" && <Dashboard />}
        {tab === "stats" && <Statistics />}
      </main>
    </div>
  );
}

export default function Home() {
  return <RealtimeProvider><Shell /></RealtimeProvider>;
}

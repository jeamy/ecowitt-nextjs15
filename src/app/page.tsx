"use client";

import React, { useState } from "react";
import Dashboard from "@/components/Dashboard";
import Realtime from "@/components/Realtime";
import Gauges from "@/components/Gauges";
import Statistics from "@/components/Statistics";
import Forecast from "@/components/Forecast";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { RealtimeProvider } from "@/contexts/RealtimeContext";

/**
 * The main page component for the weather dashboard.
 * It provides a tabbed interface to switch between different views:
 * - Realtime: A list of current sensor readings.
 * - Graphics: A set of gauges and visual displays for current data.
 * - Saved: A dashboard for viewing historical data with charts.
 * - Statistics: Statistical analysis of historical data.
 * - Forecast: 7-day weather forecast from Geosphere API.
 *
 * @returns The Home page component.
 */
export default function Home() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"rt" | "gfx" | "stored" | "stats" | "forecast">("rt");
  return (
    <RealtimeProvider>
      <div className="min-h-screen w-full bg-gray-50 dark:bg-neutral-950 text-gray-900 dark:text-gray-100 p-4 sm:p-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-4 flex items-center gap-2 border-b border-gray-200 dark:border-neutral-800">
            <button
              className={`px-3 py-2 text-sm font-medium rounded-t ${tab === "rt" ? "bg-white dark:bg-neutral-900 border border-b-0 border-gray-200 dark:border-neutral-800" : "text-gray-600 hover:text-gray-900"}`}
              onClick={() => setTab("rt")}
            >
              {t("tabs.realtime")}
            </button>
            <button
              className={`px-3 py-2 text-sm font-medium rounded-t ${tab === "gfx" ? "bg-white dark:bg-neutral-900 border border-b-0 border-gray-200 dark:border-neutral-800" : "text-gray-600 hover:text-gray-900"}`}
              onClick={() => setTab("gfx")}
            >
              {t("tabs.graphics")}
            </button>
            <button
              className={`px-3 py-2 text-sm font-medium rounded-t ${tab === "forecast" ? "bg-white dark:bg-neutral-900 border border-b-0 border-gray-200 dark:border-neutral-800" : "text-gray-600 hover:text-gray-900"}`}
              onClick={() => setTab("forecast")}
            >
              {t("tabs.forecast", "Forecast")}
            </button>
            <button
              className={`px-3 py-2 text-sm font-medium rounded-t ${tab === "stored" ? "bg-white dark:bg-neutral-900 border border-b-0 border-gray-200 dark:border-neutral-800" : "text-gray-600 hover:text-gray-900"}`}
              onClick={() => setTab("stored")}
            >
              {t("tabs.saved")}
            </button>
            <button
              className={`px-3 py-2 text-sm font-medium rounded-t ${tab === "stats" ? "bg-white dark:bg-neutral-900 border border-b-0 border-gray-200 dark:border-neutral-800" : "text-gray-600 hover:text-gray-900"}`}
              onClick={() => setTab("stats")}
            >
              {t("tabs.statistics", "Statistics")}
            </button>
            <LanguageSwitcher />
          </div>

          <div className="rounded-b border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            {tab === "rt" && <Realtime />}
            {tab === "gfx" && <Gauges />}
            {tab === "stored" && <Dashboard />}
            {tab === "stats" && <Statistics />}
            {tab === "forecast" && <Forecast />}
          </div>
        </div>
      </div>
    </RealtimeProvider>
  );
}

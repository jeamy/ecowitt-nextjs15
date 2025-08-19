"use client";

import React, { useState } from "react";
import Dashboard from "@/components/Dashboard";
import Realtime from "@/components/Realtime";
import Gauges from "@/components/Gauges";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function Home() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"rt" | "gfx" | "stored">("rt");
  return (
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
            className={`px-3 py-2 text-sm font-medium rounded-t ${tab === "stored" ? "bg-white dark:bg-neutral-900 border border-b-0 border-gray-200 dark:border-neutral-800" : "text-gray-600 hover:text-gray-900"}`}
            onClick={() => setTab("stored")}
          >
            {t("tabs.saved")}
          </button>
          <LanguageSwitcher />
        </div>

        <div className="rounded-b border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          {tab === "rt" && <Realtime />}
          {tab === "gfx" && <Gauges />}
          {tab === "stored" && <Dashboard />}
        </div>
      </div>
    </div>
  );
}

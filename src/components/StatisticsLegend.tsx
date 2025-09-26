"use client";

import React from "react";
import { useTranslation } from "react-i18next";

export default function StatisticsLegend() {
  const { t } = useTranslation();
  const scale = [
    { label: "< -15°", cls: "bg-temp-neg-15" },
    { label: "< -10°", cls: "bg-temp-neg-10" },
    { label: "< -5°", cls: "bg-temp-neg-5" },
    { label: "< 0°", cls: "bg-temp-0" },
    { label: "> 0°", cls: "bg-temp-5" },
    { label: "> 5°", cls: "bg-temp-10" },
    { label: "> 10°", cls: "bg-temp-15" },
    { label: "> 15°", cls: "bg-temp-20" },
    { label: "> 20°", cls: "bg-temp-25" },
    { label: "> 25°", cls: "bg-temp-30" },
    { label: "> 30°", cls: "bg-temp-35" },
    { label: "> 35°", cls: "bg-temp-40" },
    { label: t("statuses.noData", "Keine Daten"), cls: "bg-temp-none" },
  ];
  return (
    <div className="stat-legend" aria-label={t("statistics.legend.title", "Temperaturfarb-Skala (°C)")}> 
      <div className="title">{t("statistics.legend.title", "Temperaturfarb-Skala (°C)")}</div>
      <div className="scale" aria-hidden>
        {scale.map((it) => (
          <div className="chip" key={it.cls}>
            <span className={`swatch ${it.cls}`} />
            <span>{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

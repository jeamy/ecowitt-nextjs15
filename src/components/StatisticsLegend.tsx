"use client";

import React from "react";
import { useTranslation } from "react-i18next";

export default function StatisticsLegend() {
  const { t } = useTranslation();
  return (
    <div className="stat-legend" aria-label={t("statistics.legend.title", "Temperaturfarb-Skala (°C)")}> 
      <div className="title">{t("statistics.legend.title", "Temperaturfarb-Skala (°C)")}</div>
      <div className="bar" />
      <div className="ticks" aria-hidden>
        <span>−10</span>
        <span>0</span>
        <span>20</span>
        <span>25</span>
        <span>30</span>
      </div>
    </div>
  );
}

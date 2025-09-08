"use client";

import React from "react";
import { useTranslation } from "react-i18next";

/**
 * A component that allows the user to switch between supported languages (DE and EN).
 * It highlights the currently active language and handles the language change logic.
 *
 * @returns A React component with language switching buttons.
 */
export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const cur = i18n.language || "de";
  const setLang = (lng: string) => {
    if (lng !== cur) i18n.changeLanguage(lng);
  };
  const btn = (lng: string, label: string) => (
    <button
      key={lng}
      onClick={() => setLang(lng)}
      className={`px-2 py-1 text-xs rounded border ${cur === lng ? "bg-white dark:bg-neutral-900 border-gray-300 dark:border-neutral-700" : "border-transparent text-gray-600 hover:text-gray-900"}`}
      aria-pressed={cur === lng}
    >
      {label}
    </button>
  );
  return (
    <div className="ml-auto flex items-center gap-1" role="group" aria-label="Language Switcher">
      {btn("de", "DE")}
      {btn("en", "EN")}
    </div>
  );
}

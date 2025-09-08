"use client";

import React, { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  // Initialize language preference from localStorage or browser
  useEffect(() => {
    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem("lang") : null;
      const browser = typeof navigator !== "undefined" ? navigator.language?.split("-")[0] : undefined;
      const lang = saved || browser || "de";
      if (i18n.language !== lang) {
        i18n.changeLanguage(lang).catch(() => {});
      }
      if (typeof document !== "undefined") {
        document.documentElement.lang = lang;
      }
      const onChange = (lng: string) => {
        try {
          window.localStorage.setItem("lang", lng);
        } catch {}
        if (typeof document !== "undefined") {
          document.documentElement.lang = lng;
        }
      };
      i18n.on("languageChanged", onChange);
      return () => {
        i18n.off("languageChanged", onChange);
      };
    } catch {}
  }, []);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

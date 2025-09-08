/**
 * @file This file initializes the i18next library for internationalization.
 * It sets up the German and English language resources and configures the default settings.
 * The i18n instance is initialized only once and can be safely imported in client components.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import de from "@/locales/de/common.json";
import en from "@/locales/en/common.json";

// Initialize once in the client. This module can be imported safely in client components.
if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources: {
        de: { translation: de },
        en: { translation: en },
      },
      lng: "de", // default
      fallbackLng: "de",
      interpolation: { escapeValue: false },
      // Keep react suspense off for simplicity
      react: { useSuspense: false },
    })
    .catch(() => {
      /* noop */
    });
}

export default i18n;

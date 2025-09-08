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

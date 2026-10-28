"use client";

import { useTranslation } from "react-i18next";
import { THEME_PALETTES, type ThemeMode } from "@/lib/theme";

type Props = {
  mode: ThemeMode;
  palette: string;
  changeMode: (mode: ThemeMode) => void;
  changePalette: (palette: string) => void;
};

export default function ThemeControls({ mode, palette, changeMode, changePalette }: Props) {
  const { i18n } = useTranslation();
  const language = i18n.language?.startsWith("en") ? "en" : "de";
  const setLanguage = (next: "de" | "en") => { if (next !== language) void i18n.changeLanguage(next); };

  return (
    <div className="app-theme-controls">
      <div className="app-segmented" role="group" aria-label={language === "de" ? "Sprache" : "Language"}>
        <button type="button" className={language === "de" ? "is-active" : ""} aria-pressed={language === "de"} onClick={() => setLanguage("de")}>DE</button>
        <button type="button" className={language === "en" ? "is-active" : ""} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button>
      </div>
      <div className="app-segmented" role="group" aria-label={language === "de" ? "Darstellung" : "Appearance"}>
        <button type="button" className={mode === "dark" ? "is-active" : ""} aria-pressed={mode === "dark"} onClick={() => changeMode("dark")} title={language === "de" ? "Dunkel" : "Dark"}>☾</button>
        <button type="button" className={mode === "light" ? "is-active" : ""} aria-pressed={mode === "light"} onClick={() => changeMode("light")} title={language === "de" ? "Hell" : "Light"}>☀</button>
      </div>
      <select className="app-palette-select" value={palette} onChange={(event) => changePalette(event.target.value)} aria-label={language === "de" ? "Farbpalette" : "Color palette"}>
        {THEME_PALETTES.map((item) => <option key={item.id} value={item.id}>{item.label[language]}</option>)}
      </select>
    </div>
  );
}


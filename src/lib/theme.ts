"use client";

import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

export type ThemePalette = {
  id: string;
  label: { de: string; en: string };
  dark: { a: string; b: string; c: string };
  light: { a: string; b: string; c: string };
};

export const THEME_PALETTES: ThemePalette[] = [
  { id: "spaces_default", label: { de: "Ecowitt Standard", en: "Ecowitt Standard" }, dark: { a: "#AED83C", b: "#152B35", c: "#5C8EA0" }, light: { a: "#AED83C", b: "#82A8BA", c: "#5C8EA0" } },
  { id: "ocean_pulse", label: { de: "Ozean-Puls", en: "Ocean Pulse" }, dark: { a: "#55A8FF", b: "#1E3531", c: "#8B80F9" }, light: { a: "#55A8FF", b: "#7CC8BE", c: "#8B80F9" } },
  { id: "amber_signal", label: { de: "Bernstein-Signal", en: "Amber Signal" }, dark: { a: "#E4AE34", b: "#091F29", c: "#F06292" }, light: { a: "#E4AE34", b: "#78B2CA", c: "#F06292" } },
  { id: "raspberry_velvet", label: { de: "Himbeer-Samt", en: "Raspberry Velvet" }, dark: { a: "#B24C70", b: "#251F11", c: "#D577A4" }, light: { a: "#9B415F", b: "#B0A180", c: "#C96C96" } },
  { id: "duo_neon", label: { de: "Duo-Neon", en: "Duo Neon" }, dark: { a: "#96E255", b: "#1A270D", c: "#E4529B" }, light: { a: "#96E255", b: "#C5E29A", c: "#E4529B" } },
  { id: "infrared_blueprint", label: { de: "Infrarot-Blueprint", en: "Infrared Blueprint" }, dark: { a: "#FF4E64", b: "#161E3F", c: "#39D6FF" }, light: { a: "#CF344C", b: "#A9B5E8", c: "#188DAE" } },
  { id: "jade_clay", label: { de: "Jade & Ton", en: "Jade Clay" }, dark: { a: "#35CFA2", b: "#2C2118", c: "#D36A3A" }, light: { a: "#238F74", b: "#BFA58E", c: "#B6532E" } },
  { id: "violet_cream", label: { de: "Violett-Creme", en: "Violet Cream" }, dark: { a: "#C084FC", b: "#2B183A", c: "#F4D35E" }, light: { a: "#7E4BC2", b: "#CDB9E8", c: "#C08B16" } },
  { id: "pearl_graphite", label: { de: "Perle & Graphit", en: "Pearl Graphite" }, dark: { a: "#E6E0C8", b: "#20242A", c: "#FF5A36" }, light: { a: "#655F51", b: "#B8BDC5", c: "#D2432A" } },
  { id: "cobalt_saffron", label: { de: "Kobalt & Safran", en: "Cobalt Saffron" }, dark: { a: "#3B67FF", b: "#241B10", c: "#E7C447" }, light: { a: "#254CC9", b: "#C8B58E", c: "#A97912" } },
  { id: "classic_amber", label: { de: "Klassischer Bernstein", en: "Classic Amber" }, dark: { a: "#F0B33A", b: "#2F2A22", c: "#A86B16" }, light: { a: "#B26B00", b: "#D4C7B0", c: "#8C5200" } },
  { id: "jade_mono", label: { de: "Jade-Mono", en: "Jade Mono" }, dark: { a: "#42DCA3", b: "#123247", c: "#2A8A69" }, light: { a: "#138A61", b: "#A9C8D4", c: "#0F6E50" } },
  { id: "cyan_mono", label: { de: "Cyan-Mono", en: "Cyan Mono" }, dark: { a: "#55D6F2", b: "#18264D", c: "#2D94AA" }, light: { a: "#147E96", b: "#AEBCE6", c: "#0E6578" } },
  { id: "violet_mono", label: { de: "Violett-Mono", en: "Violet Mono" }, dark: { a: "#B389FF", b: "#3A1729", c: "#7D5AC7" }, light: { a: "#6E45B8", b: "#D7B6C8", c: "#53308D" } },
];

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ } };

function contrastInk(hex: string): "#101010" | "#FFFFFF" {
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const luminance = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return luminance > 150 ? "#101010" : "#FFFFFF";
}

function applyTheme(mode: ThemeMode, paletteId: string) {
  const palette = THEME_PALETTES.find((item) => item.id === paletteId) ?? THEME_PALETTES[0];
  const colors = palette[mode];
  const root = document.documentElement;
  root.dataset.mode = mode;
  root.dataset.palette = palette.id;
  root.classList.toggle("dark", mode === "dark");
  root.style.setProperty("--color-a", colors.a);
  root.style.setProperty("--color-b", colors.b);
  root.style.setProperty("--color-c", colors.c);
  root.style.setProperty("--accent-ink", contrastInk(colors.a));
  window.dispatchEvent(new Event("ecowitt-theme-change"));
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>("dark");
  const [palette, setPalette] = useState(THEME_PALETTES[0].id);

  useEffect(() => {
    queueMicrotask(() => {
      const savedMode = read("ecowitt.mode");
      const nextMode = savedMode === "dark" || savedMode === "light"
        ? savedMode
        : window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
      const savedPalette = read("ecowitt.palette");
      setMode(nextMode);
      if (savedPalette && THEME_PALETTES.some((item) => item.id === savedPalette)) setPalette(savedPalette);
    });
  }, []);

  useEffect(() => { applyTheme(mode, palette); }, [mode, palette]);

  return {
    mode,
    palette,
    changeMode(next: ThemeMode) { setMode(next); write("ecowitt.mode", next); },
    changePalette(next: string) { setPalette(next); write("ecowitt.palette", next); },
  };
}

import SunCalc from "suncalc";

export type AstroResult = {
  sunrise: Date | null;
  sunset: Date | null;
  moonrise: Date | null;
  moonset: Date | null;
  phase: number; // 0..1
  phaseName: string;
  illumination: number; // 0..1 fraction lit
  // Twilight times
  civilDawn: Date | null;       // Sun -6° below horizon -> start of civil twilight
  civilDusk: Date | null;       // Sun -6° below horizon -> end of civil twilight
  nauticalDawn: Date | null;    // Sun -12° -> start of nautical twilight
  nauticalDusk: Date | null;    // Sun -12° -> end of nautical twilight
  astronomicalDawn: Date | null;// Sun -18° -> start of astronomical twilight (night ends)
  astronomicalDusk: Date | null;// Sun -18° -> end of astronomical twilight (night begins)
};

export function moonPhaseName(phase: number, locale: string = "en"): string {
  // 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter
  const namesEn = [
    "New Moon",
    "Waxing Crescent",
    "First Quarter",
    "Waxing Gibbous",
    "Full Moon",
    "Waning Gibbous",
    "Last Quarter",
    "Waning Crescent"
  ];
  const namesDe = [
    "Neumond",
    "Zunehmende Sichel",
    "Erstes Viertel",
    "Zunehmender Mond",
    "Vollmond",
    "Abnehmender Mond",
    "Letztes Viertel",
    "Abnehmende Sichel"
  ];
  const idx = Math.round(((phase % 1 + 1) % 1) * 7) as 0|1|2|3|4|5|6|7;
  return (locale?.startsWith("de") ? namesDe : namesEn)[idx];
}

export function computeAstro(lat: number, lon: number, date: Date = new Date(), locale: string = "en"): AstroResult {
  const times = SunCalc.getTimes(date, lat, lon);
  const mt = SunCalc.getMoonTimes(date, lat, lon, true /* UTC to avoid host tz issues */);
  const ill = SunCalc.getMoonIllumination(date);
  return {
    sunrise: times.sunrise ?? null,
    sunset: times.sunset ?? null,
    moonrise: mt.rise ?? null,
    moonset: mt.set ?? null,
    phase: ill.phase,
    illumination: ill.fraction,
    phaseName: moonPhaseName(ill.phase, locale),
    // Twilight mappings according to suncalc docs
    civilDawn: (times as any).dawn ?? null,
    civilDusk: (times as any).dusk ?? null,
    nauticalDawn: (times as any).nauticalDawn ?? null,
    nauticalDusk: (times as any).nauticalDusk ?? null,
    astronomicalDawn: (times as any).nightEnd ?? null,
    astronomicalDusk: (times as any).night ?? null,
  };
}

export function formatTime(d: Date | null, tz?: string, locale: string = "en"): string {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat(locale || "en", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz || undefined
    }).format(d);
  } catch {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
}

export function timeOfDayPercent(d: Date, tz?: string): number {
  // returns 0..1 position within day for the given date in tz
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || undefined,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).formatToParts(d);
    const h = Number(parts.find(p => p.type === "hour")?.value || 0);
    const m = Number(parts.find(p => p.type === "minute")?.value || 0);
    const s = Number(parts.find(p => p.type === "second")?.value || 0);
    return (h * 3600 + m * 60 + s) / 86400;
  } catch {
    const h = d.getHours();
    const m = d.getMinutes();
    const s = d.getSeconds();
    return (h * 3600 + m * 60 + s) / 86400;
  }
}

import SunCalc from "suncalc";

/**
 * Represents the result of astronomical calculations.
 * @property {Date | null} sunrise - The time of sunrise.
 * @property {Date | null} sunset - The time of sunset.
 * @property {Date | null} moonrise - The time of moonrise.
 * @property {Date | null} moonset - The time of moonset.
 * @property {number} phase - The moon phase, from 0.0 (new moon) to 1.0 (new moon).
 * @property {string} phaseName - The name of the moon phase.
 * @property {number} illumination - The fraction of the moon's illuminated limb.
 * @property {Date | null} civilDawn - The time when the sun is 6 degrees below the horizon in the morning.
 * @property {Date | null} civilDusk - The time when the sun is 6 degrees below the horizon in the evening.
 * @property {Date | null} nauticalDawn - The time when the sun is 12 degrees below the horizon in the morning.
 * @property {Date | null} nauticalDusk - The time when the sun is 12 degrees below the horizon in the evening.
 * @property {Date | null} astronomicalDawn - The time when the sun is 18 degrees below the horizon in the morning.
 * @property {Date | null} astronomicalDusk - The time when the sun is 18 degrees below the horizon in the evening.
 */
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

/**
 * Gets the name of the moon phase for a given phase value.
 * @param {number} phase - The moon phase, from 0.0 (new moon) to 1.0 (new moon).
 * @param {string} [locale="en"] - The locale to use for the phase name (e.g., "en" or "de").
 * @returns {string} The name of the moon phase.
 */
export function moonPhaseName(phase: number, locale: string = "en"): string {
  // Phase: 0=new, 0.25=first quarter, 0.5=full, 0.75=last quarter
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

/**
 * Computes astronomical data for a given latitude, longitude, and date.
 * @param {number} lat - The latitude.
 * @param {number} lon - The longitude.
 * @param {Date} [date=new Date()] - The date for the calculation.
 * @param {string} [locale="en"] - The locale for the moon phase name.
 * @returns {AstroResult} An object containing the astronomical data.
 */
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

/**
 * Formats a date object into a time string (HH:mm).
 * @param {Date | null} d - The date to format.
 * @param {string} [tz] - The time zone to use.
 * @param {string} [locale="en"] - The locale to use for formatting.
 * @returns {string} The formatted time string, or "—" if the date is null.
 */
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

/**
 * Calculates the percentage of the day that has passed for a given date and time zone.
 * @param {Date} d - The date object.
 * @param {string} [tz] - The time zone to use.
 * @returns {number} The percentage of the day passed, from 0.0 to 1.0.
 */
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

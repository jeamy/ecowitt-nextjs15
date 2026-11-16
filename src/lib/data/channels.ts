/**
 * Finds the correct header key for a given metric and channel number in the 'allsensors' dataset.
 * It handles synonyms for metric names.
 * @param header - The array of header strings from the data.
 * @param metric - The metric to find (e.g., "Temperatur").
 * @param chNum - The channel number as a string (e.g., "1").
 * @returns The matching header key, or a fallback.
 * @private
 */
export function headerKeyForAllsensors(header: string[], metric: string, chNum: string): string {
  // Prefer CHx <metric>
  const synonyms: Record<string, string[]> = {
    Temperatur: ["Temperature", "Temperatur"],
    Luftfeuchtigkeit: ["Luftfeuchtigkeit", "Humidity"],
    Taupunkt: ["Taupunkt", "Dew Point"],
    "Gefühlte Temperatur": ["Wärmeindex", "Gefühlte Temperatur", "Feels Like", "Heat Index"],
  };
  const metricsToTry = synonyms[metric as keyof typeof synonyms] || [metric];
  let direct: string | undefined;
  for (const m of metricsToTry) {
    direct = header.find((h) => h.startsWith(`CH${chNum} ${m}`));
    if (direct) break;
  }
  if (direct) return direct;
  // Humidity alternative from WN35CHxhum
  if (metric === "Luftfeuchtigkeit") {
    const alt = header.find((h) => h.toLowerCase().startsWith(`wn35ch${chNum}hum`));
    if (alt) return alt;
  }
  // fallback to first CH for metric
  for (const m of metricsToTry) {
    const any = header.find((h) => h.split("(")[0].trim().toLowerCase() === `ch${chNum} ${m.toLowerCase()}`);
    if (any) return any;
  }
  return "";
}

export function isChannelMetricColumn(name: string): boolean {
  const match = name.match(/^(?:CH(\d+)\s|WN35CH(\d+)hum)/i);
  if (!match) return false;
  return ["Temperatur", "Taupunkt", "Gefühlte Temperatur", "Luftfeuchtigkeit"]
    .some((metric) => headerKeyForAllsensors([name], metric, match[1] || match[2]) === name);
}

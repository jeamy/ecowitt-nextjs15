export function tryRead(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => (acc && key in acc ? acc[key] : undefined), obj);
}

export function numVal(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object" && v) {
    return numVal((v as any).value);
  }
  return null;
}

export function valueAndUnit(v: any): { value: string | number | null; unit?: string } {
  if (v == null) return { value: null };
  if (typeof v === "object" && "value" in v) {
    return { value: (v as any).value, unit: (v as any).unit };
  }
  return { value: v };
}

export function fmtVU(vu: { value: string | number | null; unit?: string }, fallbackUnit?: string) {
  if (vu.value == null || vu.value === "") return "-";
  const unit = vu.unit ?? fallbackUnit ?? "";
  const numValue = Number(vu.value);
  if (numValue === 0) return `0${unit ? ` ${unit}` : ""}`;
  return `${vu.value}${unit ? ` ${unit}` : ""}`;
}

export function calculateDewPoint(temperature: number, humidity: number): number {
  const a = 17.27;
  const b = 237.7;
  const alpha = (a * temperature) / (b + temperature) + Math.log(humidity / 100.0);
  const dewPoint = (b * alpha) / (a - alpha);
  return Number.isFinite(dewPoint) ? Math.round(dewPoint * 10) / 10 : temperature;
}

export function calculateHeatIndex(temperature: number, humidity: number): number {
  if (temperature < 20) return temperature;
  const t = temperature;
  const rh = humidity;
  const c1 = -8.78469475556;
  const c2 = 1.61139411;
  const c3 = 2.33854883889;
  const c4 = -0.14611605;
  const c5 = -0.012308094;
  const c6 = -0.0164248277778;
  const c7 = 0.002211732;
  const c8 = 0.00072546;
  const c9 = -0.000003582;
  const hi =
    c1 + c2 * t + c3 * rh + c4 * t * rh + c5 * t * t + c6 * rh * rh + c7 * t * t * rh + c8 * t * rh * rh + c9 * t * t * rh * rh;
  return Number.isFinite(hi) ? Math.round(hi * 10) / 10 : temperature;
}

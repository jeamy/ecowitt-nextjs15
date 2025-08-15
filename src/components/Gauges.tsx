"use client";

import React, { useEffect, useMemo, useState, useId } from "react";

// Lightweight helpers – duplicated to keep this component self-contained
function tryRead(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => (acc && key in acc ? (acc as any)[key] : undefined), obj);
}

// Temperature/Humidity color helpers shared across components
function tempColor(t: number | null): string {
  // Reversed spectrum: violet at cold end, red at hot end
  // Red at +45°C, violet around -20°C (and below). Thresholds in °C (converted from the given Fahrenheit table).
  if (t == null || !isFinite(t)) return "#94a3b8"; // slate-400 fallback
  const x = t;
  if (x <= -20) return "#7c3aed"; // violet-600
  if (x <= -15) return "#4f46e5"; // indigo-600
  if (x <= -10) return "#3b82f6"; // blue-500
  if (x <=  -5) return "#0ea5e9"; // sky-500
  if (x <=   0) return "#22d3ee"; // cyan-400
  if (x <=   5) return "#22c55e"; // green-500
  if (x <=  10) return "#84cc16"; // lime-500
  if (x <=  15) return "#eab308"; // yellow-500
  if (x <=  20) return "#f59e0b"; // amber-500
  if (x <=  25) return "#f97316"; // orange-500
  if (x <=  35) return "#ea580c"; // orange-600
  if (x <=  40) return "#ef4444"; // red-500 (swapped)
  if (x <=  45) return "#dc2626"; // red-600 (swapped) at +45°C
  return "#b91c1c"; // red-700 above +45°C
}

function humColor(h: number | null): string {
  // Similar reversed spectrum from 0% (violet) to 100% (red)
  if (h == null || !isFinite(h)) return "#94a3b8";
  const x = Math.max(0, Math.min(100, h));
  if (x <= 10)  return "#7c3aed"; // violet-600
  if (x <= 20)  return "#4f46e5"; // indigo-600
  if (x <= 30)  return "#3b82f6"; // blue-500
  if (x <= 40)  return "#0ea5e9"; // sky-500
  if (x <= 50)  return "#22d3ee"; // cyan-400
  if (x <= 60)  return "#22c55e"; // green-500
  if (x <= 70)  return "#84cc16"; // lime-500
  if (x <= 80)  return "#eab308"; // yellow-500
  if (x <= 90)  return "#f97316"; // orange-500
  return "#dc2626"; // red-600 to 100%
}

// Vertical temperature gradient bar with ticks every `step` degrees
function TempGradientBar(props: { min: number; max: number; step: number; height?: number; width?: number }) {
  const { min, max, step, height = 200, width = 28 } = props;
  const pad = 12;
  const innerH = height - pad * 2;
  const x = 10;
  const y = pad;
  const tRange = max - min;
  const posY = (v: number) => y + innerH - (innerH * (v - min)) / tRange;
  const gid = useId();
  const gradId = `tempGrad-${gid}`;

  // Build hard-edge gradient stops from the same palette as the ring
  const eps = 0.000001;
  const rawEdges = [min, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 35, 40, 45, max];
  const edges: number[] = rawEdges
    .filter((v) => v >= min - eps && v <= max + eps)
    .sort((a, b) => a - b)
    .filter((v, i, arr) => i === 0 || v - arr[i - 1] > eps);

  const colorFor = (t: number) => tempColor(t);

  type Stop = { off: number; color: string };
  const stops: Stop[] = [];
  let curColor = colorFor(min);
  stops.push({ off: 0, color: curColor });
  for (let i = 1; i < edges.length - 1; i++) {
    const off = (edges[i] - min) / tRange;
    const left = Math.max(0, Math.min(1, off - eps));
    const right = Math.max(0, Math.min(1, off));
    // close previous band
    stops.push({ off: left, color: curColor });
    // open next band
    curColor = colorFor(edges[i] + 1e-3);
    stops.push({ off: right, color: curColor });
  }
  stops.push({ off: 1, color: curColor });

  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max; v += step) ticks.push(v);

  return (
    <svg width={width + 36} height={height} viewBox={`0 0 ${width + 36} ${height}`}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
          {stops.map((s, i) => (
            <stop key={i} offset={`${s.off * 100}%`} stopColor={s.color} />
          ))}
        </linearGradient>
      </defs>
      <rect x={x} y={y} width={width} height={innerH} fill={`url(#${gradId})`} stroke="#e5e7eb" rx={4} />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={x + width} y1={posY(v)} x2={x + width + 8} y2={posY(v)} stroke="#475569" strokeWidth={1} />
          <text x={x + width + 10} y={posY(v) + 3} fontSize={10} fill="#1f2937">{v}°</text>
        </g>
      ))}
    </svg>
  );
}

// Vertical humidity gradient bar (1–100%) with hard edges and labels
function HumGradientBar(props: { min: number; max: number; step: number; height?: number; width?: number }) {
  const { min, max, step, height = 200, width = 28 } = props;
  const pad = 12;
  const innerH = height - pad * 2;
  const x = 10;
  const y = pad;
  const hRange = max - min;
  const posY = (v: number) => y + innerH - (innerH * (v - min)) / hRange;
  const gid = useId();
  const gradId = `humGrad-${gid}`;

  const eps = 0.000001;
  const rawEdges = [min, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, max];
  const edges: number[] = rawEdges
    .filter((v) => v >= min - eps && v <= max + eps)
    .sort((a, b) => a - b)
    .filter((v, i, arr) => i === 0 || v - arr[i - 1] > eps);

  const colorFor = (h: number) => humColor(h);

  type Stop = { off: number; color: string };
  const stops: Stop[] = [];
  let curColor = colorFor(min);
  stops.push({ off: 0, color: curColor });
  for (let i = 1; i < edges.length - 1; i++) {
    const off = (edges[i] - min) / hRange;
    const left = Math.max(0, Math.min(1, off - eps));
    const right = Math.max(0, Math.min(1, off));
    stops.push({ off: left, color: curColor });
    curColor = colorFor(edges[i] + 1e-3);
    stops.push({ off: right, color: curColor });
  }
  stops.push({ off: 1, color: curColor });

  const ticks: number[] = [min];
  for (let v = 10; v <= max; v += step) ticks.push(v);

  return (
    <svg width={width + 36} height={height} viewBox={`0 0 ${width + 36} ${height}`}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
          {stops.map((s, i) => (
            <stop key={i} offset={`${s.off * 100}%`} stopColor={s.color} />
          ))}
        </linearGradient>
      </defs>
      <rect x={x} y={y} width={width} height={innerH} fill={`url(#${gradId})`} stroke="#e5e7eb" rx={4} />
      {ticks.map((v, i) => (
        <g key={`${v}-${i}`}>
          <line x1={x + width} y1={posY(v)} x2={x + width + 8} y2={posY(v)} stroke="#475569" strokeWidth={1} />
          <text x={x + width + 10} y={posY(v) + 3} fontSize={10} fill="#1f2937">{v}%</text>
        </g>
      ))}
    </svg>
  );
}

function numVal(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return isNaN(Number(v)) ? null : Number(v);
  if (typeof v === "object" && v) {
    const x = (v as any).value;
    if (x == null) return null;
    if (typeof x === "number") return Number.isFinite(x) ? x : null;
    if (typeof x === "string") return isNaN(Number(x)) ? null : Number(x);
  }
  return null;
}

function valueAndUnit(v: any): { value: string | number | null; unit?: string } {
  if (v == null) return { value: null };
  if (typeof v === "object" && ("value" in v)) {
    return { value: (v as any).value, unit: (v as any).unit };
  }
  return { value: v };
}

function fmtVU(vu: { value: string | number | null; unit?: string }, fallbackUnit?: string) {
  if (vu.value == null || vu.value === "") return "—";
  const unit = vu.unit ?? fallbackUnit ?? "";
  return `${vu.value}${unit ? ` ${unit}` : ""}`;
}

// Derived metrics
function calculateDewPoint(temperature: number, humidity: number): number {
  const a = 17.27;
  const b = 237.7;
  const alpha = (a * temperature) / (b + temperature) + Math.log(humidity / 100.0);
  const dewPoint = (b * alpha) / (a - alpha);
  return Number.isFinite(dewPoint) ? Math.round(dewPoint * 10) / 10 : temperature;
}

function calculateHeatIndex(temperature: number, humidity: number): number {
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

// Enhanced donut gauge with tick labels, segments and extra rings
function DonutGauge(props: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  unit?: string;
  color?: string;
  size?: number; // px
  ticks?: number; // major ticks count
  showMinorTicks?: boolean;
  showTickLabels?: boolean;
  showTicks?: boolean;
  showValueText?: boolean;
  showUnitText?: boolean;
  fullColorRing?: boolean;
  valueColor?: string;
  unitColor?: string;
  captionColor?: string;
  ringOpacity?: number;
  segments?: Array<{ from: number; to: number; color: string }>; // background bands
  extras?: Array<{ value: number | null; color: string; opacity?: number }>; // additional rings
}) {
  const {
    label,
    value,
    min,
    max,
    unit,
    color = "#2563eb",
    size = 220,
    ticks = 5,
    showMinorTicks = true,
    showTickLabels = true,
    showTicks = true,
    showValueText = true,
    showUnitText = true,
    fullColorRing = false,
    valueColor,
    unitColor,
    captionColor,
    ringOpacity = 1,
    segments = [],
    extras = [],
  } = props;
  const r = size * 0.33; // base radius
  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(8, Math.round(size * 0.08)); // slimmer ring
  const C = 2 * Math.PI * r;
  const clampPct = (v: number | null) => (v == null || !isFinite(v) ? 0 : Math.max(0, Math.min(1, (v - min) / (max - min))));
  const pct = clampPct(value);
  const dash = C * pct;
  const rest = C - dash;
  const fontMain = Math.round(size * 0.16); // slightly smaller to avoid overlap
  const fontUnit = Math.round(size * 0.10);
  const labelColor = "#374151";

  // angle helper starting from top
  const ang = (p: number) => -Math.PI / 2 + p * Math.PI * 2;

  const tickEls: React.ReactNode[] = [];
  for (let i = 0; i <= ticks; i++) {
    const p = i / ticks;
    const a = ang(p);
    const x1 = cx + Math.cos(a) * (r + stroke / 2 - 2);
    const y1 = cy + Math.sin(a) * (r + stroke / 2 - 2);
    const x2 = cx + Math.cos(a) * (r + stroke / 2 + 8);
    const y2 = cy + Math.sin(a) * (r + stroke / 2 + 8);
    const labelVal = Math.round(min + p * (max - min));
    const lx = cx + Math.cos(a) * (r + stroke / 2 + 24);
    const ly = cy + Math.sin(a) * (r + stroke / 2 + 24);
    if (showTicks && i < ticks) {
      tickEls.push(
        <g key={`t${i}`}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#cbd5e1" strokeWidth={2} />
          {showTickLabels && (
            <text x={lx} y={ly + 3} textAnchor="middle" fontSize={9} fill="#9ca3af" style={{ pointerEvents: 'none' }}>{labelVal}</text>
          )}
        </g>
      );
    }
    if (showTicks && showMinorTicks && i < ticks) {
      for (let m = 1; m < 5; m++) {
        const pp = (i + m / 5) / ticks;
        const aa = ang(pp);
        const mx1 = cx + Math.cos(aa) * (r + stroke / 2 - 1);
        const my1 = cy + Math.sin(aa) * (r + stroke / 2 - 1);
        const mx2 = cx + Math.cos(aa) * (r + stroke / 2 + 5);
        const my2 = cy + Math.sin(aa) * (r + stroke / 2 + 5);
        tickEls.push(<line key={`m${i}-${m}`} x1={mx1} y1={my1} x2={mx2} y2={my2} stroke="#e5e7eb" strokeWidth={1.5} />);
      }
    }
  }

  // Background warning bands (segments)
  const segEls: React.ReactNode[] = [];
  for (const seg of segments) {
    const p1 = clampPct(seg.from);
    const p2 = clampPct(seg.to);
    const d1 = C * p1;
    const d2 = C * (p2 - p1);
    segEls.push(
      <circle
        key={`${seg.from}-${seg.to}`}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={seg.color}
        strokeOpacity={0.25}
        strokeWidth={stroke}
        strokeDasharray={`${d2} ${C - d2}`}
        transform={`rotate(${(-90 + p1 * 360).toFixed(3)} ${cx} ${cy})`}
      />
    );
  }

  const extraEls: React.ReactNode[] = [];
  extras.forEach((ex, i) => {
    const p = clampPct(ex.value);
    const d = C * p;
    const restEx = C - d;
    extraEls.push(
      <circle
        key={`ex${i}`}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={ex.color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${d} ${restEx}`}
        transform={`rotate(-90 ${cx} ${cy})`}
        opacity={ex.opacity ?? 0.6}
      />
    );
  });

  return (
    <div className="flex flex-col items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
        {/* background or full-color ring */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={fullColorRing ? color : "#e5e7eb"} strokeOpacity={fullColorRing ? ringOpacity : 1} strokeWidth={stroke} />
        {/* segments */}
        {!fullColorRing && segEls}
        {/* extra rings (e.g., dew point, feels like) */}
        {!fullColorRing && extraEls}
        {/* value ring (hidden for fullColorRing) */}
        {!fullColorRing && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeOpacity={ringOpacity}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${rest}`}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
        {/* ticks & labels */}
        {showTicks && tickEls}
        {showValueText && (
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize={fontMain} fontWeight={500} fill={valueColor ?? "#1f2937"}>
            {value == null || !isFinite(value) ? "—" : Math.round(value)}
          </text>
        )}
        {showUnitText && (
          <text x={cx} y={cy + 18} textAnchor="middle" fontSize={fontUnit} fill={unitColor ?? labelColor}>
            {unit || ""}
          </text>
        )}
      </svg>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300" style={{ color: captionColor }}>{label}</div>
    </div>
  );
}

function KPI(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="p-3 rounded border border-gray-200 dark:border-neutral-800">
      <div className="text-xs text-gray-500 mb-1">{props.label}</div>
      <div className="text-base font-normal text-gray-800 dark:text-gray-200">{props.value}</div>
    </div>
  );
}

// Raindrop icon with fill level based on hourly rate
function Raindrop({ rate, unit = "mm/hr", size = 84 }: { rate: number | null; unit?: string; size?: number }) {
  const id = React.useMemo(() => `drop-${Math.random().toString(36).slice(2)}` , []);
  let v = rate ?? 0;
  const u = (unit || "").toLowerCase();
  if (u.includes("in")) v *= 25.4; // convert inch/hr to mm/hr if needed
  const maxMmPerHr = 5; // saturation level
  const pct = Math.max(0, Math.min(1, v / maxMmPerHr));
  if (!isFinite(v)) v = 0;
  const w = size;
  const h = size;
  const fillH = h * 0.75 * pct; // 75% of height used for water
  const cx = w / 2;

  // teardrop path
  const d = `M ${cx} ${h * 0.05} C ${w * 0.28} ${h * 0.32}, ${w * 0.16} ${h * 0.48}, ${w * 0.16} ${h * 0.64}
             A ${w * 0.34} ${w * 0.34} 0 0 0 ${w * 0.84} ${h * 0.64}
             C ${w * 0.84} ${h * 0.48}, ${w * 0.72} ${h * 0.32}, ${cx} ${h * 0.05} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <clipPath id={id}>
          <path d={d} />
        </clipPath>
      </defs>
      {/* outline */}
      <path d={d} fill="#fff" stroke="#38bdf8" strokeWidth={2} />
      {/* water fill */}
      {pct > 0 && (
        <g clipPath={`url(#${id})`}>
          <rect x={0} y={h - fillH - h * 0.08} width={w} height={fillH + h * 0.08} fill="#0ea5e9" opacity={0.9} />
          {/* wave */}
          <ellipse cx={cx} cy={h - fillH - h * 0.08} rx={w * 0.38} ry={h * 0.06} fill="#38bdf8" opacity={0.9} />
        </g>
      )}
      {/* rate text inside */}
      <text x={cx} y={h * 0.62} textAnchor="middle" fontSize={10} fontWeight={400} fill="#0369a1">
        {(rate ?? 0).toFixed(1)}
      </text>
      <text x={cx} y={h * 0.62 + 12} textAnchor="middle" fontSize={8} fill="#0284c7">
        {unit || "mm/hr"}
      </text>
    </svg>
  );
}

function CompassWind(props: { dir: number | null; speed: number | null; gust?: number | null; unit?: string }) {
  const { dir, speed, gust, unit = "" } = props;
  const size = 200;
  const r = 78;
  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(8, Math.round(size * 0.08));
  const outerR = r + stroke / 2; // outer edge of the ring
  const arrowAngle = (dir ?? 0) - 90; // rotate so 0° points up
  return (
    <div className="flex flex-col items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="#fff" stroke="#e5e7eb" strokeWidth={stroke} />
        {/* ticks */}
        {[...Array(36)].map((_, i) => {
          const a = (i * 10 * Math.PI) / 180;
          const len = i % 9 === 0 ? 12 : i % 3 === 0 ? 8 : 5;
          const x1 = cx + Math.cos(a) * (r - 6);
          const y1 = cy + Math.sin(a) * (r - 6);
          const x2 = cx + Math.cos(a) * (r + len - 6);
          const y2 = cy + Math.sin(a) * (r + len - 6);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#cbd5e1" strokeWidth={i % 3 === 0 ? 2 : 1} />;
        })}
        {/* cardinal labels */}
        {[
          { x: cx, y: cy - (r + 18), t: "N" },
          { x: cx + (r + 18), y: cy, t: "E" },
          { x: cx, y: cy + (r + 18), t: "S" },
          { x: cx - (r + 18), y: cy, t: "W" },
        ].map(({ x, y, t }, i) => (
          <text key={i} x={x} y={y + 4} textAnchor="middle" fontSize={12} fill="#6b7280">{t}</text>
        ))}
        {/* arrow - refined head, tip extends above ring (12px overhang) */}
        <g transform={`rotate(${arrowAngle} ${cx} ${cy})`}>
          {(() => {
            const headW = 18; // head width
            const apexY = cy - outerR - 8; // extend beyond ring by 12px (double)
            const baseY = cy - outerR + 24; // base of head just inside ring
            return (
              <polygon points={`${cx - headW / 2},${baseY} ${cx + headW / 2},${baseY} ${cx},${apexY}`} fill="#0ea5e9" />
            );
          })()}
          {/* shaft, rounded caps */}
          <line x1={cx} y1={cy} x2={cx} y2={cy + r - 12} stroke="#0ea5e9" strokeWidth={8} strokeLinecap="round" />
          <line x1={cx} y1={cy} x2={cx} y2={cy - outerR + 12} stroke="#0ea5e9" strokeWidth={8} strokeLinecap="round" />
        </g>
        {/* centered speed text */}
        <text x="50%" y={cy} textAnchor="middle" fontSize={24} fontWeight={400} fill="#111827" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {speed == null ? "—" : speed.toFixed(1)}{unit ? ` ${unit}` : ""}
        </text>
        {/* centered gust text */}
        <text x="50%" y={cy + 18} textAnchor="middle" fontSize={12} fill="#6b7280" style={{ fontVariantNumeric: 'tabular-nums' }}>
          Böe: {gust == null ? "—" : gust.toFixed(1)}{unit ? ` ${unit}` : ""}
        </text>
      </svg>
      <div className="mt-1 text-sm text-gray-700 dark:text-gray-300">Wind</div>
    </div>
  );
}

export default function Gauges() {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [channelsCfg, setChannelsCfg] = useState<Record<string, { name?: string }>>({});

  const fetchNow = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/rt/last", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rec = await res.json();
      if (!rec || rec.ok === false) {
        const msg = rec?.error || "keine Daten";
        setError(msg);
        return;
      }
      setData(rec.data ?? null);
      setLastUpdated(rec.updatedAt ? new Date(rec.updatedAt) : new Date());
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNow();
    const refreshMs = Number(process.env.NEXT_PUBLIC_RT_REFRESH_MS || 300000);
    const id = setInterval(fetchNow, isFinite(refreshMs) && refreshMs > 0 ? refreshMs : 300000);
    return () => clearInterval(id);
  }, []);

  // Load channel display names
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config/channels", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        setChannelsCfg(json || {});
      } catch {}
    })();
  }, []);

  const payload = data as any;

  // Indoor / Outdoor basics
  const indoorT = numVal(tryRead(payload, "indoor.temperature"));
  const indoorH = numVal(tryRead(payload, "indoor.humidity"));
  const outdoorT = numVal(tryRead(payload, "outdoor.temperature"));
  const outdoorH = numVal(tryRead(payload, "outdoor.humidity"));
  const feelsLike = numVal(tryRead(payload, "outdoor.feels_like") ?? tryRead(payload, "outdoor.app_temp"));
  let dewPoint = numVal(tryRead(payload, "outdoor.dew_point"));
  if (dewPoint == null && outdoorT != null && outdoorH != null) dewPoint = calculateDewPoint(outdoorT, outdoorH);

  // Pressure
  const pressureRel = valueAndUnit(tryRead(payload, "pressure.relative") ?? tryRead(payload, "barometer.relative") ?? tryRead(payload, "barometer.rel"));
  const pressureAbs = valueAndUnit(tryRead(payload, "pressure.absolute") ?? tryRead(payload, "barometer.absolute") ?? tryRead(payload, "barometer.abs"));

  // Wind
  const windSpd = numVal(tryRead(payload, "wind.wind_speed") ?? tryRead(payload, "wind_speed"));
  const windGust = numVal(tryRead(payload, "wind.wind_gust") ?? tryRead(payload, "wind_gust"));
  const windDir = numVal(tryRead(payload, "wind.wind_direction") ?? tryRead(payload, "wind_direction"));
  const windUnit = (tryRead(payload, "wind.wind_speed.unit") ?? tryRead(payload, "wind_speed.unit") ?? "").toString();

  // Rain & solar
  const rainRate = valueAndUnit(tryRead(payload, "rainfall.rain_rate") ?? tryRead(payload, "rain.rate"));
  const rainHourly = valueAndUnit(tryRead(payload, "rainfall.hourly"));
  const rainDaily = valueAndUnit(tryRead(payload, "rainfall.daily"));
  const rainWeekly = valueAndUnit(tryRead(payload, "rainfall.weekly"));
  const rainMonthly = valueAndUnit(tryRead(payload, "rainfall.monthly"));
  const rainYearly = valueAndUnit(tryRead(payload, "rainfall.yearly"));
  const solar = valueAndUnit(tryRead(payload, "solar_and_uvi.solar"));
  const uvi = valueAndUnit(tryRead(payload, "solar_and_uvi.uvi"));

  // Channel sensors detection
  const channelKeys = useMemo(() => {
    if (!payload || typeof payload !== "object") return [] as string[];
    return Object.keys(payload)
      .filter((k) => /^ch\d+$/i.test(k) || /_ch\d+$/i.test(k))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [payload]);

  const channelName = (key: string) => {
    const m = key.match(/(?:^ch|_ch)(\d+)$/i);
    const id = m ? `ch${m[1]}`.toLowerCase() : key.toLowerCase();
    const n = channelsCfg?.[id]?.name;
    return n ? `${n} (${id.toUpperCase()})` : key.replace(/^temp_and_humidity_/i, "").toUpperCase();
  };

  // Color segments (subtle bands) more in line with screenshots
  const tempSegmentsC = (min: number, max: number) => [
    { from: min, to: 18, color: "#93c5fd" },  // cool
    { from: 18, to: 26, color: "#fde68a" },  // comfort
    { from: 26, to: max, color: "#fecaca" }, // warm/hot
  ];

  const humSegments = [
    { from: 0, to: 30, color: "#fde68a" },   // dry
    { from: 30, to: 60, color: "#bbf7d0" }, // ok
    { from: 60, to: 100, color: "#ddd6fe" } // humid
  ];

  const uvSegments = [
    { from: 0, to: 2, color: "#22c55e" },   // low
    { from: 2, to: 5, color: "#eab308" },   // moderate
    { from: 5, to: 7, color: "#f97316" },   // high
    { from: 7, to: 10, color: "#ef4444" },  // very high
    { from: 10, to: 12, color: "#a855f7" }, // extreme
  ];

  // Value-based color helpers moved to top-level (shared)

  // Per-channel color palette and helpers
  const channelPalette: Record<string, string> = {
    ch1: "#0ea5e9", // sky-500
    ch2: "#f59e0b", // amber-500
    ch3: "#22c55e", // green-500
    ch4: "#ef4444", // red-500
    ch5: "#a855f7", // purple-500
    ch6: "#06b6d4", // cyan-500
    ch7: "#e11d48", // rose-600
    ch8: "#14b8a6", // teal-500
  };
  const channelColor = (key: string) => {
    const id = key.toLowerCase();
    return channelPalette[id as keyof typeof channelPalette] ?? "#64748b"; // slate-500 fallback
  };

  const timeText = useMemo(() => {
    if (!lastUpdated) return "—";
    const d = lastUpdated;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${dd}.${mm}.${yyyy} ${hh}:${mi}:${ss}`;
  }, [lastUpdated]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600 dark:text-gray-400">Letzte Aktualisierung: {timeText}</div>
        {loading && <div className="text-xs text-amber-600">Laden…</div>}
        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>

      {/* Top row: Outdoor Temp, Humidity, Wind */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded border border-gray-200 dark:border-neutral-800 p-3 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <TempGradientBar min={-20} max={45} step={5} height={200} />
            <DonutGauge
              label="🌡️ Außen-Temperatur"
              value={outdoorT}
              min={-20}
              max={45}
              unit="°C"
              color={tempColor(outdoorT)}
              showTicks={false}
              showTickLabels={false}
              showMinorTicks={false}
              fullColorRing={true}
              ringOpacity={0.6}
            />
          </div>
        </div>
        <div className="rounded border border-gray-200 dark:border-neutral-800 p-3 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <DonutGauge
              label="💧 Außen-Feuchte"
              value={outdoorH}
              min={0}
              max={100}
              unit="%"
              color={humColor(outdoorH)}
              showTicks={false}
              showTickLabels={false}
              showMinorTicks={false}
              fullColorRing={true}
              ringOpacity={0.6}
            />
            <HumGradientBar min={1} max={100} step={10} height={200} />
          </div>
        </div>
        <div className="rounded border border-gray-200 dark:border-neutral-800 p-3 flex items-center justify-center">
          <CompassWind dir={windDir} speed={windSpd} gust={windGust} unit={windUnit} />
        </div>
      </div>

      {/* Second row: Pressure, Rain, Solar/UV */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded border border-gray-200 dark:border-neutral-800 p-3 flex items-center justify-center">
          <DonutGauge label="⏺️ Luftdruck (rel.)" value={numVal(pressureRel.value)} min={950} max={1050} unit="hPa" color="#8b5cf6" showTicks={false} showTickLabels={false} showMinorTicks={false} fullColorRing={true} ringOpacity={0.6} />
        </div>
        <div className="rounded border border-gray-200 dark:border-neutral-800 p-3 flex flex-col gap-2">
          <div className="text-sm text-sky-700 text-center w-full">Niederschlag</div>
          <div className="grid grid-cols-2 gap-3 items-center">
            <div className="flex items-center justify-center">
              <Raindrop rate={numVal(rainRate.value)} unit={rainRate.unit || "mm/hr"} size={84} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <KPI label="Rate" value={fmtVU(rainRate)} />
              <KPI label="Stündlich" value={fmtVU(rainHourly, "mm")} />
              <KPI label="Täglich" value={fmtVU(rainDaily, "mm")} />
              <KPI label="Wöchentlich" value={fmtVU(rainWeekly, "mm")} />
              <KPI label="Monatlich" value={fmtVU(rainMonthly, "mm")} />
              <KPI label="Jährlich" value={fmtVU(rainYearly, "mm")} />
            </div>
          </div>
        </div>
        <div className="rounded border border-gray-200 dark:border-neutral-800 p-3 grid grid-cols-2 gap-3 items-center">
          <DonutGauge label="☀️ Solar" value={numVal(solar.value)} min={0} max={1200} unit="W/m²" color="#f59e0b" size={180} showTicks={false} showTickLabels={false} showMinorTicks={false} fullColorRing={true} ringOpacity={0.6} />
          <DonutGauge label="🌈 UV-Index" value={numVal(uvi.value)} min={0} max={12} unit="" color="#22c55e" size={180} showTicks={false} showTickLabels={false} showMinorTicks={false} fullColorRing={true} ringOpacity={0.6} />
        </div>
      </div>

      {/* Third row: Indoor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded border border-gray-200 dark:border-neutral-800 p-3 flex items-center justify-center">
          <DonutGauge label="🏠 Innen-Temperatur" value={indoorT} min={10} max={35} unit="°C" color={tempColor(indoorT)} showTicks={false} showTickLabels={false} showMinorTicks={false} fullColorRing={true} ringOpacity={0.6} />
        </div>
        <div className="rounded border border-gray-200 dark:border-neutral-800 p-3 flex items-center justify-center">
          <DonutGauge label="🏠 Innen-Feuchte" value={indoorH} min={0} max={100} unit="%" color={humColor(indoorH)} showTicks={false} showTickLabels={false} showMinorTicks={false} fullColorRing={true} ringOpacity={0.6} />
        </div>
      </div>

      {/* Channel mini-gauges grid */}
      {channelKeys.length > 0 && (
        <div className="rounded border border-gray-200 dark:border-neutral-800 p-3">
          <div className="text-sm font-semibold text-black dark:text-black mb-3">Kanalsensoren</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-3 gap-6">
            {channelKeys.slice(0, 8).map((ck) => {
              const ch = (payload as any)[ck] || {};
              const t = numVal(ch.temperature);
              const h = numVal(ch.humidity);
              const dp = t != null && h != null ? calculateDewPoint(t, h) : numVal(ch.dew_point);
              const hi = t != null && h != null ? calculateHeatIndex(t, h) : numVal(ch.feels_like);
              const colT = tempColor(t);
              return (
                <div key={ck} className="rounded border border-gray-100 dark:border-neutral-800 p-4" style={{ borderTop: `3px solid ${colT}` }}>
                  <div className="text-sm mb-2 text-black dark:text-black">
                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ backgroundColor: colT }} />
                    <span className="align-middle">{channelName(ck)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <DonutGauge label="Temp" value={t} min={-20} max={45} unit="°C" color={colT} size={180} ticks={0} showTicks={false} showMinorTicks={false} showTickLabels={false} fullColorRing={true} ringOpacity={0.6} captionColor="#000" valueColor="#000" unitColor="#000" />
                    <DonutGauge label="Feuchte" value={h} min={0} max={100} unit="%" color={humColor(h)} size={180} ticks={0} showTicks={false} showMinorTicks={false} showTickLabels={false} fullColorRing={true} ringOpacity={0.6} captionColor="#000" valueColor="#000" unitColor="#000" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Raw data toggle for debugging */}
      <details className="rounded border border-gray-200 dark:border-neutral-800 p-3">
        <summary className="cursor-pointer text-sm text-gray-700">Rohdaten</summary>
        <pre className="mt-2 text-xs overflow-auto max-h-80 bg-gray-50 dark:bg-neutral-900 p-2 rounded">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}

"use client";

import React, { useMemo, useState } from "react";

export type LinePoint = { x: number; y: number; label?: string };
export type LineSeries = { id: string; color: string; points: LinePoint[] };

type Props = {
  series: LineSeries[];
  height?: number;
  yLabel?: string;
  xTickFormatter?: (v: number) => string;
  // Optional dedicated formatter for hover time (overrides xTickFormatter in tooltip)
  hoverTimeFormatter?: (v: number) => string;
  xLabel?: string;
  showLegend?: boolean;
  // Optional: render as vertical bars (useful for daily rainfall)
  bars?: boolean;
  // Bar width in x-units (minutes); defaults to spanX/(tickCount*1.5)
  barWidth?: number;
  // Optional fixed bar width in pixels (overrides barWidth)
  barWidthPx?: number;
  // Show hover crosshair and current values tooltip
  showHover?: boolean;
  // Optional unit appended to hover value, e.g. "mm"
  yUnit?: string;
  // Optional custom formatter for hover value
  valueFormatter?: (v: number) => string;
};

export default function LineChart({ series, height = 220, yLabel, xTickFormatter, hoverTimeFormatter, xLabel, showLegend = true, bars = false, barWidth, barWidthPx, showHover = true, yUnit, valueFormatter }: Props) {
  const padding = { top: 10, right: 12, bottom: 28, left: 36 };
  const width = 800; // SVG viewBox width; scales responsively via CSS

  const allPoints = series.flatMap((s) => s.points);
  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y).filter((n) => Number.isFinite(n));
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  let minY = ys.length ? Math.min(...ys) : 0;
  let maxY = ys.length ? Math.max(...ys) : 1;
  // For bars, include zero baseline in domain
  if (bars) {
    minY = Math.min(minY, 0);
    maxY = Math.max(maxY, 0);
  }

  function pickForHover(points: LinePoint[], x: number, _barsMode: boolean): LinePoint | null {
    const valid = points.filter((p) => Number.isFinite(p.y));
    if (valid.length === 0) return null;
    // Always pick the last point whose x <= hover x ("left bin" behavior)
    const sorted = valid.slice().sort((a, b) => a.x - b.x);
    let cand: LinePoint | null = null;
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      if (p.x <= x) cand = p; else break;
    }
    return cand;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  function sx(x: number) {
    return padding.left + ((x - minX) / spanX) * innerW;
  }
  function sy(y: number) {
    return padding.top + innerH - ((y - minY) / spanY) * innerH;
  }

  function pathFor(points: LinePoint[]) {
    const valid = points.filter((p) => Number.isFinite(p.y));
    if (valid.length === 0) return "";
    return valid
      .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
      .join(" ");
  }

  // Ticks: show hourly ticks for ~1 day, fewer for longer spans
  const xTickCount = spanX <= 1440 ? 24 : 10; // spanX in minutes (x is minutes offset)
  const yTickCount = 5;
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => minX + (spanX * i) / xTickCount);
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => minY + (spanY * i) / yTickCount);

  // Hover state (data-space x)
  const [hoverX, setHoverX] = useState<number | null>(null);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!showHover) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const xFrac = (px - padding.left) / (width - padding.left - padding.right);
    const dataX = minX + Math.max(0, Math.min(1, xFrac)) * spanX;
    setHoverX(dataX);
  };
  const onLeave = () => setHoverX(null);

  function nearest(points: LinePoint[], x: number): LinePoint | null {
    let best: LinePoint | null = null;
    let bestD = Infinity;
    for (const p of points) {
      if (!Number.isFinite(p.y)) continue;
      const d = Math.abs(p.x - x);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  // Use primary (first) series for hover readout to avoid clutter
  const hoverPrimary = useMemo(() => {
    if (hoverX == null || !series.length) return null;
    const s = series[0];
    const p = pickForHover(s.points, hoverX, !!bars);
    return p ? { color: s.color, p } : null;
  }, [hoverX, series]);

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" onMouseMove={onMove} onMouseLeave={onLeave}>
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
        {/* Y axis */}
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + innerH} stroke="#999" strokeWidth={1} />
        {/* X axis */}
        <line x1={padding.left} y1={padding.top + innerH} x2={padding.left + innerW} y2={padding.top + innerH} stroke="#999" strokeWidth={1} />

        {/* Y ticks */}
        {yTicks.map((v, i) => (
          <g key={`yt-${i}`}>
            <line x1={padding.left - 4} y1={sy(v)} x2={padding.left} y2={sy(v)} stroke="#999" strokeWidth={1} />
            <text x={padding.left - 6} y={sy(v) + 3} fontSize={10} textAnchor="end" fill="#666">
              {v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* X ticks */}
        {xTicks.map((v, i) => (
          <g key={`xt-${i}`}>
            <line x1={sx(v)} y1={padding.top + innerH} x2={sx(v)} y2={padding.top + innerH + 4} stroke="#999" strokeWidth={1} />
            <text x={sx(v)} y={padding.top + innerH + 14} fontSize={10} textAnchor="middle" fill="#666">
              {xTickFormatter ? xTickFormatter(v) : String(Math.round(v))}
            </text>
          </g>
        ))}

        {/* Bars (optional) */}
        {bars && series.map((s) => {
          // derive bar width from data spacing to avoid overlap
          let derivedBW: number | null = null;
          const xsS = s.points.map((pt) => pt.x).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
          if (xsS.length >= 2) {
            let dx = Infinity;
            for (let i = 1; i < xsS.length; i++) dx = Math.min(dx, xsS[i] - xsS[i - 1]);
            if (Number.isFinite(dx) && dx > 0) derivedBW = dx * 0.4; // 40% of spacing (thinner)
          }
          const bw = barWidth ?? derivedBW ?? (spanX / (xTickCount * 2));
          const pxW = Math.max(1, barWidthPx ?? ((bw / spanX) * innerW));
          return (
            <g key={`bars-${s.id}`}>
              {s.points.map((pt, idx) => {
                if (!Number.isFinite(pt.y)) return null;
                const cx = sx(pt.x);
                const y0 = sy(0);
                const y1 = sy(pt.y);
                const top = Math.min(y0, y1);
                const h = Math.abs(y1 - y0);
                return <rect key={idx} x={cx - pxW / 2} y={top} width={pxW} height={h} fill={s.color} opacity={0.8} />;
              })}
            </g>
          );
        })}

        {/* Lines */}
        {!bars && series.map((s) => (
          <path key={s.id} d={pathFor(s.points)} stroke={s.color} strokeWidth={2} fill="none" />
        ))}

        {/* Legend (optional) */}
        {showLegend && (
          <g transform={`translate(${padding.left}, ${padding.top})`}>
            {series.map((s, i) => (
              <g key={`lg-${s.id}`} transform={`translate(${i * 120}, 0)`}>
                <rect width={12} height={2} y={5} fill={s.color} />
                <text x={16} y={8} fontSize={11} fill="#333">{s.id}</text>
              </g>
            ))}
          </g>
        )}

        {yLabel && (
          <text x={padding.left} y={padding.top - 2} fontSize={11} fill="#333">{yLabel}</text>
        )}

        {xLabel && (
          <text x={padding.left + innerW / 2} y={padding.top + innerH + 24} fontSize={11} fill="#333" textAnchor="middle">{xLabel}</text>
        )}

        {/* Hover crosshair and tooltip */}
        {showHover && hoverX != null && (
          <g>
            {/* Crosshair */}
            <line x1={sx(hoverPrimary ? hoverPrimary.p.x : hoverX)} y1={padding.top} x2={sx(hoverPrimary ? hoverPrimary.p.x : hoverX)} y2={padding.top + innerH} stroke="#94a3b8" strokeDasharray="3,3" />
            {/* Points markers */}
            {hoverPrimary && (
              <circle cx={sx(hoverPrimary.p.x)} cy={sy(hoverPrimary.p.y)} r={3} fill={hoverPrimary.color} stroke="#fff" strokeWidth={1} />
            )}
            {/* Compact tooltip: date time and value */}
            <g transform={`translate(${padding.left + 6}, ${padding.top + 6})`}>
              <rect width={180} height={22} fill="rgba(255,255,255,0.9)" stroke="#cbd5e1" />
              <text x={6} y={14} fontSize={11} fill="#111">
                {(hoverTimeFormatter ? hoverTimeFormatter(hoverPrimary ? hoverPrimary.p.x : hoverX) : (xTickFormatter ? xTickFormatter(hoverPrimary ? hoverPrimary.p.x : hoverX) : String(Math.round(hoverPrimary ? hoverPrimary.p.x : hoverX))))}{
                  hoverPrimary && Number.isFinite(hoverPrimary.p.y)
                    ? `: ${valueFormatter ? valueFormatter(hoverPrimary.p.y) : `${hoverPrimary.p.y.toFixed(2)}${yUnit ? " " + yUnit : ""}`}`
                    : ""
                }
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

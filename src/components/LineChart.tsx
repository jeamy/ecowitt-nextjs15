"use client";

import React from "react";

export type LinePoint = { x: number; y: number; label?: string };
export type LineSeries = { id: string; color: string; points: LinePoint[] };

type Props = {
  series: LineSeries[];
  height?: number;
  yLabel?: string;
  xTickFormatter?: (v: number) => string;
  xLabel?: string;
  showLegend?: boolean;
};

export default function LineChart({ series, height = 220, yLabel, xTickFormatter, xLabel, showLegend = true }: Props) {
  const padding = { top: 10, right: 12, bottom: 28, left: 36 };
  const width = 800; // SVG viewBox width; scales responsively via CSS

  const allPoints = series.flatMap((s) => s.points);
  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y).filter((n) => Number.isFinite(n));
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 1;
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

  // Simple X ticks: 5 evenly spaced
  const ticks = 5;
  const xTicks = Array.from({ length: ticks + 1 }, (_, i) => minX + (spanX * i) / ticks);
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => minY + (spanY * i) / ticks);

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
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

        {/* Lines */}
        {series.map((s) => (
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
      </svg>
    </div>
  );
}

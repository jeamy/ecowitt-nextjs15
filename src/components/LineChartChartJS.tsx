"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Chart,
  LineElement,
  LineController,
  PointElement,
  LinearScale,
  BarController,
  BarElement,
  Tooltip,
  Legend,
  Title,
  Filler,
  TimeSeriesScale,
  CategoryScale,
} from "chart.js";

// Register needed chart.js components (tree-shakable)
Chart.register(
  LineElement,
  LineController,
  PointElement,
  LinearScale,
  BarController,
  BarElement,
  Tooltip,
  Legend,
  Title,
  Filler,
  TimeSeriesScale,
  CategoryScale,
);

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
  // Bar width in x-units (minutes); not used directly by Chart.js but kept for API compatibility
  barWidth?: number;
  // Optional fixed bar width in pixels
  barWidthPx?: number;
  // Show hover crosshair (handled by tooltip in Chart.js)
  showHover?: boolean;
  // Optional unit appended to hover value, e.g. "mm"
  yUnit?: string;
  // Optional custom formatter for hover value
  valueFormatter?: (v: number) => string;
};

export default function LineChart({
  series,
  height = 220,
  yLabel,
  xTickFormatter,
  hoverTimeFormatter,
  xLabel,
  showLegend = true,
  bars = false,
  barWidth,
  barWidthPx,
  showHover = true,
  yUnit,
  valueFormatter,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const zoomRegisteredRef = useRef(false);

  // Register zoom plugin only on the client to avoid SSR window errors
  useEffect(() => {
    if (typeof window === "undefined" || zoomRegisteredRef.current) return;
    import("chartjs-plugin-zoom")
      .then((mod: any) => {
        const plugin = mod?.default ?? mod;
        if (plugin) {
          Chart.register(plugin);
          zoomRegisteredRef.current = true;
          // ensure current chart picks up plugin
          chartRef.current?.update?.();
        }
      })
      .catch(() => {
        // ignore if plugin fails to load; charts still render without zoom
      });
  }, []);

  // Reset zoom helper (works even if plugin method is not present)
  const resetZoomSafe = () => {
    const c: any = chartRef.current as any;
    if (!c) return;
    if (typeof c.resetZoom === "function") {
      c.resetZoom();
    } else {
      // Fallback: clear manual min/max and update
      if (c.options?.scales?.x) {
        c.options.scales.x.min = undefined;
        c.options.scales.x.max = undefined;
      }
      if (c.options?.scales?.y) {
        c.options.scales.y.min = undefined;
        c.options.scales.y.max = undefined;
      }
      c.update("none");
    }
    setIsZoomed(false);
  };

  const allPoints = useMemo(() => series.flatMap((s) => s.points), [series]);
  const xs = useMemo(() => allPoints.map((p) => p.x), [allPoints]);
  const ys = useMemo(() => allPoints.map((p) => p.y).filter((n) => Number.isFinite(n)), [allPoints]);
  // Use a safer approach to find min/max values to avoid stack overflow with large arrays
  const minX = useMemo(() => {
    if (!xs.length) return 0;
    return xs.reduce((min, val) => Math.min(min, val), Infinity);
  }, [xs]);
  
  const maxX = useMemo(() => {
    if (!xs.length) return 1;
    return xs.reduce((max, val) => Math.max(max, val), -Infinity);
  }, [xs]);
  
  const minY = useMemo(() => {
    if (!ys.length) return 0;
    return ys.reduce((min, val) => Math.min(min, val), Infinity);
  }, [ys]);
  
  const maxY = useMemo(() => {
    if (!ys.length) return 1;
    return ys.reduce((max, val) => Math.max(max, val), -Infinity);
  }, [ys]);

  // Detect temperature series (ignore dew point and felt temperature)
  const isFeel = (id: string) => id.toLowerCase().includes("gefühlte temperatur");
  const isDew = (id: string) => id.toLowerCase().includes("taupunkt");
  const isTemp = (id: string) => id.toLowerCase().includes("temperatur") && !isFeel(id) && !isDew(id);

  const tempValues: number[] = useMemo(() => {
    const out: number[] = [];
    for (const s of series) {
      if (!isTemp(s.id)) continue;
      for (const p of s.points) if (Number.isFinite(p.y)) out.push(p.y as number);
    }
    return out;
  }, [series, isTemp]);

  const hasTemperature = tempValues.length > 0;
  const avgTemp = hasTemperature ? tempValues.reduce((a, b) => a + b, 0) / tempValues.length : null;
  const avgTempLabel = useMemo(() => {
    if (!hasTemperature || avgTemp == null || !isFinite(avgTemp)) return null;
    const v = avgTemp.toFixed(1);
    return yUnit ? `${v} ${yUnit}` : v;
  }, [hasTemperature, avgTemp, yUnit]);

  const datasets = useMemo(() => {
    const base = series.map((s) => {
      const data = s.points.filter((p) => Number.isFinite(p.y)).map((p) => ({ x: p.x, y: p.y as number }));
      if (bars) {
        return {
          type: "bar" as const,
          label: s.id,
          data,
          backgroundColor: s.color,
          borderColor: s.color,
          borderWidth: 1,
          barThickness: barWidthPx ?? undefined,
          // for linear x scale, bar thickness is in px
        };
      }
      return {
        type: "line" as const,
        label: s.id,
        data,
        borderColor: s.color,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0,
        fill: false,
      };
    });

    // Helper horizontal lines (avg temp, 0°C, 30°C) as additional line datasets, hidden from legend
    const extras: any[] = [];
    if (!bars && hasTemperature && avgTemp != null && isFinite(avgTemp) && xs.length) {
      extras.push({
        type: "line",
        label: "Durchschnitt",
        data: [
          { x: minX, y: avgTemp },
          { x: maxX, y: avgTemp },
        ],
        borderColor: "#f59e0b",
        borderWidth: 1,
        borderDash: [4, 3],
        pointRadius: 0,
        tension: 0,
        fill: false,
        skipLegend: true,
      });
    }
    if (!bars && hasTemperature && xs.length) {
      extras.push({
        type: "line",
        label: "0°C",
        data: [
          { x: minX, y: 0 },
          { x: maxX, y: 0 },
        ],
        borderColor: "#3b82f6",
        borderWidth: 1,
        borderDash: [3, 3],
        pointRadius: 0,
        tension: 0,
        fill: false,
        skipLegend: true,
      });
    }
    if (!bars && hasTemperature && xs.length) {
      extras.push({
        type: "line",
        label: "30°C",
        data: [
          { x: minX, y: 30 },
          { x: maxX, y: 30 },
        ],
        borderColor: "#ef4444",
        borderWidth: 1,
        borderDash: [3, 3],
        pointRadius: 0,
        tension: 0,
        fill: false,
        skipLegend: true,
      });
    }

    return [...base, ...extras];
  }, [series, bars, barWidthPx, hasTemperature, avgTemp, minX, maxX, xs.length]);

  // Custom plugin to render average temperature label on the right edge above the line
  const avgLabelPlugin = useMemo(() => {
    return {
      id: "avgLabelPlugin",
      afterDraw: (chart: any) => {
        if (!avgTempLabel || bars || !hasTemperature || avgTemp == null) return;
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales?.y) return;
        const y = scales.y.getPixelForValue(avgTemp);
        // ensure within chart area
        if (y < chartArea.top || y > chartArea.bottom) return;
        ctx.save();
        ctx.fillStyle = "#f59e0b"; // same as average line color
        ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        const x = chartArea.left + 4;
        ctx.fillText(avgTempLabel, x, y - 2);
        ctx.restore();
      },
    };
  }, [avgTempLabel, bars, hasTemperature, avgTemp]);

  // Options
  const options = useMemo(() => {
    const opts: any = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "linear",
          ticks: {
            // Optimiert für Tagesanzeige
            maxTicksLimit: 15,
            autoSkip: true,
            major: {
              enabled: true
            },
            callback: (value: any) => {
              const v = typeof value === "number" ? value : Number(value);
              if (Number.isFinite(v)) {
                if (xTickFormatter) return xTickFormatter(v);
                return String(Math.round(v));
              }
              return String(value);
            },
          },
          grid: {
            display: true,
            drawOnChartArea: true,
            drawTicks: true,
            color: 'rgba(200, 200, 200, 0.2)'
          },
          title: xLabel
            ? {
                display: true,
                text: xLabel,
              }
            : undefined,
        },
        y: {
          type: "linear",
          ticks: {
            callback: (val: any) => {
              const v = typeof val === "number" ? val : Number(val);
              return Number.isFinite(v) ? v.toFixed(1) : String(val);
            },
          },
          title: yLabel
            ? {
                display: true,
                text: yLabel,
              }
            : undefined,
        },
      },
      plugins: {
        legend: {
          display: showLegend,
          labels: {
            filter: (legendItem: any, data: any) => {
              const ds = data?.datasets?.[legendItem.datasetIndex] as any;
              return !(ds && ds.skipLegend);
            },
          },
        },
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            drag: { enabled: true, modifierKey: "shift" },
            mode: "x",
          },
          pan: {
            enabled: true,
            mode: "x",
            modifierKey: "ctrl",
          },
          limits: {
            x: { min: minX, max: maxX },
          },
          onZoomComplete: () => setIsZoomed(true),
          onPanComplete: () => setIsZoomed(true),
        },
        tooltip: {
          enabled: showHover !== false,
          mode: "nearest",
          intersect: false,
          callbacks: {
            title: (items: any[]) => {
              if (!items || !items.length) return "";
              const x = items[0]?.parsed?.x;
              if (typeof x === "number") {
                if (hoverTimeFormatter) return hoverTimeFormatter(x);
                if (xTickFormatter) return xTickFormatter(x);
                return String(Math.round(x));
              }
              return "";
            },
            label: (item: any) => {
              const rawY = item?.parsed?.y;
              const val = typeof rawY === "number" ? rawY : Number(rawY);
              const txt = valueFormatter ? valueFormatter(val) : (Number.isFinite(val) ? val.toFixed(2) : String(rawY));
              const unit = valueFormatter ? "" : (yUnit ? ` ${yUnit}` : "");
              return `${item.dataset?.label ?? ""}: ${txt}${unit}`;
            },
          },
        },
        title: {
          display: false,
        },
      },
      elements: {
        point: { radius: bars ? 0 : 0 },
      },
      interaction: {
        mode: "nearest" as const,
        intersect: false,
      },
    };
    return opts;
  }, [xTickFormatter, hoverTimeFormatter, xLabel, yLabel, showLegend, showHover, valueFormatter, yUnit, bars, minX, maxX]);

  // Create/update chart
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    if (chartRef.current) {
      // Update existing chart
      chartRef.current.data.datasets = datasets as any;
      chartRef.current.options = options as any;
      chartRef.current.config.plugins = [avgLabelPlugin];
      chartRef.current.update();
      return;
    }

    chartRef.current = new Chart(ctx, {
      type: bars ? ("bar" as const) : ("line" as const),
      data: {
        datasets: datasets as any,
      },
      options: options as any,
      plugins: [avgLabelPlugin],
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [datasets, options, bars, avgLabelPlugin]);

  return (
    <div
      className="w-full relative"
      style={{ height }}
      onDoubleClick={() => {
        resetZoomSafe();
      }}
      title="Doppelklick zum Zurücksetzen"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          resetZoomSafe();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute right-2 top-0 z-50 pointer-events-auto rounded bg-white/90 dark:bg-neutral-900/90 border border-gray-300 dark:border-neutral-700 px-2 py-1 text-xs shadow"
        style={{ opacity: isZoomed ? 1 : 0.6 }}
        title="Reset zoom (double-click chart also resets)"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 10a8 8 0 10-5.3 7.6" />
        </svg>
        <span className="sr-only">Reset zoom</span>
      </button>
      <canvas ref={canvasRef} />
    </div>
  );
}

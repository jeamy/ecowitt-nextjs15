"use client";

import React, { useEffect, useMemo, useRef } from "react";
import {
  Chart,
  LineElement,
  LineController,
  PointElement,
  LinearScale,
  Tooltip,
  TimeSeriesScale,
} from "chart.js";

// Register needed chart.js components
Chart.register(
  LineElement,
  LineController,
  PointElement,
  LinearScale,
  Tooltip,
  TimeSeriesScale,
);

type DataPoint = {
  x: number; // timestamp
  y: number; // value
};

type Props = {
  data: DataPoint[];
  height?: number;
  unit?: string;
  minValue?: number;
  maxValue?: number;
  minTime?: string;
  maxTime?: string;
  type: 'temperature' | 'humidity';
};

export default function MiniChart({
  data,
  height = 60,
  unit = "",
  minValue,
  maxValue,
  minTime,
  maxTime,
  type
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  const chartColor = type === 'temperature' ? '#ef4444' : '#3b82f6';
  
  // Find min/max values and their times for annotations
  const minMaxData = useMemo(() => {
    if (!data.length) return null;
    
    let min = data[0];
    let max = data[0];
    
    for (const point of data) {
      if (point.y < min.y) min = point;
      if (point.y > max.y) max = point;
    }
    
    return { min, max };
  }, [data]);

  // Calculate Y-axis range with extra padding to prevent clipping of labels
  const yAxisRange = useMemo(() => {
    if (!data.length) return { min: 0, max: 100 };
    
    const values = data.map(d => d.y);
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const range = dataMax - dataMin;
    // Increase padding to 15% to ensure labels don't get clipped
    const padding = Math.max(range * 0.15, 2); // 15% padding or minimum 2 units
    
    return {
      min: dataMin - padding,
      max: dataMax + padding
    };
  }, [data]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        mode: 'nearest' as const,
        intersect: false,
        callbacks: {
          title: (items: any[]) => {
            if (!items || !items.length) return "";
            const x = items[0]?.parsed?.x;
            if (typeof x === "number") {
              return new Date(x).toLocaleTimeString('de-DE', { 
                hour: '2-digit', 
                minute: '2-digit' 
              });
            }
            return "";
          },
          label: (item: any) => {
            const val = item?.parsed?.y;
            return `${val?.toFixed(1)}${unit}`;
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear' as const,
        display: false,
      },
      y: {
        type: 'linear' as const,
        display: false,
        min: yAxisRange.min,
        max: yAxisRange.max,
      },
    },
    elements: {
      point: { radius: 0 },
      line: { tension: 0.1 },
    },
    interaction: {
      mode: 'nearest' as const,
      intersect: false,
    },
  }), [unit, yAxisRange]);

  // Custom plugin to draw min/max annotations
  const annotationPlugin = useMemo(() => ({
    id: 'minMaxAnnotation',
    afterDraw: (chart: any) => {
      if (!minMaxData) return;
      
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales?.x || !scales?.y) return;
      
      ctx.save();
      
      // Draw min point
      const minX = scales.x.getPixelForValue(minMaxData.min.x);
      const minY = scales.y.getPixelForValue(minMaxData.min.y);
      
      if (minX >= chartArea.left && minX <= chartArea.right && 
          minY >= chartArea.top && minY <= chartArea.bottom) {
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(minX, minY, 3, 0, 2 * Math.PI);
        ctx.fill();
        
        // Min label
        ctx.fillStyle = '#3b82f6';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const minText = `${minMaxData.min.y.toFixed(1)}${unit}`;
        ctx.fillText(minText, minX, minY - 5);
        
        // Min time
        ctx.textBaseline = 'top';
        const minTimeText = new Date(minMaxData.min.x).toLocaleTimeString('de-DE', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        ctx.fillText(minTimeText, minX, minY + 5);
      }
      
      // Draw max point
      const maxX = scales.x.getPixelForValue(minMaxData.max.x);
      const maxY = scales.y.getPixelForValue(minMaxData.max.y);
      
      if (maxX >= chartArea.left && maxX <= chartArea.right && 
          maxY >= chartArea.top && maxY <= chartArea.bottom) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(maxX, maxY, 3, 0, 2 * Math.PI);
        ctx.fill();
        
        // Max label - ensure it's not clipped at top
        ctx.fillStyle = '#ef4444';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const maxText = `${minMaxData.max.y.toFixed(1)}${unit}`;
        // Position label below the point if it would be clipped at top
        const labelY = maxY - 5 < chartArea.top + 12 ? maxY + 15 : maxY - 5;
        ctx.fillText(maxText, maxX, labelY);
        
        // Max time
        ctx.textBaseline = 'top';
        const maxTimeText = new Date(minMaxData.max.x).toLocaleTimeString('de-DE', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        ctx.fillText(maxTimeText, maxX, maxY + 5);
      }
      
      ctx.restore();
    },
  }), [minMaxData, unit]);

  const dataset = useMemo(() => ({
    data: data.map(point => ({ x: point.x, y: point.y })),
    borderColor: '#9ca3af',
    backgroundColor: 'transparent',
    borderWidth: 1,
    pointRadius: 0,
    tension: 0.1,
    fill: false,
  }), [data]);

  // Create/update chart
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    if (chartRef.current) {
      chartRef.current.data.datasets = [dataset];
      chartRef.current.options = options as any;
      chartRef.current.config.plugins = [annotationPlugin];
      chartRef.current.update();
      return;
    }

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [dataset],
      },
      options: options as any,
      plugins: [annotationPlugin],
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [dataset, options, annotationPlugin]);

  if (!data.length) {
    return (
      <div 
        className="w-full bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center text-xs text-gray-500"
        style={{ height }}
      >
        Keine Daten
      </div>
    );
  }

  return (
    <div className="w-full" style={{ height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

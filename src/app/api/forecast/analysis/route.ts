import { NextResponse } from "next/server";
import { getDuckConn } from "@/lib/db/duckdb";

export const runtime = "nodejs";

/**
 * API route to get stored forecast analysis
 * GET /api/forecast/analysis?stationId=11035&days=30
 * 
 * Returns daily analysis results from the database
 */
export async function GET(req: Request) {
  console.log('[API] Forecast analysis request received');
  try {
    const { searchParams } = new URL(req.url);
    const stationId = searchParams.get("stationId");
    const days = parseInt(searchParams.get("days") || "30");
    
    console.log('[API] Parameters:', { stationId, days });
    
    if (!stationId) {
      return NextResponse.json({ error: "stationId parameter is required" }, { status: 400 });
    }
    // Query DuckDB for stored analysis
    const conn = await getDuckConn();
    
    // Ensure table exists (no-op if already there)
    try {
      await conn.run(`
        CREATE TABLE IF NOT EXISTS forecast_analysis (
          analysis_date DATE NOT NULL,
          station_id VARCHAR(50) NOT NULL,
          forecast_date DATE NOT NULL,
          source VARCHAR(20) NOT NULL,
          temp_min_error DOUBLE,
          temp_max_error DOUBLE,
          precipitation_error DOUBLE,
          wind_speed_error DOUBLE,
          actual_temp_min DOUBLE,
          actual_temp_max DOUBLE,
          actual_precipitation DOUBLE,
          actual_wind_speed DOUBLE,
          forecast_temp_min DOUBLE,
          forecast_temp_max DOUBLE,
          forecast_precipitation DOUBLE,
          forecast_wind_speed DOUBLE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(analysis_date, station_id, forecast_date, source)
        )
      `);
    } catch (e: any) {
      console.warn('[API] forecast_analysis table check failed:', e?.message || e);
    }
    
    const analysisQuery = `
      SELECT 
        analysis_date,
        forecast_date,
        source,
        temp_min_error,
        temp_max_error,
        precipitation_error,
        wind_speed_error,
        actual_temp_min,
        actual_temp_max,
        actual_precipitation,
        actual_wind_speed,
        forecast_temp_min,
        forecast_temp_max,
        forecast_precipitation,
        forecast_wind_speed
      FROM forecast_analysis
      WHERE station_id = '${stationId}'
        AND analysis_date >= CURRENT_DATE - INTERVAL '${days}' DAYS
      ORDER BY analysis_date DESC, forecast_date DESC, source
    `;
    
    let rows: any[] = [];
    try {
      const reader = await conn.runAndReadAll(analysisQuery);
      rows = reader.getRowObjects();
    } catch (e: any) {
      console.error('[API] Query error:', e?.message || e);
      rows = [];
    }
    
    // Group by analysis_date
    const byDate: Record<string, any> = {};
    for (const row of rows) {
      const date = row.analysis_date;
      if (!byDate[date]) byDate[date] = { date, forecasts: [] as any[] };
      byDate[date].forecasts.push({
        forecastDate: row.forecast_date,
        source: row.source,
        errors: {
          tempMin: row.temp_min_error,
          tempMax: row.temp_max_error,
          precipitation: row.precipitation_error,
          windSpeed: row.wind_speed_error,
        },
        actual: {
          tempMin: row.actual_temp_min,
          tempMax: row.actual_temp_max,
          precipitation: row.actual_precipitation,
          windSpeed: row.actual_wind_speed,
        },
        forecast: {
          tempMin: row.forecast_temp_min,
          tempMax: row.forecast_temp_max,
          precipitation: row.forecast_precipitation,
          windSpeed: row.forecast_wind_speed,
        },
      });
    }
    
    // Aggregate accuracy stats by source
    const sources = ['geosphere', 'openweather', 'meteoblue', 'openmeteo'];
    const accuracyStats: Record<string, any> = {};
    for (const src of sources) {
      const srows = rows.filter(r => r.source === src);
      if (!srows.length) continue;
      const take = (k: string) => srows.map(r => r[k]).filter((v: any) => v !== null && v !== undefined) as number[];
      const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      const rmse = (arr: number[]) => arr.length ? Math.sqrt(arr.reduce((a, b) => a + b*b, 0) / arr.length) : null;
      const eMin = take('temp_min_error');
      const eMax = take('temp_max_error');
      const ePre = take('precipitation_error');
      const eWind = take('wind_speed_error');
      accuracyStats[src] = {
        sampleSize: srows.length,
        tempMin: { mae: mean(eMin), rmse: rmse(eMin) },
        tempMax: { mae: mean(eMax), rmse: rmse(eMax) },
        precipitation: { mae: mean(ePre), rmse: rmse(ePre) },
        windSpeed: { mae: mean(eWind), rmse: rmse(eWind) },
      };
    }
    
    const payload = {
      stationId,
      days,
      dailyAnalysis: Object.values(byDate),
      accuracyStats,
      generated: new Date().toISOString(),
      hasData: rows.length > 0,
    };
    
    return NextResponse.json(payload);
    
  } catch (error: any) {
    console.error("Forecast analysis API error:", error);
    console.error("Error stack:", error.stack);
    return NextResponse.json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

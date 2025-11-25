import { NextResponse } from "next/server";
import { getDuckConn } from "@/lib/db/duckdb";

export const runtime = "nodejs";

/**
 * Debug API to view stored forecast data directly from DuckDB
 * GET /api/dforecast
 * GET /api/dforecast?stationId=11035
 * GET /api/dforecast?stationId=11035&limit=50
 * GET /api/dforecast?table=analysis (to view forecast_analysis instead)
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const stationId = searchParams.get("stationId");
    const limit = parseInt(searchParams.get("limit") || "100");
    const table = searchParams.get("table") || "forecasts"; // 'forecasts' or 'analysis'

    const conn = await getDuckConn();

    let query = "";
    let params: any[] = [];

    if (table === "analysis") {
      // Query forecast_analysis table
      query = `
        SELECT 
          analysis_date,
          station_id,
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
          forecast_wind_speed,
          created_at
        FROM forecast_analysis
        ${stationId ? "WHERE station_id = ?" : ""}
        ORDER BY analysis_date DESC, forecast_date DESC, source
        LIMIT ?
      `;
      params = stationId ? [stationId, limit] : [limit];
    } else {
      // Query forecasts table
      query = `
        SELECT 
          storage_date,
          station_id,
          forecast_date,
          source,
          temp_min,
          temp_max,
          precipitation,
          wind_speed,
          wind_gust,
          created_at
        FROM forecasts
        ${stationId ? "WHERE station_id = ?" : ""}
        ORDER BY storage_date DESC, forecast_date DESC, source
        LIMIT ?
      `;
      params = stationId ? [stationId, limit] : [limit];
    }

    const reader = await conn.runAndReadAll(query, params);
    const rows = reader.getRowObjects();

    // Convert DuckDB values to plain JSON
    const data = rows.map((row: any) => {
      const converted: any = {};
      for (const [key, value] of Object.entries(row)) {
        if (value === null || value === undefined) {
          converted[key] = value;
        } else if (typeof value === 'bigint') {
          converted[key] = Number(value);
        } else if (typeof value === 'object' && value.valueOf) {
          const primitive = value.valueOf();
          converted[key] = typeof primitive === 'bigint' ? Number(primitive) : String(primitive);
        } else {
          converted[key] = value;
        }
      }
      return converted;
    });

    // Get row counts
    const forecastCountQuery = `SELECT COUNT(*) as count FROM forecasts ${stationId ? "WHERE station_id = ?" : ""}`;
    const forecastCountReader = await conn.runAndReadAll(forecastCountQuery, stationId ? [stationId] : []);
    const forecastCount = Number(forecastCountReader.getRowObjects()[0]?.count || 0);

    const analysisCountQuery = `SELECT COUNT(*) as count FROM forecast_analysis ${stationId ? "WHERE station_id = ?" : ""}`;
    const analysisCountReader = await conn.runAndReadAll(analysisCountQuery, stationId ? [stationId] : []);
    const analysisCount = Number(analysisCountReader.getRowObjects()[0]?.count || 0);

    return NextResponse.json({
      table,
      stationId: stationId || "all",
      limit,
      totalRows: table === "analysis" ? analysisCount : forecastCount,
      returnedRows: data.length,
      counts: {
        forecasts: forecastCount,
        analysis: analysisCount
      },
      data
    }, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    });

  } catch (error: any) {
    console.error("DForecast API error:", error);
    return NextResponse.json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

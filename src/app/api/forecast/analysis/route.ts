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

    // Return empty data immediately - no DB needed for now
    // Demo data will be generated in frontend
    console.log('[API] Returning empty data (no analysis stored yet)');
    return NextResponse.json({
      stationId,
      days,
      dailyAnalysis: [],
      accuracyStats: {},
      generated: new Date().toISOString(),
      hasData: false
    });
    
    /* TODO: Re-enable DB query when midnight analysis is working
    const conn = await getDuckConn();
    
    // Create table if not exists
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
      console.log('[API] Table created/verified');
    } catch (tableError: any) {
      console.error('[API] Table creation error:', tableError.message);
      // Continue anyway - table might already exist
    }
    
    // Get stored analysis data
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
      WHERE station_id = ?
        AND analysis_date >= DATE('now', '-${days} days')
      ORDER BY analysis_date DESC, forecast_date DESC, source
    `;
    
    // Use simple string interpolation for DuckDB query
    const finalQuery = analysisQuery.replace('?', `'${stationId}'`);
    console.log('[API] Running analysis query:', finalQuery);
    
    let analysisData: any = [];
    try {
      const analysisReader = await conn.runAndReadAll(finalQuery);
      analysisData = analysisReader.getRowObjects();
      console.log('[API] Query returned', analysisData.length, 'rows');
    } catch (queryError: any) {
      console.error('[API] Query error:', queryError.message);
      // Return empty data if query fails (table might not exist yet)
      analysisData = [];
    }
    
    // Group by analysis_date
    const dailyAnalysis: Record<string, any> = {};
    
    analysisData.forEach((row: any) => {
      const date = row.analysis_date;
      if (!dailyAnalysis[date]) {
        dailyAnalysis[date] = {
          date,
          forecasts: []
        };
      }
      
      dailyAnalysis[date].forecasts.push({
        forecastDate: row.forecast_date,
        source: row.source,
        errors: {
          tempMin: row.temp_min_error,
          tempMax: row.temp_max_error,
          precipitation: row.precipitation_error,
          windSpeed: row.wind_speed_error
        },
        actual: {
          tempMin: row.actual_temp_min,
          tempMax: row.actual_temp_max,
          precipitation: row.actual_precipitation,
          windSpeed: row.actual_wind_speed
        },
        forecast: {
          tempMin: row.forecast_temp_min,
          tempMax: row.forecast_temp_max,
          precipitation: row.forecast_precipitation,
          windSpeed: row.forecast_wind_speed
        }
      });
    });
    
    // Calculate aggregate statistics per source
    const sources = ['geosphere', 'openweather', 'meteoblue', 'openmeteo'];
    const accuracyStats: Record<string, any> = {};
    
    sources.forEach(source => {
      const sourceData = analysisData.filter((row: any) => row.source === source);
      
      if (sourceData.length > 0) {
        const tempMinErrors = sourceData.map((r: any) => r.temp_min_error).filter((e: any) => e !== null);
        const tempMaxErrors = sourceData.map((r: any) => r.temp_max_error).filter((e: any) => e !== null);
        const precipErrors = sourceData.map((r: any) => r.precipitation_error).filter((e: any) => e !== null);
        const windErrors = sourceData.map((r: any) => r.wind_speed_error).filter((e: any) => e !== null);
        
        accuracyStats[source] = {
          sampleSize: sourceData.length,
          tempMin: {
            mae: tempMinErrors.length > 0 ? tempMinErrors.reduce((sum: number, e: number) => sum + e, 0) / tempMinErrors.length : null,
            rmse: tempMinErrors.length > 0 ? Math.sqrt(tempMinErrors.reduce((sum: number, e: number) => sum + e*e, 0) / tempMinErrors.length) : null
          },
          tempMax: {
            mae: tempMaxErrors.length > 0 ? tempMaxErrors.reduce((sum: number, e: number) => sum + e, 0) / tempMaxErrors.length : null,
            rmse: tempMaxErrors.length > 0 ? Math.sqrt(tempMaxErrors.reduce((sum: number, e: number) => sum + e*e, 0) / tempMaxErrors.length) : null
          },
          precipitation: {
            mae: precipErrors.length > 0 ? precipErrors.reduce((sum: number, e: number) => sum + e, 0) / precipErrors.length : null,
            rmse: precipErrors.length > 0 ? Math.sqrt(precipErrors.reduce((sum: number, e: number) => sum + e*e, 0) / precipErrors.length) : null
          },
          windSpeed: {
            mae: windErrors.length > 0 ? windErrors.reduce((sum: number, e: number) => sum + e, 0) / windErrors.length : null,
            rmse: windErrors.length > 0 ? Math.sqrt(windErrors.reduce((sum: number, e: number) => sum + e*e, 0) / windErrors.length) : null
          }
        };
      }
    });
    
    // Return empty arrays if no data
    const response = {
      stationId,
      days,
      dailyAnalysis: Object.values(dailyAnalysis),
      accuracyStats,
      generated: new Date().toISOString(),
      hasData: analysisData.length > 0
    };
    
    console.log('[API] Returning response with', Object.values(dailyAnalysis).length, 'daily entries');
    return NextResponse.json(response);
    */
    
  } catch (error: any) {
    console.error("Forecast analysis API error:", error);
    console.error("Error stack:", error.stack);
    return NextResponse.json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

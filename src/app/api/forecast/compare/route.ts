import { NextResponse } from "next/server";
import { getDuckConn } from "@/lib/db/duckdb";

export const runtime = "nodejs";

/**
 * API route to compare stored forecasts with actual weather data
 * GET /api/forecast/compare?stationId=11035&days=30
 * 
 * Returns accuracy analysis for each forecast source
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const stationId = searchParams.get("stationId");
    const days = parseInt(searchParams.get("days") || "30");
    
    if (!stationId) {
      return NextResponse.json({ error: "stationId parameter is required" }, { status: 400 });
    }

    const conn = await getDuckConn();
    
    // Get comparison data for the last N days
    const comparisonData = await getForecastComparison(conn, stationId, days);
    
    return NextResponse.json({
      stationId,
      days,
      data: comparisonData,
      generated: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error("Forecast comparison error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Get forecast vs actual data comparison
 */
async function getForecastComparison(conn: any, stationId: string, days: number) {
  // Get actual weather data from the main table
  const actualQuery = `
    SELECT 
      DATE(time) as date,
      MIN(CAST(CASE WHEN tempf LIKE '%[^0-9.]%' THEN NULL ELSE tempf END AS DOUBLE)) as temp_min_f,
      MAX(CAST(CASE WHEN tempf LIKE '%[^0-9.]%' THEN NULL ELSE tempf END AS DOUBLE)) as temp_max_f,
      SUM(CAST(CASE WHEN rain_rate_in LIKE '%[^0-9.]%' THEN NULL ELSE rain_rate_in END AS DOUBLE)) as precipitation_in,
      AVG(CAST(CASE WHEN windspeedmph LIKE '%[^0-9.]%' THEN NULL ELSE windspeedmph END AS DOUBLE)) as wind_speed_mph
    FROM weather_data 
    WHERE station_id = ? 
      AND DATE(time) >= DATE('now', '-${days} days')
      AND DATE(time) < DATE('now')
    GROUP BY DATE(time)
    ORDER BY date DESC
  `;
  
  const actualData = await conn.all(actualQuery, [stationId]);
  
  // Convert units to match forecast units (°C, mm, km/h)
  const actualDataConverted = actualData.map((row: any) => ({
    date: row.date,
    tempMin: row.temp_min_f !== null ? (row.temp_min_f - 32) * 5/9 : null,
    tempMax: row.temp_max_f !== null ? (row.temp_max_f - 32) * 5/9 : null,
    precipitation: row.precipitation_in !== null ? row.precipitation_in * 25.4 : null,
    windSpeed: row.wind_speed_mph !== null ? row.wind_speed_mph * 1.60934 : null
  }));
  
  // Get stored forecasts for comparison
  const forecastQuery = `
    SELECT 
      forecast_date,
      source,
      temp_min,
      temp_max,
      precipitation,
      wind_speed
    FROM forecasts 
    WHERE station_id = ? 
      AND forecast_date >= DATE('now', '-${days} days')
      AND forecast_date < DATE('now')
    ORDER BY forecast_date DESC, source
  `;
  
  const forecastData = await conn.all(forecastQuery, [stationId]);
  
  // Group forecasts by date and source
  const forecastsByDate: Record<string, Record<string, any>> = {};
  
  forecastData.forEach((row: any) => {
    const date = row.forecast_date;
    if (!forecastsByDate[date]) {
      forecastsByDate[date] = {};
    }
    forecastsByDate[date][row.source] = row;
  });
  
  // Compare actual vs forecast data
  const comparisons = [];
  
  for (const actual of actualDataConverted) {
    const date = actual.date;
    const forecasts = forecastsByDate[date];
    
    if (forecasts) {
      const comparison: any = {
        date,
        actual: {
          tempMin: actual.tempMin,
          tempMax: actual.tempMax,
          precipitation: actual.precipitation,
          windSpeed: actual.windSpeed
        },
        forecasts: {},
        errors: {}
      };
      
      // Compare each forecast source
      ['geosphere', 'openweather', 'meteoblue', 'openmeteo'].forEach(source => {
        if (forecasts[source]) {
          const forecast = forecasts[source];
          comparison.forecasts[source] = {
            tempMin: forecast.temp_min,
            tempMax: forecast.temp_max,
            precipitation: forecast.precipitation,
            windSpeed: forecast.wind_speed
          };
          
          // Calculate errors
          comparison.errors[source] = {
            tempMinError: calculateError(actual.tempMin, forecast.temp_min),
            tempMaxError: calculateError(actual.tempMax, forecast.temp_max),
            precipitationError: calculateError(actual.precipitation, forecast.precipitation),
            windSpeedError: calculateError(actual.windSpeed, forecast.wind_speed)
          };
        }
      });
      
      comparisons.push(comparison);
    }
  }
  
  // Calculate overall accuracy statistics
  const accuracyStats = calculateAccuracyStats(comparisons);
  
  return {
    dailyComparisons: comparisons,
    accuracyStats
  };
}

/**
 * Calculate error between actual and forecast values
 */
function calculateError(actual: number | null, forecast: number | null): number | null {
  if (actual === null || forecast === null) return null;
  return Math.abs(actual - forecast);
}

/**
 * Calculate overall accuracy statistics for each forecast source
 */
function calculateAccuracyStats(comparisons: any[]) {
  const sources = ['geosphere', 'openweather', 'meteoblue', 'openmeteo'];
  const stats: Record<string, any> = {};
  
  sources.forEach(source => {
    const errors = comparisons
      .map(c => c.errors[source])
      .filter(e => e !== undefined);
    
    if (errors.length > 0) {
      const tempMinErrors = errors.map(e => e.tempMinError).filter(e => e !== null);
      const tempMaxErrors = errors.map(e => e.tempMaxError).filter(e => e !== null);
      const precipitationErrors = errors.map(e => e.precipitationError).filter(e => e !== null);
      const windSpeedErrors = errors.map(e => e.windSpeedError).filter(e => e !== null);
      
      stats[source] = {
        sampleSize: errors.length,
        tempMin: {
          mae: tempMinErrors.length > 0 ? tempMinErrors.reduce((sum, e) => sum + e, 0) / tempMinErrors.length : null,
          rmse: tempMinErrors.length > 0 ? Math.sqrt(tempMinErrors.reduce((sum, e) => sum + e*e, 0) / tempMinErrors.length) : null
        },
        tempMax: {
          mae: tempMaxErrors.length > 0 ? tempMaxErrors.reduce((sum, e) => sum + e, 0) / tempMaxErrors.length : null,
          rmse: tempMaxErrors.length > 0 ? Math.sqrt(tempMaxErrors.reduce((sum, e) => sum + e*e, 0) / tempMaxErrors.length) : null
        },
        precipitation: {
          mae: precipitationErrors.length > 0 ? precipitationErrors.reduce((sum, e) => sum + e, 0) / precipitationErrors.length : null,
          rmse: precipitationErrors.length > 0 ? Math.sqrt(precipitationErrors.reduce((sum, e) => sum + e*e, 0) / precipitationErrors.length) : null
        },
        windSpeed: {
          mae: windSpeedErrors.length > 0 ? windSpeedErrors.reduce((sum, e) => sum + e, 0) / windSpeedErrors.length : null,
          rmse: windSpeedErrors.length > 0 ? Math.sqrt(windSpeedErrors.reduce((sum, e) => sum + e*e, 0) / windSpeedErrors.length) : null
        }
      };
    }
  });
  
  return stats;
}

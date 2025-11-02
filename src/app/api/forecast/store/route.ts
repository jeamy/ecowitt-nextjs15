import { NextResponse } from "next/server";
import { getDuckConn } from "@/lib/db/duckdb";

export const runtime = "nodejs";

/**
 * API route to store forecast data from all sources daily
 * POST /api/forecast/store
 * Body: { stationId: string }
 * 
 * This endpoint fetches forecasts from all 4 sources and stores them in DuckDB
 * for later comparison with actual weather data
 */
export async function POST(req: Request) {
  try {
    const { stationId } = await req.json();
    
    if (!stationId) {
      return NextResponse.json({ error: "stationId is required" }, { status: 400 });
    }

    // Fetch forecasts from all 4 sources
    const forecastPromises = [
      fetchForecastData('forecast', stationId),
      fetchForecastData('openweather', stationId),
      fetchForecastData('meteoblue', stationId),
      fetchForecastData('openmeteo', stationId)
    ];

    const [geosphereData, openweatherData, meteoblueData, openmeteoData] = await Promise.allSettled(forecastPromises);
    
    // Store in DuckDB
    const conn = await getDuckConn();
    const storageDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Create forecast table if not exists
    await conn.run(`
      CREATE TABLE IF NOT EXISTS forecasts (
        id INTEGER PRIMARY KEY,
        storage_date DATE NOT NULL,
        station_id VARCHAR(50) NOT NULL,
        forecast_date DATE NOT NULL,
        source VARCHAR(20) NOT NULL,
        temp_min DOUBLE,
        temp_max DOUBLE,
        precipitation DOUBLE,
        wind_speed DOUBLE,
        wind_gust DOUBLE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(storage_date, station_id, forecast_date, source)
      )
    `);

    // Insert forecast data from each source
    const insertPromises = [];
    
    // Process Geosphere forecast
    if (geosphereData.status === 'fulfilled' && geosphereData.value.forecast) {
      const dailyData = aggregateHourlyToDaily(geosphereData.value.forecast);
      for (const day of dailyData) {
        insertPromises.push(
          conn.run(`
            INSERT OR REPLACE INTO forecasts 
            (storage_date, station_id, forecast_date, source, temp_min, temp_max, precipitation, wind_speed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [storageDate, stationId, day.date, 'geosphere', day.tempMin, day.tempMax, day.precipitation, day.windSpeed])
        );
      }
    }

    // Process OpenWeatherMap forecast
    if (openweatherData.status === 'fulfilled' && openweatherData.value.forecast) {
      for (const day of openweatherData.value.forecast) {
        insertPromises.push(
          conn.run(`
            INSERT OR REPLACE INTO forecasts 
            (storage_date, station_id, forecast_date, source, temp_min, temp_max, precipitation, wind_speed, wind_gust)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [storageDate, stationId, day.date, 'openweather', day.tempMin, day.tempMax, day.precipitation, day.windSpeed, day.windGust])
        );
      }
    }

    // Process Meteoblue forecast
    if (meteoblueData.status === 'fulfilled' && meteoblueData.value.forecast) {
      for (const day of meteoblueData.value.forecast) {
        insertPromises.push(
          conn.run(`
            INSERT OR REPLACE INTO forecasts 
            (storage_date, station_id, forecast_date, source, temp_min, temp_max, precipitation, wind_speed, wind_gust)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [storageDate, stationId, day.date, 'meteoblue', day.tempMin, day.tempMax, day.precipitation, day.windSpeed, day.windGust])
        );
      }
    }

    // Process Open-Meteo forecast
    if (openmeteoData.status === 'fulfilled' && openmeteoData.value.forecast) {
      for (const day of openmeteoData.value.forecast) {
        insertPromises.push(
          conn.run(`
            INSERT OR REPLACE INTO forecasts 
            (storage_date, station_id, forecast_date, source, temp_min, temp_max, precipitation, wind_speed, wind_gust)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [storageDate, stationId, day.date, 'openmeteo', day.tempMin, day.tempMax, day.precipitation, day.windSpeed, day.windGust])
        );
      }
    }

    await Promise.all(insertPromises);

    return NextResponse.json({ 
      success: true, 
      message: `Stored forecasts for station ${stationId} on ${storageDate}`,
      sources: {
        geosphere: geosphereData.status === 'fulfilled',
        openweather: openweatherData.status === 'fulfilled', 
        meteoblue: meteoblueData.status === 'fulfilled',
        openmeteo: openmeteoData.status === 'fulfilled'
      }
    });

  } catch (error: any) {
    console.error("Forecast storage error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Fetch forecast data from existing forecast API
 */
async function fetchForecastData(action: string, stationId: string) {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const response = await fetch(`${baseUrl}/api/forecast?action=${action}&stationId=${stationId}`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch ${action} forecast: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Aggregate hourly forecast data to daily values (for Geosphere)
 */
function aggregateHourlyToDaily(hourlyData: any[]): any[] {
  const dailyMap: Record<string, any[]> = {};
  
  hourlyData.forEach(item => {
    const date = new Date(item.time).toISOString().split('T')[0];
    if (!dailyMap[date]) {
      dailyMap[date] = [];
    }
    dailyMap[date].push(item);
  });

  return Object.entries(dailyMap).map(([date, items]) => {
    const temps = items.map(i => i.temperature).filter(t => t !== null);
    const precipitations = items.map(i => i.precipitation).filter(p => p !== null);
    const windSpeeds = items.map(i => i.windSpeed).filter(w => w !== null);
    
    return {
      date,
      tempMin: temps.length > 0 ? Math.min(...temps) : null,
      tempMax: temps.length > 0 ? Math.max(...temps) : null,
      precipitation: precipitations.length > 0 ? precipitations.reduce((sum, p) => sum + p, 0) : 0,
      windSpeed: windSpeeds.length > 0 ? windSpeeds.reduce((sum, w) => sum + w, 0) / windSpeeds.length : null
    };
  });
}

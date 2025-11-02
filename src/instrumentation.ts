import "server-only";

// Avoid multiple intervals in dev/HMR
declare global {
  // eslint-disable-next-line no-var
  var __rtPoller: NodeJS.Timer | undefined;
  // eslint-disable-next-line no-var
  var __statsPoller: NodeJS.Timer | undefined;
  // eslint-disable-next-line no-var
  var __forecastPoller: NodeJS.Timer | undefined;
}

/**
 * This function is registered to run when the Next.js server starts.
 * It sets up a background poller to periodically fetch real-time data from the weather station
 * and archive it. This ensures that the latest data is always available in a cache,
 * even if a user has not recently visited the site.
 *
 * It runs only on the Node.js runtime, not on the Edge runtime.
 * A global variable is used to prevent multiple pollers from running in development due to HMR.
 */
export async function register() {
  // Only run on Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "edge") return;

  const msRaw = process.env.RT_REFRESH_MS ?? process.env.NEXT_PUBLIC_RT_REFRESH_MS ?? "300000"; // default 5 min
  const intervalMs = Math.max(10_000, Number(msRaw) || 300_000); // min 10s safety

  if (!global.__rtPoller) {
    console.log(`[rt] Server poller active: every ${intervalMs} ms`);
    // Immediate run to populate cache on startup
    (async () => {
      try {
        const { fetchAndArchive } = await import("@/lib/realtimeArchiver");
        await fetchAndArchive(true);
      } catch (e) {
        const msg = (e as any)?.message ? String((e as any).message) : String(e);
        console.log(`[rt] update not ok: ${msg}`);
        console.error("[rt] background fetch/archive failed:", e);
        try {
          const { setLastRealtime } = await import("@/lib/realtimeArchiver");
          await setLastRealtime({ ok: false, updatedAt: new Date().toISOString(), error: msg });
        } catch {}
      }
    })();

    global.__rtPoller = setInterval(async () => {
      try {
        const { fetchAndArchive } = await import("@/lib/realtimeArchiver");
        await fetchAndArchive(true);
      } catch (e) {
        const msg = (e as any)?.message ? String((e as any).message) : String(e);
        console.log(`[rt] update not ok: ${msg}`);
        console.error("[rt] background fetch/archive failed:", e);
        try {
          const { setLastRealtime } = await import("@/lib/realtimeArchiver");
          await setLastRealtime({ ok: false, updatedAt: new Date().toISOString(), error: msg });
        } catch {}
      }
    }, intervalMs);
  }

  // Schedule a daily statistics recompute and warm cache on startup
  const statsIntervalMs = 24 * 60 * 60 * 1000; // 24h
  if (!global.__statsPoller) {
    console.log(`[stats] Daily statistics precompute enabled (every ${statsIntervalMs} ms)`);
    // Warm on startup
    (async () => {
      try {
        const { updateStatisticsIfNeeded } = await import("@/lib/statistics");
        await updateStatisticsIfNeeded();
        console.log("[stats] Warmed statistics cache on startup");
      } catch (e) {
        console.error("[stats] Warmup failed:", e);
      }
    })();

    global.__statsPoller = setInterval(async () => {
      try {
        const { updateStatistics } = await import("@/lib/statistics");
        await updateStatistics();
        console.log("[stats] Recomputed statistics");
      } catch (e) {
        console.error("[stats] Background recompute failed:", e);
      }
    }, statsIntervalMs);
  }

  // Schedule daily forecast storage at midnight
  if (!global.__forecastPoller) {
    const stationId = process.env.FORECAST_STATION_ID || "11035"; // Default: Wien Hohe Warte
    console.log(`[forecast] Daily forecast storage enabled for station ${stationId} (runs at midnight only)`);

    // Calculate milliseconds until next midnight
    const scheduleNextMidnight = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const msUntilMidnight = tomorrow.getTime() - now.getTime();
      
      global.__forecastPoller = setTimeout(async () => {
        try {
          await storeForecastForStation(stationId);
          await calculateAndStoreDailyAnalysis(stationId);
          console.log(`[forecast] Stored forecasts and analysis for station ${stationId} at midnight`);
        } catch (e) {
          console.error("[forecast] Midnight storage failed:", e);
        }
        
        // Schedule next midnight
        scheduleNextMidnight();
      }, msUntilMidnight);
      
      console.log(`[forecast] Next run scheduled in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);
    };
    
    scheduleNextMidnight();
  }
}

/**
 * Store forecasts for a single station by calling the internal store API
 */
async function storeForecastForStation(stationId: string) {
  try {
    const { getDuckConn } = await import("@/lib/db/duckdb");
    const conn = await getDuckConn();
    const storageDate = new Date().toISOString().split('T')[0];
    
    // Create forecast table if not exists
    await conn.run(`
      CREATE TABLE IF NOT EXISTS forecasts (
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
        PRIMARY KEY(storage_date, station_id, forecast_date, source)
      )
    `);

    // Fetch forecasts from all 4 sources
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const sources = ['forecast', 'openweather', 'meteoblue', 'openmeteo'];
    
    for (const source of sources) {
      try {
        const response = await fetch(`${baseUrl}/api/forecast?action=${source}&stationId=${stationId}`);
        if (!response.ok) continue;
        
        const data = await response.json();
        const forecastData = data.forecast || [];
        
        // Process based on source format
        if (source === 'forecast') {
          // Geosphere: aggregate hourly to daily
          const dailyData = aggregateHourlyToDaily(forecastData);
          for (const day of dailyData) {
            await conn.run(`
              INSERT INTO forecasts 
              (storage_date, station_id, forecast_date, source, temp_min, temp_max, precipitation, wind_speed)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (storage_date, station_id, forecast_date, source)
              DO UPDATE SET temp_min = EXCLUDED.temp_min, temp_max = EXCLUDED.temp_max, 
                            precipitation = EXCLUDED.precipitation, wind_speed = EXCLUDED.wind_speed
            `, [storageDate, stationId, day.date, 'geosphere', day.tempMin, day.tempMax, day.precipitation, day.windSpeed]);
          }
        } else {
          // Other sources: already daily format
          for (const day of forecastData) {
            await conn.run(`
              INSERT INTO forecasts 
              (storage_date, station_id, forecast_date, source, temp_min, temp_max, precipitation, wind_speed, wind_gust)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (storage_date, station_id, forecast_date, source)
              DO UPDATE SET temp_min = EXCLUDED.temp_min, temp_max = EXCLUDED.temp_max, 
                            precipitation = EXCLUDED.precipitation, wind_speed = EXCLUDED.wind_speed,
                            wind_gust = EXCLUDED.wind_gust
            `, [storageDate, stationId, day.date, source, day.tempMin, day.tempMax, day.precipitation, day.windSpeed, day.windGust]);
          }
        }
      } catch (e) {
        console.error(`[forecast] Failed to store ${source}:`, e);
      }
    }
  } catch (e) {
    console.error("[forecast] Storage failed:", e);
    throw e;
  }
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

/**
 * Calculate and store daily forecast analysis
 * Compares yesterday's forecasts with actual weather data
 */
async function calculateAndStoreDailyAnalysis(stationId: string) {
  try {
    const { getDuckConn } = await import("@/lib/db/duckdb");
    const conn = await getDuckConn();
    
    // Create analysis table if not exists
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
    
    // Analyze yesterday's forecasts
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    // Get actual weather data for yesterday
    const actualQuery = `
      SELECT 
        DATE(time) as date,
        MIN(CAST(CASE WHEN tempf LIKE '%[^0-9.-]%' THEN NULL ELSE tempf END AS DOUBLE)) as temp_min_f,
        MAX(CAST(CASE WHEN tempf LIKE '%[^0-9.-]%' THEN NULL ELSE tempf END AS DOUBLE)) as temp_max_f,
        SUM(CAST(CASE WHEN rain_rate_in LIKE '%[^0-9.-]%' THEN NULL ELSE rain_rate_in END AS DOUBLE)) as precipitation_in,
        AVG(CAST(CASE WHEN windspeedmph LIKE '%[^0-9.-]%' THEN NULL ELSE windspeedmph END AS DOUBLE)) as wind_speed_mph
      FROM weather_data 
      WHERE DATE(time) = ?
      GROUP BY DATE(time)
    `;
    
    const actualReader = await conn.runAndReadAll(actualQuery.replace('?', `'${yesterdayStr}'`));
    const actualData: any = actualReader.getRowObjects();
    
    if (actualData.length === 0) {
      console.log(`[forecast] No actual weather data for ${yesterdayStr}`);
      return;
    }
    
    const actual = actualData[0];
    const actualConverted = {
      tempMin: actual.temp_min_f !== null ? (actual.temp_min_f - 32) * 5/9 : null,
      tempMax: actual.temp_max_f !== null ? (actual.temp_max_f - 32) * 5/9 : null,
      precipitation: actual.precipitation_in !== null ? actual.precipitation_in * 25.4 : null,
      windSpeed: actual.wind_speed_mph !== null ? actual.wind_speed_mph * 1.60934 : null
    };
    
    // Get forecasts that were made for yesterday
    const forecastQuery = `
      SELECT 
        storage_date,
        forecast_date,
        source,
        temp_min,
        temp_max,
        precipitation,
        wind_speed
      FROM forecasts 
      WHERE station_id = ? 
        AND forecast_date = ?
        AND storage_date < ?
      ORDER BY storage_date DESC, source
    `;
    
    const forecastReader = await conn.runAndReadAll(
      forecastQuery
        .replace('?', `'${stationId}'`)
        .replace('?', `'${yesterdayStr}'`)
        .replace('?', `'${yesterdayStr}'`)
    );
    const forecasts: any = forecastReader.getRowObjects();
    
    // Store analysis for each forecast
    for (const forecast of forecasts) {
      const tempMinError = actualConverted.tempMin !== null && forecast.temp_min !== null 
        ? Math.abs(actualConverted.tempMin - forecast.temp_min) : null;
      const tempMaxError = actualConverted.tempMax !== null && forecast.temp_max !== null 
        ? Math.abs(actualConverted.tempMax - forecast.temp_max) : null;
      const precipitationError = actualConverted.precipitation !== null && forecast.precipitation !== null 
        ? Math.abs(actualConverted.precipitation - forecast.precipitation) : null;
      const windSpeedError = actualConverted.windSpeed !== null && forecast.wind_speed !== null 
        ? Math.abs(actualConverted.windSpeed - forecast.wind_speed) : null;
      
      await conn.run(`
        INSERT INTO forecast_analysis 
        (analysis_date, station_id, forecast_date, source, 
         temp_min_error, temp_max_error, precipitation_error, wind_speed_error,
         actual_temp_min, actual_temp_max, actual_precipitation, actual_wind_speed,
         forecast_temp_min, forecast_temp_max, forecast_precipitation, forecast_wind_speed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (analysis_date, station_id, forecast_date, source)
        DO UPDATE SET 
          temp_min_error = EXCLUDED.temp_min_error,
          temp_max_error = EXCLUDED.temp_max_error,
          precipitation_error = EXCLUDED.precipitation_error,
          wind_speed_error = EXCLUDED.wind_speed_error,
          actual_temp_min = EXCLUDED.actual_temp_min,
          actual_temp_max = EXCLUDED.actual_temp_max,
          actual_precipitation = EXCLUDED.actual_precipitation,
          actual_wind_speed = EXCLUDED.actual_wind_speed,
          forecast_temp_min = EXCLUDED.forecast_temp_min,
          forecast_temp_max = EXCLUDED.forecast_temp_max,
          forecast_precipitation = EXCLUDED.forecast_precipitation,
          forecast_wind_speed = EXCLUDED.forecast_wind_speed
      `, [
        yesterdayStr, stationId, yesterdayStr, forecast.source,
        tempMinError, tempMaxError, precipitationError, windSpeedError,
        actualConverted.tempMin, actualConverted.tempMax, actualConverted.precipitation, actualConverted.windSpeed,
        forecast.temp_min, forecast.temp_max, forecast.precipitation, forecast.wind_speed
      ]);
    }
    
    console.log(`[forecast] Stored analysis for ${forecasts.length} forecasts for ${yesterdayStr}`);
  } catch (e) {
    console.error("[forecast] Analysis calculation failed:", e);
    throw e;
  }
}

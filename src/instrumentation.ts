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
    const stationSetting = process.env.FORECAST_STATION_ID || "11035"; // or 'ALL'
    console.log(`[forecast] Daily forecast storage enabled for ${stationSetting === 'ALL' ? 'ALL stations' : `station ${stationSetting}`} (runs at midnight only)`);

    // Calculate milliseconds until next midnight
    const scheduleNextMidnight = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const msUntilMidnight = tomorrow.getTime() - now.getTime();
      
      global.__forecastPoller = setTimeout(async () => {
        try {
          // Resolve station list
          let stationIds: string[] = [];
          if (stationSetting === 'ALL') {
            try {
              // Fetch station list directly from Geosphere API
              const res = await fetch('https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min/metadata');
              if (res.ok) {
                const data = await res.json();
                stationIds = (data.stations || []).map((s: any) => String(s.id));
              }
            } catch (e) {
              console.error('[forecast] Failed to load station list for ALL:', e);
            }
          }
          if (!stationIds.length) stationIds = [String(stationSetting)];

          for (const sid of stationIds) {
            try {
              await storeForecastForStation(sid);
              await calculateAndStoreDailyAnalysis(sid);
              console.log(`[forecast] Stored forecasts and analysis for station ${sid} at midnight`);
            } catch (e) {
              console.error(`[forecast] Processing failed for station ${sid}:`, e);
            }
            // Small delay to be gentle on upstream APIs
            await new Promise(r => setTimeout(r, 250));
          }
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
export async function storeForecastForStation(stationId: string) {
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

    // Get station coordinates first
    const stationsResponse = await fetch('https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min/metadata');
    const stationsData = await stationsResponse.json();
    const station = stationsData.stations.find((s: any) => s.id === stationId);
    
    if (!station) {
      console.error(`[forecast] Station ${stationId} not found`);
      return;
    }
    
    const lat = station.lat;
    const lon = station.lon;
    
    // Fetch forecasts from all 4 sources - DIRECTLY from external APIs
    const sources = ['geosphere', 'openweather', 'meteoblue', 'openmeteo'];
    
    for (const sourceName of sources) {
      try {
        let forecastData: any[] = [];
        
        // Fetch from external API directly
        if (sourceName === 'geosphere') {
          const url = `https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/ensemble-v1-1h-2500m?parameters=t2m_p50,rr_p50,u10m_p50,v10m_p50&station_ids=${stationId}`;
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = await res.json();
          
          // Process Geosphere hourly data
          if (data && data.features && data.features.length > 0 && data.timestamps) {
            const feature = data.features[0];
            if (feature.properties && feature.properties.parameters) {
              const tempData = feature.properties.parameters.t2m_p50?.data || [];
              const precipData = feature.properties.parameters.rr_p50?.data || [];
              const uWindData = feature.properties.parameters.u10m_p50?.data || [];
              const vWindData = feature.properties.parameters.v10m_p50?.data || [];
              const timestamps = data.timestamps || [];
              
              tempData.forEach((tempValue: any, index: number) => {
                if (index < timestamps.length) {
                  const time = timestamps[index];
                  const precipValue = index < precipData.length ? precipData[index] : null;
                  const uWind = index < uWindData.length ? uWindData[index] : null;
                  const vWind = index < vWindData.length ? vWindData[index] : null;
                  let windSpeed = null;
                  if (uWind !== null && vWind !== null) {
                    windSpeed = Math.sqrt(uWind * uWind + vWind * vWind) * 3.6;
                  }
                  forecastData.push({
                    time,
                    temperature: tempValue !== null ? parseFloat(tempValue) : null,
                    precipitation: precipValue !== null ? parseFloat(precipValue) : null,
                    windSpeed: windSpeed !== null ? parseFloat(windSpeed.toFixed(1)) : null
                  });
                }
              });
            }
          }
          
          // Aggregate hourly to daily
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
          
        } else if (sourceName === 'openweather') {
          const apiKey = process.env.OPENWEATHER_API_KEY;
          if (!apiKey) continue;
          
          const res = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`);
          if (!res.ok) continue;
          const data = await res.json();
          
          // Process OpenWeather 3-hour data to daily
          const dailyMap: Record<string, any[]> = {};
          data.list?.forEach((item: any) => {
            const date = new Date(item.dt * 1000);
            const dateKey = date.toISOString().split('T')[0];
            if (!dailyMap[dateKey]) dailyMap[dateKey] = [];
            dailyMap[dateKey].push(item);
          });
          
          forecastData = Object.entries(dailyMap).map(([dateKey, items]) => {
            const temps = items.map((i: any) => i.main.temp);
            const tempMins = items.map((i: any) => i.main.temp_min);
            const tempMaxs = items.map((i: any) => i.main.temp_max);
            const precipitations = items.map((i: any) => (i.rain?.['3h'] ?? 0) + (i.snow?.['3h'] ?? 0));
            const windSpeeds = items.map((i: any) => i.wind.speed);
            const windGusts = items.map((i: any) => i.wind.gust ?? 0);
            
            return {
              date: new Date(dateKey + 'T12:00:00').toISOString(),
              tempMin: Math.min(...tempMins),
              tempMax: Math.max(...tempMaxs),
              precipitation: precipitations.reduce((sum: number, p: number) => sum + p, 0),
              windSpeed: windSpeeds.reduce((sum: number, w: number) => sum + w, 0) / windSpeeds.length * 3.6,
              windGust: Math.max(...windGusts) * 3.6
            };
          });
          
          for (const day of forecastData) {
            await conn.run(`
              INSERT INTO forecasts 
              (storage_date, station_id, forecast_date, source, temp_min, temp_max, precipitation, wind_speed, wind_gust)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (storage_date, station_id, forecast_date, source)
              DO UPDATE SET temp_min = EXCLUDED.temp_min, temp_max = EXCLUDED.temp_max, 
                            precipitation = EXCLUDED.precipitation, wind_speed = EXCLUDED.wind_speed,
                            wind_gust = EXCLUDED.wind_gust
            `, [storageDate, stationId, day.date, 'openweather', day.tempMin, day.tempMax, day.precipitation, day.windSpeed, day.windGust]);
          }
          
        } else if (sourceName === 'meteoblue') {
          const apiKey = process.env.METEOBLUE_API_KEY;
          if (!apiKey) continue;
          
          const res = await fetch(`https://my.meteoblue.com/packages/basic-day?apikey=${apiKey}&lat=${lat}&lon=${lon}&asl=500&format=json&temperature=C&windspeed=kmh&precipitationamount=mm&timeformat=iso8601`);
          if (!res.ok) continue;
          const data = await res.json();
          
          if (data.data_day) {
            const d = data.data_day;
            const timeArray = d.time || [];
            const tempMaxArray = d.temperature_max || [];
            const tempMinArray = d.temperature_min || [];
            const precipArray = d.precipitation || [];
            const windSpeedArray = d.windspeed_mean || [];
            const windGustArray = d.windspeed_max || [];
            
            forecastData = [];
            for (let i = 0; i < Math.min(7, timeArray.length); i++) {
              forecastData.push({
                date: timeArray[i],
                tempMin: tempMinArray[i] ?? null,
                tempMax: tempMaxArray[i] ?? null,
                precipitation: precipArray[i] ?? 0,
                windSpeed: windSpeedArray[i] ?? null,
                windGust: windGustArray[i] ?? null
              });
            }
          }
          
          for (const day of forecastData) {
            await conn.run(`
              INSERT INTO forecasts 
              (storage_date, station_id, forecast_date, source, temp_min, temp_max, precipitation, wind_speed, wind_gust)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (storage_date, station_id, forecast_date, source)
              DO UPDATE SET temp_min = EXCLUDED.temp_min, temp_max = EXCLUDED.temp_max, 
                            precipitation = EXCLUDED.precipitation, wind_speed = EXCLUDED.wind_speed,
                            wind_gust = EXCLUDED.wind_gust
            `, [storageDate, stationId, day.date, 'meteoblue', day.tempMin, day.tempMax, day.precipitation, day.windSpeed, day.windGust]);
          }
          
        } else if (sourceName === 'openmeteo') {
          const res = await fetch(`https://api.open-meteo.com/v1/dwd-icon?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,windspeed_10m_max,windgusts_10m_max,weathercode&timezone=Europe%2FBerlin&forecast_days=7`);
          if (!res.ok) continue;
          const data = await res.json();
          
          if (data.daily) {
            const d = data.daily;
            const timeArray = d.time || [];
            const tempMaxArray = d.temperature_2m_max || [];
            const tempMinArray = d.temperature_2m_min || [];
            const precipArray = d.precipitation_sum || [];
            const windSpeedArray = d.windspeed_10m_max || [];
            const windGustArray = d.windgusts_10m_max || [];
            
            forecastData = [];
            for (let i = 0; i < timeArray.length; i++) {
              forecastData.push({
                date: timeArray[i],
                tempMin: tempMinArray[i] ?? null,
                tempMax: tempMaxArray[i] ?? null,
                precipitation: precipArray[i] ?? 0,
                windSpeed: windSpeedArray[i] ?? null,
                windGust: windGustArray[i] ?? null
              });
            }
          }
          
          for (const day of forecastData) {
            await conn.run(`
              INSERT INTO forecasts 
              (storage_date, station_id, forecast_date, source, temp_min, temp_max, precipitation, wind_speed, wind_gust)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (storage_date, station_id, forecast_date, source)
              DO UPDATE SET temp_min = EXCLUDED.temp_min, temp_max = EXCLUDED.temp_max, 
                            precipitation = EXCLUDED.precipitation, wind_speed = EXCLUDED.wind_speed,
                            wind_gust = EXCLUDED.wind_gust
            `, [storageDate, stationId, day.date, 'openmeteo', day.tempMin, day.tempMax, day.precipitation, day.windSpeed, day.windGust]);
          }
        }
      } catch (e) {
        console.error(`[forecast] Failed to store ${sourceName}:`, e);
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
export async function calculateAndStoreDailyAnalysis(stationId: string) {
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
    
    // Get actual weather data from Geosphere API for the TAWES station
    // Fetch historical data from Geosphere for yesterday
    const startTime = `${yesterdayStr}T00:00:00Z`;
    const endTime = `${yesterdayStr}T23:59:59Z`;
    const geosphereUrl = `https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-1d?parameters=tl,th,rr,ffam&station_ids=${stationId}&start=${startTime}&end=${endTime}`;
    
    console.log(`[forecast] Fetching actual data from Geosphere for station ${stationId} on ${yesterdayStr}`);
    
    const response = await fetch(geosphereUrl);
    if (!response.ok) {
      console.log(`[forecast] Failed to fetch actual data from Geosphere: ${response.status}`);
      return;
    }
    
    const geosphereData = await response.json();
    const timestamps = geosphereData.timestamps || [];
    const features = geosphereData.features || [];
    
    if (timestamps.length === 0 || features.length === 0) {
      console.log(`[forecast] No actual weather data from Geosphere for ${yesterdayStr}`);
      return;
    }
    
    // Extract data for the station
    const stationFeature = features.find((f: any) => f.properties?.station === stationId);
    if (!stationFeature) {
      console.log(`[forecast] Station ${stationId} not found in Geosphere response`);
      return;
    }
    
    const params = stationFeature.properties.parameters;
    const actualConverted = {
      tempMin: params.tl?.data?.[0] ?? null,  // tl = Tmin (°C)
      tempMax: params.th?.data?.[0] ?? null,  // th = Tmax (°C)
      precipitation: params.rr?.data?.[0] ?? null,  // rr = precipitation (mm)
      windSpeed: params.ffam?.data?.[0] ?? null  // ffam = wind speed mean (km/h)
    };
    
    console.log(`[forecast] Actual data for ${yesterdayStr}:`, actualConverted);
    
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
      WHERE station_id = '${stationId}'
        AND forecast_date = '${yesterdayStr}'
        AND storage_date <= '${yesterdayStr}'
      ORDER BY storage_date DESC, source
    `;
    
    const forecastReader = await conn.runAndReadAll(forecastQuery);
    const forecasts: any = forecastReader.getRowObjects();
    
    // Take the latest (by storage_date DESC) forecast per source only
    const latestBySource: Record<string, any> = {};
    for (const f of forecasts) {
      if (!latestBySource[f.source]) {
        latestBySource[f.source] = f;
      }
    }
    
    // Store analysis for each source once
    for (const forecast of Object.values(latestBySource)) {
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

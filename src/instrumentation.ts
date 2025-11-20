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

  // Schedule daily forecast storage at 20:00 (8 PM)
  if (!global.__forecastPoller) {
    const stationSetting = process.env.FORECAST_STATION_ID || "11035"; // or 'ALL'
    console.log(`[forecast] Daily forecast storage enabled for ${stationSetting === 'ALL' ? 'ALL stations' : `station ${stationSetting}`} (runs at 20:00 daily)`);

    let lastRunDate: string | null = null;
    
    // Check every 10 minutes if it's between 20:00 and 20:30
    global.__forecastPoller = setInterval(async () => {
      const now = new Date();
      const currentDate = now.toISOString().split('T')[0];
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      
      // Run between 20:00 and 20:30 and only once per day
      if (currentHour === 20 && currentMinute <= 30 && lastRunDate !== currentDate) {
        console.log(`[forecast] ========================================`);
        console.log(`[forecast] DAILY POLLER TRIGGERED at ${now.toISOString()}`);
        console.log(`[forecast] ========================================`);
        
        lastRunDate = currentDate;
        
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

          console.log(`[forecast] Processing ${stationIds.length} station(s)...`);

          for (const sid of stationIds) {
            const maxAttempts = 3;
            const retryDelayMs = 30_000;
            let success = false;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                console.log(`[forecast] → Station ${sid}: Storing forecasts (attempt ${attempt} of ${maxAttempts})...`);
                await storeForecastForStation(sid);
                
                console.log(`[forecast] → Station ${sid}: Calculating analysis (attempt ${attempt} of ${maxAttempts})...`);
                await calculateAndStoreDailyAnalysis(sid);
                
                console.log(`[forecast] ✓ Station ${sid}: Complete`);
                success = true;
                break;
              } catch (e: any) {
                console.error(`[forecast] ✗ Station ${sid} attempt ${attempt} failed:`, e?.message || e);
                if (attempt < maxAttempts) {
                  console.log(`[forecast] → Station ${sid}: Retrying in ${retryDelayMs / 1000} seconds...`);
                  await new Promise(r => setTimeout(r, retryDelayMs));
                }
              }
            }

            if (!success) {
              console.error(`[forecast] ✗ Station ${sid} failed after ${maxAttempts} attempts - skipping to next station`);
            }

            // Small delay to be gentle on upstream APIs
            await new Promise(r => setTimeout(r, 250));
          }
          
          console.log(`[forecast] ========================================`);
          console.log(`[forecast] DAILY POLLER COMPLETE`);
          console.log(`[forecast] ========================================`);
        } catch (e: any) {
          console.error("[forecast] Daily storage failed:", e?.message || e);
        }
      }
    }, 600000); // Check every 10 minutes (600000 ms)
    
    console.log(`[forecast] Poller active: checking every 10 minutes for 20:00 window (20:00-20:30)`);
  }
}

/**
 * Store forecasts for a single station by calling the internal store API
 */
export async function storeForecastForStation(stationId: string) {
  console.log(`[forecast-store] ========================================`);
  console.log(`[forecast-store] START: Storing forecasts for station ${stationId}`);
  console.log(`[forecast-store] ========================================`);
  
  try {
    const { getDuckConn } = await import("@/lib/db/duckdb");
    const conn = await getDuckConn();
    const storageDate = new Date().toISOString().split('T')[0];
    console.log(`[forecast-store] ✓ Database connection established`);
    
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
    console.log(`[forecast-store] ✓ Forecast table created/verified`);

    // Get station coordinates first
    console.log(`[forecast-store] Fetching station metadata...`);
    const stationsResponse = await fetch('https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min/metadata');
    
    if (!stationsResponse.ok) {
      throw new Error(`Failed to fetch station metadata: ${stationsResponse.status} ${stationsResponse.statusText}`);
    }
    
    const stationsData = await stationsResponse.json();
    const station = stationsData.stations.find((s: any) => s.id === stationId);
    
    if (!station) {
      throw new Error(`Station ${stationId} not found in metadata`);
    }
    
    console.log(`[forecast-store] ✓ Station found: ${station.name} (${station.lat}, ${station.lon})`);
  
    
    const lat = station.lat;
    const lon = station.lon;
    
    // Fetch forecasts from all 4 sources - DIRECTLY from external APIs
    const sources = ['geosphere', 'openweather', 'meteoblue', 'openmeteo'];
    
    for (const sourceName of sources) {
      try {
        console.log(`[forecast-store] Processing source: ${sourceName}`);
        let forecastData: any[] = [];
        
        // Fetch from external API directly
        if (sourceName === 'geosphere') {
          // CRITICAL: Geosphere forecast API uses lat_lon, NOT station_ids! (station_ids returns 422 error)
          const url = `https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/ensemble-v1-1h-2500m?parameters=t2m_p50,rr_p50,u10m_p50,v10m_p50&lat_lon=${lat},${lon}`;
          console.log(`[forecast-store] Fetching Geosphere: ${url}`);
          const res = await fetch(url);
          console.log(`[forecast-store] Geosphere response status: ${res.status}`);
          if (!res.ok) {
            console.error(`[forecast-store] ✗ Geosphere fetch failed: ${res.status}`);
            continue;
          }
          const data = await res.json();
          console.log(`[forecast-store] Geosphere data: ${data.timestamps?.length} timestamps, ${data.features?.length} features`);
          
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
          console.log(`[forecast-store] Geosphere: ${forecastData.length} hourly rows → ${dailyData.length} daily rows`);
          
          for (const day of dailyData) {
            await conn.run(`
              INSERT INTO forecasts 
              (storage_date, station_id, forecast_date, source, temp_min, temp_max, precipitation, wind_speed)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (storage_date, station_id, forecast_date, source)
              DO UPDATE SET temp_min = EXCLUDED.temp_min, temp_max = EXCLUDED.temp_max, 
                            precipitation = EXCLUDED.precipitation, wind_speed = EXCLUDED.wind_speed
            `, [storageDate, stationId, day.date, 'geosphere', day.tempMin, day.tempMax, day.precipitation, day.windSpeed]);
            console.log(`[forecast-store]   ✓ Inserted Geosphere for ${day.date}`);
          }
          console.log(`[forecast-store] ✓ Geosphere complete: ${dailyData.length} days stored`);
          
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
      } catch (e: any) {
        console.error(`[forecast-store] ✗ Failed to store ${sourceName}:`, e?.message || e);
      }
    }
    
    console.log(`[forecast-store] ========================================`);
    console.log(`[forecast-store] DONE: Forecasts stored for station ${stationId}`);
    console.log(`[forecast-store] ========================================`);
  } catch (e: any) {
    console.error(`[forecast-store] ========================================`);
    console.error(`[forecast-store] ✗✗✗ STORAGE FAILED ✗✗✗`);
    console.error(`[forecast-store] ========================================`);
    console.error(`[forecast-store] Error:`, e?.message || e);
    console.error(`[forecast-store] Stack:`, e?.stack);
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
  console.log(`[forecast-analysis] ========================================`);
  console.log(`[forecast-analysis] START: Calculating analysis for station ${stationId}`);
  console.log(`[forecast-analysis] ========================================`);
  
  try {
    const { getDuckConn } = await import("@/lib/db/duckdb");
    const conn = await getDuckConn();
    console.log(`[forecast-analysis] ✓ Database connection established`);
    
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
    
    console.log(`[forecast-analysis] ✓ Analysis table created/verified`);
    
    // Delete old analysis data (older than 90 days)
    /*
    await conn.run(`
      DELETE FROM forecast_analysis 
      WHERE analysis_date < CURRENT_DATE - INTERVAL '90' DAYS
    `);
    console.log(`[forecast-analysis] ✓ Cleaned up old analysis records (>90 days)`);
    */
    
    // Analyze YESTERDAY's weather vs forecasts that were stored for YESTERDAY
    // We use YESTERDAY because historical data has a 1-2 day delay
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    console.log(`[forecast-analysis] Target date: ${yesterdayStr} (YESTERDAY)`);
    console.log(`[forecast-analysis] Will compare YESTERDAY's actual weather (min/max) with forecasts stored for YESTERDAY`);

    // Load locally stored MAIN data (daily aggregates) for the selected date
    const startOfDay = new Date(`${yesterdayStr}T00:00:00`);
    const endOfDay = new Date(`${yesterdayStr}T23:59:59`);

    const [{ ensureMainParquetsInRange }, { queryDailyAggregatesInRange }] = await Promise.all([
      import("@/lib/db/ingest"),
      import("@/lib/statistics"),
    ]);

    const parquetFiles = await ensureMainParquetsInRange(startOfDay, endOfDay);
    if (!parquetFiles.length) {
      console.warn(`[forecast-analysis] ✗ No local MAIN data available for ${yesterdayStr}`);
      return;
    }

    const dailyRows = await queryDailyAggregatesInRange(parquetFiles, startOfDay, endOfDay);
    const targetRow = dailyRows.find((row: any) => String(row.day || '').startsWith(yesterdayStr));

    if (!targetRow) {
      console.warn(`[forecast-analysis] ✗ No aggregated row found for ${yesterdayStr}`);
      return;
    }

    const toNumber = (value: any) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };

    const actualConverted = {
      tempMin: toNumber(targetRow.tmin),
      tempMax: toNumber(targetRow.tmax),
      precipitation: toNumber(targetRow.rain_day) ?? 0,
      windSpeed: toNumber(targetRow.wind_avg ?? targetRow.wind_max)
    };

    console.log(`[forecast-analysis] ✓ Local MAIN data for ${yesterdayStr}:`, JSON.stringify(actualConverted, null, 2));

    // Get forecasts that were made for YESTERDAY (stored before yesterday)
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
    
    console.log(`[forecast-analysis] Querying forecasts from DB...`);
    console.log(`[forecast-analysis] Query:`, forecastQuery.trim());
    
    const forecastReader = await conn.runAndReadAll(forecastQuery);
    const forecasts: any = forecastReader.getRowObjects();
    
    console.log(`[forecast-analysis] Found ${forecasts.length} forecast rows for YESTERDAY (${yesterdayStr})`);
    
    if (forecasts.length === 0) {
      console.warn(`[forecast-analysis] ✗ No forecasts found for YESTERDAY (${yesterdayStr}) in database`);
      console.warn(`[forecast-analysis] This means no forecasts were stored BEFORE yesterday for yesterday`);
      return;
    }
    
    // Take the latest (by storage_date DESC) forecast per source only
    const latestBySource: Record<string, any> = {};
    for (const f of forecasts) {
      if (!latestBySource[f.source]) {
        latestBySource[f.source] = f;
      }
    }
    
    console.log(`[forecast-analysis] Latest forecasts by source:`, Object.keys(latestBySource));
    console.log(`[forecast-analysis] Details:`, JSON.stringify(latestBySource, null, 2));
    
    // Store analysis for each source once
    let stored = 0;
    for (const forecast of Object.values(latestBySource)) {
      const tempMinError = actualConverted.tempMin !== null && forecast.temp_min !== null 
        ? Math.abs(actualConverted.tempMin - forecast.temp_min) : null;
      const tempMaxError = actualConverted.tempMax !== null && forecast.temp_max !== null 
        ? Math.abs(actualConverted.tempMax - forecast.temp_max) : null;
      const precipitationError = actualConverted.precipitation !== null && forecast.precipitation !== null 
        ? Math.abs(actualConverted.precipitation - forecast.precipitation) : null;
      const windSpeedError = actualConverted.windSpeed !== null && forecast.wind_speed !== null 
        ? Math.abs(actualConverted.windSpeed - forecast.wind_speed) : null;
      
      console.log(`[forecast-analysis] Storing analysis for source: ${forecast.source}`);
      console.log(`[forecast-analysis]   Errors: TMin=${tempMinError?.toFixed(2)}, TMax=${tempMaxError?.toFixed(2)}, Precip=${precipitationError?.toFixed(2)}, Wind=${windSpeedError?.toFixed(2)}`);
      
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
      
      stored++;
    }
    
    console.log(`[forecast-analysis] ✓ Successfully stored ${stored} analysis records for YESTERDAY (${yesterdayStr})`);
    console.log(`[forecast-analysis] ========================================`);
    console.log(`[forecast-analysis] DONE`);
    console.log(`[forecast-analysis] ========================================`);
  } catch (e: any) {
    console.error(`[forecast-analysis] ========================================`);
    console.error(`[forecast-analysis] ✗✗✗ ERROR OCCURRED ✗✗✗`);
    console.error(`[forecast-analysis] ========================================`);
    console.error(`[forecast-analysis] Error message:`, e?.message || e);
    console.error(`[forecast-analysis] Stack trace:`, e?.stack);
    console.error(`[forecast-analysis] ========================================`);
    throw e;
  }
}

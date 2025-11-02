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

  // Schedule daily forecast storage (once per day at startup + every 24h)
  const forecastIntervalMs = 24 * 60 * 60 * 1000; // 24h
  if (!global.__forecastPoller) {
    const stationId = process.env.FORECAST_STATION_ID || "11035"; // Default: Wien Hohe Warte
    console.log(`[forecast] Daily forecast storage enabled for station ${stationId} (every ${forecastIntervalMs} ms)`);
    
    // Store forecasts on startup
    (async () => {
      try {
        await storeForecastForStation(stationId);
        console.log(`[forecast] Stored forecasts for station ${stationId} on startup`);
      } catch (e) {
        console.error("[forecast] Startup storage failed:", e);
      }
    })();

    global.__forecastPoller = setInterval(async () => {
      try {
        await storeForecastForStation(stationId);
        console.log(`[forecast] Stored forecasts for station ${stationId}`);
      } catch (e) {
        console.error("[forecast] Background storage failed:", e);
      }
    }, forecastIntervalMs);
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
              INSERT OR REPLACE INTO forecasts 
              (storage_date, station_id, forecast_date, source, temp_min, temp_max, precipitation, wind_speed)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [storageDate, stationId, day.date, 'geosphere', day.tempMin, day.tempMax, day.precipitation, day.windSpeed]);
          }
        } else {
          // Other sources: already daily format
          for (const day of forecastData) {
            await conn.run(`
              INSERT OR REPLACE INTO forecasts 
              (storage_date, station_id, forecast_date, source, temp_min, temp_max, precipitation, wind_speed, wind_gust)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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

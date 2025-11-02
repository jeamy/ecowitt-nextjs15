import { NextResponse } from "next/server";

// Geosphere API endpoints
const TAWES_STATIONS_ENDPOINT = "https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min/metadata";
const FORECAST_ENDPOINT = "https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/ensemble-v1-1h-2500m";

// Cache for station data to avoid repeated API calls
let stationsCache: any = null;
let stationsCacheTime: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const runtime = "nodejs";

/**
 * API route to get weather stations list from Geosphere API
 * This function handles GET requests to /api/forecast?action=stations or /api/forecast?action=forecast
 *
 * @returns {Promise<NextResponse>} A JSON response containing the stations data or forecast data, or an error message
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "stations";

    if (action === "stations") {
      // Check cache first
      const now = Date.now();
      if (stationsCache && (now - stationsCacheTime) < CACHE_DURATION) {
        return NextResponse.json(stationsCache, { status: 200 });
      }

      // Fetch TAWES stations data from Geosphere API
      const response = await fetch(TAWES_STATIONS_ENDPOINT);
      if (!response.ok) {
        throw new Error(`Failed to fetch stations: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Group stations by state (Bundesland)
      const stationsByState: Record<string, any[]> = {};
      
      data.stations.forEach((station: any) => {
        const state = station.state || "Unknown";
        if (!stationsByState[state]) {
          stationsByState[state] = [];
        }
        stationsByState[state].push({
          id: station.id,
          name: station.name,
          state: station.state,
          lat: station.lat,
          lon: station.lon,
          altitude: station.altitude
        });
      });

      // Sort states alphabetically and stations within each state by name
      const sortedStates = Object.keys(stationsByState).sort();
      const sortedStations: Record<string, any[]> = {};
      
      sortedStates.forEach(state => {
        sortedStations[state] = stationsByState[state].sort((a, b) => 
          a.name.localeCompare(b.name)
        );
      });

      // Cache the result
      stationsCache = { stations: sortedStations };
      stationsCacheTime = now;

      return NextResponse.json(stationsCache, { status: 200 });
    } else if (action === "forecast") {
      const stationId = searchParams.get("stationId");
      if (!stationId) {
        return NextResponse.json({ error: "stationId parameter is required" }, { status: 400 });
      }

      // First get station details
      const stationsResponse = await fetch(TAWES_STATIONS_ENDPOINT);
      if (!stationsResponse.ok) {
        throw new Error(`Failed to fetch stations: ${stationsResponse.status} ${stationsResponse.statusText}`);
      }

      const stationsData = await stationsResponse.json();
      const station = stationsData.stations.find((s: any) => s.id === stationId);
      
      if (!station) {
        return NextResponse.json({ error: "Station not found" }, { status: 404 });
      }

      // Fetch forecast data for the specified station coordinates
      // We'll get temperature (t2m_p50), precipitation (rr_p50), and wind (u10m_p50, v10m_p50) for the next 7 days
      const params = "t2m_p50,rr_p50,u10m_p50,v10m_p50";
      const lat = station.lat;
      const lon = station.lon;
      
      // For timeseries forecast, we need to use lat/lon coordinates in the correct format
      const response = await fetch(`${FORECAST_ENDPOINT}?parameters=${params}&lat_lon=${lat},${lon}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch forecast: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Process the forecast data to extract 7-day forecast
      const forecastData: any[] = [];
      
      if (data && data.features && data.features.length > 0 && data.timestamps) {
        const feature = data.features[0];
        if (feature.properties && feature.properties.parameters) {
          // Extract temperature, precipitation, and wind data
          const tempParam = feature.properties.parameters.t2m_p50;
          const precipParam = feature.properties.parameters.rr_p50;
          const uWindParam = feature.properties.parameters.u10m_p50;
          const vWindParam = feature.properties.parameters.v10m_p50;
          
          const tempData = tempParam?.data || [];
          const precipData = precipParam?.data || [];
          const uWindData = uWindParam?.data || [];
          const vWindData = vWindParam?.data || [];
          const timestamps = data.timestamps || [];
          
          // Combine data for the next 7 days (168 hours)
          const now = new Date();
          const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          
          // Process temperature data
          tempData.forEach((tempValue: any, index: number) => {
            if (index < timestamps.length) {
              const time = timestamps[index];
              const tempDate = new Date(time);
              
              // Only include data for the next 7 days
              if (tempDate >= now && tempDate <= sevenDaysLater) {
                const precipValue = index < precipData.length ? precipData[index] : null;
                const uWind = index < uWindData.length ? uWindData[index] : null;
                const vWind = index < vWindData.length ? vWindData[index] : null;
                
                // Calculate wind speed from u and v components: speed = sqrt(u² + v²)
                let windSpeed = null;
                if (uWind !== null && vWind !== null) {
                  windSpeed = Math.sqrt(uWind * uWind + vWind * vWind) * 3.6; // Convert m/s to km/h
                }
                
                forecastData.push({
                  time: time,
                  temperature: tempValue !== null ? parseFloat(tempValue) : null,
                  precipitation: precipValue !== null ? parseFloat(precipValue) : null,
                  windSpeed: windSpeed !== null ? parseFloat(windSpeed.toFixed(1)) : null
                });
              }
            }
          });
        }
      }
      
      return NextResponse.json({ forecast: forecastData }, { status: 200 });
    } else if (action === "openweather") {
      const stationId = searchParams.get("stationId");
      if (!stationId) {
        return NextResponse.json({ error: "stationId parameter is required" }, { status: 400 });
      }

      // Get OpenWeatherMap API key from environment
      const apiKey = process.env.OPENWEATHER_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "OpenWeatherMap API key not configured" }, { status: 500 });
      }

      // First get station details for coordinates
      const stationsResponse = await fetch(TAWES_STATIONS_ENDPOINT);
      if (!stationsResponse.ok) {
        throw new Error(`Failed to fetch stations: ${stationsResponse.status} ${stationsResponse.statusText}`);
      }

      const stationsData = await stationsResponse.json();
      const station = stationsData.stations.find((s: any) => s.id === stationId);
      
      if (!station) {
        return NextResponse.json({ error: "Station not found" }, { status: 404 });
      }

      const lat = station.lat;
      const lon = station.lon;

      // Fetch 5-day forecast from OpenWeatherMap (FREE API)
      const owmUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
      const owmResponse = await fetch(owmUrl);
      
      if (!owmResponse.ok) {
        throw new Error(`Failed to fetch OpenWeatherMap forecast: ${owmResponse.status} ${owmResponse.statusText}`);
      }

      const owmData = await owmResponse.json();
      
      // Process OpenWeatherMap 3-hour forecast data into daily aggregates
      const dailyMap: Record<string, any[]> = {};
      
      owmData.list?.forEach((item: any) => {
        const date = new Date(item.dt * 1000);
        const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
        
        if (!dailyMap[dateKey]) {
          dailyMap[dateKey] = [];
        }
        dailyMap[dateKey].push(item);
      });
      
      // Aggregate 3-hour data into daily forecasts
      const dailyForecast = Object.entries(dailyMap).map(([dateKey, items]) => {
        const temps = items.map(i => i.main.temp);
        const tempMins = items.map(i => i.main.temp_min);
        const tempMaxs = items.map(i => i.main.temp_max);
        const precipitations = items.map(i => (i.rain?.['3h'] ?? 0) + (i.snow?.['3h'] ?? 0));
        const windSpeeds = items.map(i => i.wind.speed);
        const windGusts = items.map(i => i.wind.gust ?? 0);
        const pops = items.map(i => i.pop ?? 0);
        
        return {
          date: new Date(dateKey + 'T12:00:00').toISOString(),
          tempMin: Math.min(...tempMins),
          tempMax: Math.max(...tempMaxs),
          tempDay: temps.reduce((sum, t) => sum + t, 0) / temps.length,
          precipitation: precipitations.reduce((sum, p) => sum + p, 0),
          windSpeed: windSpeeds.reduce((sum, w) => sum + w, 0) / windSpeeds.length * 3.6, // Convert m/s to km/h
          windGust: Math.max(...windGusts) * 3.6, // Convert m/s to km/h
          humidity: items.reduce((sum, i) => sum + i.main.humidity, 0) / items.length,
          pressure: items.reduce((sum, i) => sum + i.main.pressure, 0) / items.length,
          weather: items[Math.floor(items.length / 2)].weather?.[0] ?? null, // Use midday weather
          clouds: items.reduce((sum, i) => sum + i.clouds.all, 0) / items.length,
          pop: Math.max(...pops) // Max probability of precipitation
        };
      }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      return NextResponse.json({ forecast: dailyForecast }, { status: 200 });
    } else if (action === "meteoblue") {
      const stationId = searchParams.get("stationId");
      if (!stationId) {
        return NextResponse.json({ error: "stationId parameter is required" }, { status: 400 });
      }

      // Get Meteoblue API key from environment
      const apiKey = process.env.METEOBLUE_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "Meteoblue API key not configured" }, { status: 500 });
      }

      // First get station details for coordinates
      const stationsResponse = await fetch(TAWES_STATIONS_ENDPOINT);
      if (!stationsResponse.ok) {
        throw new Error(`Failed to fetch stations: ${stationsResponse.status} ${stationsResponse.statusText}`);
      }

      const stationsData = await stationsResponse.json();
      const station = stationsData.stations.find((s: any) => s.id === stationId);
      
      if (!station) {
        return NextResponse.json({ error: "Station not found" }, { status: 404 });
      }

      const lat = station.lat;
      const lon = station.lon;

      // Fetch 7-day forecast from Meteoblue (FREE API)
      // Using basic package with daily data
      const mbUrl = `https://my.meteoblue.com/packages/basic-day?apikey=${apiKey}&lat=${lat}&lon=${lon}&asl=500&format=json&temperature=C&windspeed=kmh&precipitationamount=mm&timeformat=iso8601`;
      const mbResponse = await fetch(mbUrl);
      
      if (!mbResponse.ok) {
        throw new Error(`Failed to fetch Meteoblue forecast: ${mbResponse.status} ${mbResponse.statusText}`);
      }

      const mbData = await mbResponse.json();
      
      // Process Meteoblue daily forecast (7 days)
      const dailyForecast: any[] = [];
      
      if (mbData.data_day) {
        const data = mbData.data_day;
        const timeArray = data.time || [];
        const tempMaxArray = data.temperature_max || [];
        const tempMinArray = data.temperature_min || [];
        const tempMeanArray = data.temperature_mean || [];
        const precipArray = data.precipitation || [];
        const windSpeedArray = data.windspeed_mean || [];
        const windGustArray = data.windspeed_max || [];
        const pictoCodeArray = data.pictocode || [];
        
        // Take first 7 days
        for (let i = 0; i < Math.min(7, timeArray.length); i++) {
          dailyForecast.push({
            date: timeArray[i],
            tempMin: tempMinArray[i] ?? null,
            tempMax: tempMaxArray[i] ?? null,
            tempMean: tempMeanArray[i] ?? null,
            precipitation: precipArray[i] ?? 0,
            windSpeed: windSpeedArray[i] ?? null,
            windGust: windGustArray[i] ?? null,
            pictocode: pictoCodeArray[i] ?? null
          });
        }
      }

      return NextResponse.json({ forecast: dailyForecast }, { status: 200 });
    } else if (action === "openmeteo") {
      const stationId = searchParams.get("stationId");
      if (!stationId) {
        return NextResponse.json({ error: "stationId parameter is required" }, { status: 400 });
      }

      // First get station details for coordinates
      const stationsResponse = await fetch(TAWES_STATIONS_ENDPOINT);
      if (!stationsResponse.ok) {
        throw new Error(`Failed to fetch stations: ${stationsResponse.status} ${stationsResponse.statusText}`);
      }

      const stationsData = await stationsResponse.json();
      const station = stationsData.stations.find((s: any) => s.id === stationId);
      
      if (!station) {
        return NextResponse.json({ error: "Station not found" }, { status: 404 });
      }

      const lat = station.lat;
      const lon = station.lon;

      // Fetch 7-day forecast from Open-Meteo DWD API (FREE, no API key required)
      // Using DWD ICON model for Central Europe
      const omUrl = `https://api.open-meteo.com/v1/dwd-icon?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,windspeed_10m_max,windgusts_10m_max,weathercode&timezone=Europe%2FBerlin&forecast_days=7`;
      const omResponse = await fetch(omUrl);
      
      if (!omResponse.ok) {
        throw new Error(`Failed to fetch Open-Meteo forecast: ${omResponse.status} ${omResponse.statusText}`);
      }

      const omData = await omResponse.json();
      
      // Process Open-Meteo daily forecast (7 days)
      const dailyForecast: any[] = [];
      
      if (omData.daily) {
        const data = omData.daily;
        const timeArray = data.time || [];
        const tempMaxArray = data.temperature_2m_max || [];
        const tempMinArray = data.temperature_2m_min || [];
        const tempMeanArray = data.temperature_2m_mean || [];
        const precipArray = data.precipitation_sum || [];
        const windSpeedArray = data.windspeed_10m_max || [];
        const windGustArray = data.windgusts_10m_max || [];
        const weatherCodeArray = data.weathercode || [];
        
        // Take all 7 days
        for (let i = 0; i < timeArray.length; i++) {
          dailyForecast.push({
            date: timeArray[i],
            tempMin: tempMinArray[i] ?? null,
            tempMax: tempMaxArray[i] ?? null,
            tempMean: tempMeanArray[i] ?? null,
            precipitation: precipArray[i] ?? 0,
            windSpeed: windSpeedArray[i] ?? null,
            windGust: windGustArray[i] ?? null,
            weatherCode: weatherCodeArray[i] ?? null
          });
        }
      }

      return NextResponse.json({ forecast: dailyForecast }, { status: 200 });
    } else if (action === "meteogram") {
      const stationId = searchParams.get("stationId");
      if (!stationId) {
        return NextResponse.json({ error: "stationId parameter is required" }, { status: 400 });
      }

      // Get Meteoblue API key from environment
      const apiKey = process.env.METEOBLUE_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "Meteoblue API key not configured" }, { status: 500 });
      }

      // First get station details for coordinates
      const stationsResponse = await fetch(TAWES_STATIONS_ENDPOINT);
      if (!stationsResponse.ok) {
        throw new Error(`Failed to fetch stations: ${stationsResponse.status} ${stationsResponse.statusText}`);
      }

      const stationsData = await stationsResponse.json();
      const station = stationsData.stations.find((s: any) => s.id === stationId);
      
      if (!station) {
        return NextResponse.json({ error: "Station not found" }, { status: 404 });
      }

      const lat = station.lat;
      const lon = station.lon;
      const altitude = station.altitude || 500;
      const name = encodeURIComponent(station.name);

      // Fetch meteogram image from Meteoblue
      const meteogramUrl = `https://my.meteoblue.com/images/meteogram?lat=${lat}&lon=${lon}&asl=${altitude}&tz=Europe%2FVienna&apikey=${apiKey}&format=webp&dpi=72&lang=de&temperature_units=C&precipitation_units=mm&windspeed_units=kmh&location_name=${name}`;
      
      const imageResponse = await fetch(meteogramUrl);
      
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch meteogram: ${imageResponse.status} ${imageResponse.statusText}`);
      }

      // Return the image directly
      const imageBuffer = await imageResponse.arrayBuffer();
      return new NextResponse(imageBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        },
      });
    } else {
      return NextResponse.json({ error: "Invalid action parameter" }, { status: 400 });
    }
  } catch (e: any) {
    console.error("Forecast API error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

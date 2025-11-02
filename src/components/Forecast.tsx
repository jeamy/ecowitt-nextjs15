"use client";

import React, { useState, useEffect } from "react";
import { API_ENDPOINTS } from "@/constants";
import { useTranslation } from "react-i18next";

interface Station {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  altitude: number;
}

interface ForecastDataPoint {
  time: string;
  temperature: number | null;
  precipitation: number | null;
  windSpeed?: number | null;
}

interface OpenWeatherDay {
  date: string;
  tempMin: number | null;
  tempMax: number | null;
  tempDay: number | null;
  precipitation: number;
  windSpeed: number | null;
  windGust: number | null;
  humidity: number | null;
  pressure: number | null;
  weather: any;
  clouds: number | null;
  pop: number | null;
}

interface MeteoblueDay {
  date: string;
  tempMin: number | null;
  tempMax: number | null;
  tempMean: number | null;
  precipitation: number;
  windSpeed: number | null;
  windGust: number | null;
  pictocode: number | null;
}

// Map Meteoblue pictocode to weather emoji and description
// Based on: https://content.meteoblue.com/en/help/standards/symbols-and-pictograms
function getWeatherEmoji(pictocode: number): string {
  const weatherMap: Record<number, string> = {
    1: "☀️",   // Clear, cloudless sky
    2: "🌤️",   // Clear, few cirrus
    3: "⛅",   // Clear with cirrus
    4: "🌥️",   // Clear with few low clouds
    5: "🌥️",   // Clear with few low clouds and few cirrus
    6: "🌥️",   // Clear with few low clouds and cirrus
    7: "🌤️",   // Partly cloudy
    8: "🌤️",   // Partly cloudy and few cirrus
    9: "⛅",   // Partly cloudy and cirrus
    10: "☁️",  // Mixed with some thunderstorm clouds possible
    11: "🌫️",  // Fog/low stratus clouds
    12: "🌫️",  // Fog/low stratus clouds with cirrus
    13: "🌫️",  // Fog/low stratus clouds with few cirrus
    14: "🌫️",  // Fog/low stratus clouds with thunderstorm clouds possible
    15: "🌧️",  // Precipitation possible
    16: "🌧️",  // Precipitation
    17: "⛈️",  // Thunderstorms
    18: "❄️",  // Precipitation, possible thunderstorms
    19: "🌨️",  // Snow
    20: "🌨️",  // Precipitation, snow mixed
    21: "🌧️",  // Overcast with rain
    22: "🌨️",  // Overcast with snow
    23: "🌧️",  // Overcast with possible thunderstorms
    24: "⛈️",  // Thunderstorms, possible hail
    25: "🌧️",  // Light rain
    26: "🌧️",  // Rain
    27: "🌧️",  // Heavy rain
  };
  
  return weatherMap[pictocode] || "🌡️";
}


export default function Forecast() {
  const { t } = useTranslation();
  const [stations, setStations] = useState<Record<string, Station[]>>({});
  const [selectedStation, setSelectedStation] = useState<string>("");
  const [forecastData, setForecastData] = useState<ForecastDataPoint[]>([]);
  const [openWeatherData, setOpenWeatherData] = useState<OpenWeatherDay[]>([]);
  const [meteoblueData, setMeteoblueData] = useState<MeteoblueDay[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingOWM, setLoadingOWM] = useState<boolean>(false);
  const [loadingMB, setLoadingMB] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [errorOWM, setErrorOWM] = useState<string | null>(null);
  const [errorMB, setErrorMB] = useState<string | null>(null);

  // Load stations on component mount
  useEffect(() => {
    const loadStations = async () => {
      try {
        setLoading(true);
        const response = await fetch(API_ENDPOINTS.FORECAST_STATIONS);
        if (!response.ok) {
          throw new Error(`Failed to fetch stations: ${response.status}`);
        }
        const data = await response.json();
        setStations(data.stations);
        
        // Load last selected station from localStorage
        const lastSelected = localStorage.getItem("forecastStation");
        if (lastSelected && data.stations) {
          // Verify the station still exists
          let stationExists = false;
          for (const state in data.stations) {
            if (data.stations[state].some((station: Station) => station.id === lastSelected)) {
              stationExists = true;
              break;
            }
          }
          if (stationExists) {
            setSelectedStation(lastSelected);
          }
        }
      } catch (err) {
        setError(`Error loading stations: ${err instanceof Error ? err.message : String(err)}`);
        console.error("Error loading stations:", err);
      } finally {
        setLoading(false);
      }
    };

    loadStations();
  }, []);

  // Load forecast when station is selected
  useEffect(() => {
    const loadForecast = async () => {
      if (!selectedStation) return;
      
      try {
        setLoading(true);
        setError(null);
        
        // Save selected station to localStorage
        localStorage.setItem("forecastStation", selectedStation);
        
        const response = await fetch(`${API_ENDPOINTS.FORECAST_DATA}&stationId=${selectedStation}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch forecast: ${response.status}`);
        }
        const data = await response.json();
        setForecastData(data.forecast || []);
      } catch (err) {
        setError(`Error loading forecast: ${err instanceof Error ? err.message : String(err)}`);
        console.error("Error loading forecast:", err);
      } finally {
        setLoading(false);
      }
    };

    const loadOpenWeather = async () => {
      if (!selectedStation) return;
      
      try {
        setLoadingOWM(true);
        setErrorOWM(null);
        
        const response = await fetch(`${API_ENDPOINTS.FORECAST_OPENWEATHER}&stationId=${selectedStation}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch OpenWeather forecast: ${response.status}`);
        }
        const data = await response.json();
        setOpenWeatherData(data.forecast || []);
      } catch (err) {
        setErrorOWM(`Error loading OpenWeather forecast: ${err instanceof Error ? err.message : String(err)}`);
        console.error("Error loading OpenWeather forecast:", err);
      } finally {
        setLoadingOWM(false);
      }
    };

    const loadMeteoblue = async () => {
      if (!selectedStation) return;
      
      try {
        setLoadingMB(true);
        setErrorMB(null);
        
        const response = await fetch(`${API_ENDPOINTS.FORECAST_METEOBLUE}&stationId=${selectedStation}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch Meteoblue forecast: ${response.status}`);
        }
        const data = await response.json();
        setMeteoblueData(data.forecast || []);
      } catch (err) {
        setErrorMB(`Error loading Meteoblue forecast: ${err instanceof Error ? err.message : String(err)}`);
        console.error("Error loading Meteoblue forecast:", err);
      } finally {
        setLoadingMB(false);
      }
    };

    loadForecast();
    loadOpenWeather();
    loadMeteoblue();
  }, [selectedStation]);

  // Group forecast data by day
  const groupedForecast = forecastData.reduce((acc: Record<string, ForecastDataPoint[]>, point) => {
    const date = new Date(point.time);
    const day = date.toLocaleDateString("de-DE", { 
      weekday: "short", 
      day: "2-digit", 
      month: "2-digit" 
    });
    
    if (!acc[day]) {
      acc[day] = [];
    }
    acc[day].push(point);
    return acc;
  }, {});

  // Calculate daily averages/max/min
  const dailyForecast = Object.entries(groupedForecast).map(([day, points]) => {
    const temperatures = points
      .map(p => p.temperature)
      .filter(t => t !== null) as number[];
    const precipitations = points
      .map(p => p.precipitation)
      .filter(p => p !== null) as number[];
    const windSpeeds = points
      .map(p => p.windSpeed)
      .filter(w => w !== null && w !== undefined) as number[];
    
    return {
      day,
      maxTemp: temperatures.length > 0 ? Math.max(...temperatures) : null,
      minTemp: temperatures.length > 0 ? Math.min(...temperatures) : null,
      avgTemp: temperatures.length > 0 ? 
        temperatures.reduce((sum, temp) => sum + temp, 0) / temperatures.length : null,
      totalPrecip: precipitations.length > 0 ? 
        precipitations.reduce((sum, precip) => sum + precip, 0) : null,
      avgWind: windSpeeds.length > 0 ?
        windSpeeds.reduce((sum, wind) => sum + wind, 0) / windSpeeds.length : null,
      maxWind: windSpeeds.length > 0 ? Math.max(...windSpeeds) : null
    };
  });

  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold mb-6">{t("tabs.forecast", "Prognose")}</h1>
      
      {/* Station selection dropdown */}
      <div className="mb-6">
        <label htmlFor="station-select" className="block text-sm font-medium mb-2">
          {t("forecast.selectStation", "Wetterstation auswählen")}
        </label>
        <select
          id="station-select"
          value={selectedStation}
          onChange={(e) => setSelectedStation(e.target.value)}
          className="w-full p-2 border border-gray-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100"
          disabled={loading}
        >
          <option value="">{t("forecast.selectPlaceholder", "Station auswählen...")}</option>
          {Object.entries(stations).map(([state, stateStations]) => (
            <optgroup key={state} label={state}>
              {stateStations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      
      {/* Loading and error states */}
      {loading && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
          <p className="mt-2">{t("statuses.loading")}</p>
        </div>
      )}
      
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 px-4 py-3 rounded mb-6">
          <p>{error}</p>
        </div>
      )}
      
      {/* Geosphere Forecast */}
      {dailyForecast.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">🇦🇹 Geosphere Austria (~2.5 Tage)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {dailyForecast.map((dayData, index) => (
              <div 
                key={index} 
                className="border border-gray-200 dark:border-neutral-700 rounded-lg p-5 bg-white dark:bg-neutral-800 shadow-sm"
              >
                <h3 className="font-semibold text-center mb-3">{dayData.day}</h3>
                
                <div className="space-y-2">
                  {dayData.maxTemp !== null && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-300 text-sm">
                        {t("forecast.maxTemp", "Max")}
                      </span>
                      <span className="font-medium text-red-600 dark:text-red-400">
                        {dayData.maxTemp.toFixed(1)}°C
                      </span>
                    </div>
                  )}
                  
                  {dayData.minTemp !== null && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-300 text-sm">
                        {t("forecast.minTemp", "Min")}
                      </span>
                      <span className="font-medium text-blue-600 dark:text-blue-400">
                        {dayData.minTemp.toFixed(1)}°C
                      </span>
                    </div>
                  )}
                  
                  {dayData.avgTemp !== null && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-300 text-sm">
                        {t("forecast.avgTemp", "Ø")}
                      </span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {dayData.avgTemp.toFixed(1)}°C
                      </span>
                    </div>
                  )}
                  
                  {dayData.totalPrecip !== null && dayData.totalPrecip > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-neutral-700">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600 dark:text-gray-300 text-sm flex items-center gap-1">
                          <span>💧</span>
                          <span>{t("forecast.precipitation", "Niederschlag")}</span>
                        </span>
                        <span className="font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap ml-2">
                          {dayData.totalPrecip.toFixed(1)} mm
                        </span>
                      </div>
                    </div>
                  )}
                  
                  {dayData.avgWind !== null && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-neutral-700">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600 dark:text-gray-300 text-sm flex items-center gap-1">
                          <span>💨</span>
                          <span>{t("forecast.wind", "Wind")}</span>
                        </span>
                        <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap ml-2">
                          {dayData.avgWind.toFixed(1)} km/h
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {selectedStation && dailyForecast.length === 0 && !loading && !error && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <p>{t("forecast.noData", "Keine Prognosedaten verfügbar")}</p>
        </div>
      )}
      
      {/* OpenWeatherMap Forecast */}
      {loadingOWM && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
          <p className="mt-2">{t("statuses.loading")}</p>
        </div>
      )}
      
      {errorOWM && (
        <div className="bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-700 text-yellow-700 dark:text-yellow-200 px-4 py-3 rounded mb-6">
          <p className="font-semibold mb-1">⚠️ OpenWeatherMap Prognose nicht verfügbar</p>
          <p className="text-sm">{errorOWM}</p>
          <p className="text-xs mt-2">
            💡 Tipp: Neue API-Keys brauchen 10-30 Minuten zur Aktivierung. 
            Prüfe auch, ob du die Bestätigungs-E-Mail von OpenWeatherMap erhalten hast.
          </p>
        </div>
      )}
      
      {openWeatherData.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">🌍 OpenWeatherMap (5 Tage)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {openWeatherData.map((dayData, index) => {
              const date = new Date(dayData.date);
              const dayLabel = date.toLocaleDateString("de-DE", { 
                weekday: "short", 
                day: "2-digit", 
                month: "2-digit" 
              });
              
              return (
                <div 
                  key={index} 
                  className="border border-gray-200 dark:border-neutral-700 rounded-lg p-5 bg-white dark:bg-neutral-800 shadow-sm"
                >
                  <h3 className="font-semibold text-center mb-3">{dayLabel}</h3>
                  
                  <div className="space-y-2">
                    {dayData.tempMax !== null && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-300 text-sm">
                          {t("forecast.maxTemp", "Max")}
                        </span>
                        <span className="font-medium text-red-600 dark:text-red-400">
                          {dayData.tempMax.toFixed(1)}°C
                        </span>
                      </div>
                    )}
                    
                    {dayData.tempMin !== null && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-300 text-sm">
                          {t("forecast.minTemp", "Min")}
                        </span>
                        <span className="font-medium text-blue-600 dark:text-blue-400">
                          {dayData.tempMin.toFixed(1)}°C
                        </span>
                      </div>
                    )}
                    
                    {dayData.tempDay !== null && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-300 text-sm">
                          {t("forecast.dayTemp", "Tag")}
                        </span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {dayData.tempDay.toFixed(1)}°C
                        </span>
                      </div>
                    )}
                    
                    {dayData.precipitation > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-neutral-700">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600 dark:text-gray-300 text-sm flex items-center gap-1">
                            <span>💧</span>
                            <span>{t("forecast.precipitation", "Niederschlag")}</span>
                          </span>
                          <span className="font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap ml-2">
                            {dayData.precipitation.toFixed(1)} mm
                          </span>
                        </div>
                        {dayData.pop !== null && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
                            {(dayData.pop * 100).toFixed(0)}% Wahrscheinlichkeit
                          </div>
                        )}
                      </div>
                    )}
                    
                    {dayData.windSpeed !== null && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-neutral-700">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600 dark:text-gray-300 text-sm flex items-center gap-1">
                            <span>💨</span>
                            <span>{t("forecast.wind", "Wind")}</span>
                          </span>
                          <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap ml-2">
                            {dayData.windSpeed.toFixed(1)} km/h
                          </span>
                        </div>
                        {dayData.windGust !== null && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
                            Böen: {dayData.windGust.toFixed(1)} km/h
                          </div>
                        )}
                      </div>
                    )}
                    
                    {dayData.weather && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-neutral-700 text-center">
                        <div className="text-2xl mb-1">
                          {dayData.weather.icon && (
                            <img 
                              src={`https://openweathermap.org/img/wn/${dayData.weather.icon}@2x.png`}
                              alt={dayData.weather.description}
                              className="inline-block w-12 h-12"
                            />
                          )}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          {dayData.weather.description}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Meteoblue Forecast */}
      {loadingMB && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
          <p className="mt-2">{t("statuses.loading")}</p>
        </div>
      )}
      
      {errorMB && (
        <div className="bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-700 text-yellow-700 dark:text-yellow-200 px-4 py-3 rounded mb-6">
          <p className="font-semibold mb-1">⚠️ Meteoblue Prognose nicht verfügbar</p>
          <p className="text-sm">{errorMB}</p>
          <p className="text-xs mt-2">
            💡 Tipp: Registriere dich kostenlos auf meteoblue.com und bestätige die nicht-kommerzielle Nutzung.
          </p>
        </div>
      )}
      
      {meteoblueData.length > 0 && selectedStation && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">🇨🇭 Meteoblue (7 Tage)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {meteoblueData.map((dayData, index) => {
              const date = new Date(dayData.date);
              const dayLabel = date.toLocaleDateString("de-DE", { 
                weekday: "short", 
                day: "2-digit", 
                month: "2-digit" 
              });
              
              return (
                <div 
                  key={index} 
                  className="border border-gray-200 dark:border-neutral-700 rounded-lg p-5 bg-white dark:bg-neutral-800 shadow-sm"
                >
                  <h3 className="font-semibold text-center mb-3">{dayLabel}</h3>
                  
                  <div className="space-y-2">
                    {dayData.tempMax !== null && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-300 text-sm">
                          {t("forecast.maxTemp", "Max")}
                        </span>
                        <span className="font-medium text-red-600 dark:text-red-400">
                          {dayData.tempMax.toFixed(1)}°C
                        </span>
                      </div>
                    )}
                    
                    {dayData.tempMin !== null && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-300 text-sm">
                          {t("forecast.minTemp", "Min")}
                        </span>
                        <span className="font-medium text-blue-600 dark:text-blue-400">
                          {dayData.tempMin.toFixed(1)}°C
                        </span>
                      </div>
                    )}
                    
                    {dayData.tempMean !== null && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-300 text-sm">
                          {t("forecast.avgTemp", "Ø")}
                        </span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {dayData.tempMean.toFixed(1)}°C
                        </span>
                      </div>
                    )}
                    
                    {dayData.precipitation > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-neutral-700">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600 dark:text-gray-300 text-sm flex items-center gap-1">
                            <span>💧</span>
                            <span>{t("forecast.precipitation", "Niederschlag")}</span>
                          </span>
                          <span className="font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap ml-2">
                            {dayData.precipitation.toFixed(1)} mm
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {dayData.windSpeed !== null && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-neutral-700">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600 dark:text-gray-300 text-sm flex items-center gap-1">
                            <span>💨</span>
                            <span>{t("forecast.wind", "Wind")}</span>
                          </span>
                          <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap ml-2">
                            {dayData.windSpeed.toFixed(1)} km/h
                          </span>
                        </div>
                        {dayData.windGust !== null && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
                            Böen: {dayData.windGust.toFixed(1)} km/h
                          </div>
                        )}
                      </div>
                    )}
                    
                    {dayData.pictocode !== null && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-neutral-700 text-center">
                        <div className="mb-1">
                          <img 
                            src={`https://static.meteoblue.com/assets/images/picto/${dayData.pictocode}_iday.svg`}
                            alt={`Weather code ${dayData.pictocode}`}
                            className="inline-block w-16 h-16"
                            onError={(e) => {
                              // Fallback to emoji if image fails
                              const target = e.target as HTMLImageElement;
                              const parent = target.parentElement;
                              if (parent && dayData.pictocode !== null) {
                                parent.innerHTML = `<div class="text-4xl">${getWeatherEmoji(dayData.pictocode)}</div>`;
                              }
                            }}
                          />
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                          {t(`forecast.weather.${dayData.pictocode}`, t("forecast.weather.unknown", "Unknown"))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Meteoblue Meteogram */}
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-3">📊 Meteogramm (14 Tage)</h3>
            <div className="border border-gray-200 dark:border-neutral-700 rounded-lg p-4 bg-white dark:bg-neutral-800 shadow-sm overflow-x-auto">
              {(() => {
                const station = Object.values(stations).flat().find(s => s.id === selectedStation);
                if (!station) return null;
                
                // Use API route to get meteogram with server-side API key
                const meteogramUrl = `/api/forecast?action=meteogram&stationId=${selectedStation}`;
                
                return (
                  <img 
                    src={meteogramUrl}
                    alt={`Meteogramm für ${station.name}`}
                    className="w-full h-auto"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const parent = target.parentElement;
                      if (parent) {
                        parent.innerHTML = '<p class="text-center text-gray-500 dark:text-gray-400 py-4">Meteogramm konnte nicht geladen werden. Prüfe deinen Meteoblue API-Key.</p>';
                      }
                    }}
                  />
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

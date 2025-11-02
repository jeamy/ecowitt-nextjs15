"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

interface ForecastAccuracyData {
  stationId: string;
  days: number;
  data: {
    dailyComparisons: DailyComparison[];
    accuracyStats: AccuracyStats;
  };
  generated: string;
}

interface DailyComparison {
  date: string;
  actual: {
    tempMin: number | null;
    tempMax: number | null;
    precipitation: number | null;
    windSpeed: number | null;
  };
  forecasts: Record<string, {
    tempMin: number | null;
    tempMax: number | null;
    precipitation: number | null;
    windSpeed: number | null;
  }>;
  errors: Record<string, {
    tempMinError: number | null;
    tempMaxError: number | null;
    precipitationError: number | null;
    windSpeedError: number | null;
  }>;
}

interface AccuracyStats {
  [source: string]: {
    sampleSize: number;
    tempMin: { mae: number | null; rmse: number | null };
    tempMax: { mae: number | null; rmse: number | null };
    precipitation: { mae: number | null; rmse: number | null };
    windSpeed: { mae: number | null; rmse: number | null };
  };
}

export default function ForecastAnalysis() {
  const { t } = useTranslation();
  const [stationId, setStationId] = useState("");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ForecastAccuracyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stations, setStations] = useState<Record<string, any[]>>({});

  useEffect(() => {
    fetchStations();
    loadDefaultStation();
  }, []);
  
  const loadDefaultStation = async () => {
    try {
      const response = await fetch("/api/config/forecast-station");
      if (response.ok) {
        const data = await response.json();
        setStationId(data.stationId);
      }
    } catch (err) {
      console.error("Failed to load default station:", err);
      setStationId("11035"); // Fallback: Wien Hohe Warte
    }
  };

  useEffect(() => {
    if (stationId) {
      fetchAnalysis();
    }
  }, [stationId, days]);

  const fetchStations = async () => {
    try {
      const response = await fetch("/api/forecast?action=stations");
      const stationsData = await response.json();
      setStations(stationsData.stations || {});
    } catch (err) {
      console.error("Failed to fetch stations:", err);
    }
  };

  const fetchAnalysis = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/forecast/compare?stationId=${stationId}&days=${days}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const analysisData = await response.json();
      setData(analysisData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getSourceName = (source: string) => {
    const names: Record<string, string> = {
      geosphere: "Geosphere 🇦🇹",
      openweather: "OpenWeatherMap 🌍",
      meteoblue: "Meteoblue 🇨🇭",
      openmeteo: "Open-Meteo 🌍"
    };
    return names[source] || source;
  };

  const formatError = (error: number | null) => {
    if (error === null) return "N/A";
    return error.toFixed(1);
  };

  if (loading) return <div className="p-6">Lade Analyse-Daten...</div>;
  if (error) return <div className="p-6 text-red-500">Fehler: {error}</div>;
  if (!data) return <div className="p-6">Keine Daten verfügbar</div>;

  return (
    <div className="p-6 space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end bg-white p-4 rounded-lg shadow">
        <div>
          <label className="block text-sm font-medium mb-1">Station</label>
          <select
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
            className="border rounded px-3 py-2"
          >
            {Object.entries(stations).map(([state, stateStations]) => (
              <optgroup key={state} label={state}>
                {stateStations.map((station: any) => (
                  <option key={station.id} value={station.id}>
                    {station.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-1">Tage</label>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="border rounded px-3 py-2"
          >
            <option value={7}>7 Tage</option>
            <option value={14}>14 Tage</option>
            <option value={30}>30 Tage</option>
            <option value={60}>60 Tage</option>
          </select>
        </div>
        
        <button
          onClick={fetchAnalysis}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          disabled={loading}
        >
          {loading ? "Lädt..." : "Aktualisieren"}
        </button>
      </div>

      {/* Summary Stats */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">Vorhersage-Genauigkeit (MAE)</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Quelle</th>
                <th className="text-left p-2">Samples</th>
                <th className="text-left p-2">Temp Min (°C)</th>
                <th className="text-left p-2">Temp Max (°C)</th>
                <th className="text-left p-2">Niederschlag (mm)</th>
                <th className="text-left p-2">Wind (km/h)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.data.accuracyStats).map(([source, stats]) => (
                <tr key={source} className="border-b hover:bg-gray-50">
                  <td className="p-2 font-medium">{getSourceName(source)}</td>
                  <td className="p-2">{stats.sampleSize}</td>
                  <td className="p-2">{formatError(stats.tempMin.mae)}</td>
                  <td className="p-2">{formatError(stats.tempMax.mae)}</td>
                  <td className="p-2">{formatError(stats.precipitation.mae)}</td>
                  <td className="p-2">{formatError(stats.windSpeed.mae)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Daily Comparisons */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">Tägliche Vergleiche (letzten 10 Tage)</h2>
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {data.data.dailyComparisons.slice(0, 10).map((comparison, index) => (
            <div key={index} className="border rounded p-4">
              <h3 className="font-semibold mb-2">{new Date(comparison.date).toLocaleDateString('de-DE')}</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(comparison.forecasts).map(([source, forecast]) => {
                  const errors = comparison.errors[source];
                  return (
                    <div key={source} className="border rounded p-3">
                      <h4 className="font-medium text-sm mb-2">{getSourceName(source)}</h4>
                      
                      <div className="space-y-1 text-xs">
                        <div>
                          <span className="text-gray-600">Temp Min: </span>
                          <span className={errors.tempMinError && errors.tempMinError > 2 ? "text-red-500" : ""}>
                            {forecast.tempMin?.toFixed(1) ?? "N/A"} vs {comparison.actual.tempMin?.toFixed(1) ?? "N/A"}
                            {errors.tempMinError && ` (${errors.tempMinError.toFixed(1)}°C)`}
                          </span>
                        </div>
                        
                        <div>
                          <span className="text-gray-600">Temp Max: </span>
                          <span className={errors.tempMaxError && errors.tempMaxError > 2 ? "text-red-500" : ""}>
                            {forecast.tempMax?.toFixed(1) ?? "N/A"} vs {comparison.actual.tempMax?.toFixed(1) ?? "N/A"}
                            {errors.tempMaxError && ` (${errors.tempMaxError.toFixed(1)}°C)`}
                          </span>
                        </div>
                        
                        <div>
                          <span className="text-gray-600">Regen: </span>
                          <span className={errors.precipitationError && errors.precipitationError > 1 ? "text-red-500" : ""}>
                            {forecast.precipitation?.toFixed(1) ?? "0"} vs {comparison.actual.precipitation?.toFixed(1) ?? "0"}
                            {errors.precipitationError && ` (${errors.precipitationError.toFixed(1)}mm)`}
                          </span>
                        </div>
                        
                        <div>
                          <span className="text-gray-600">Wind: </span>
                          <span className={errors.windSpeedError && errors.windSpeedError > 5 ? "text-red-500" : ""}>
                            {forecast.windSpeed?.toFixed(1) ?? "N/A"} vs {comparison.actual.windSpeed?.toFixed(1) ?? "N/A"}
                            {errors.windSpeedError && ` (${errors.windSpeedError.toFixed(1)}km/h)`}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Info:</strong> Diese Analyse vergleicht gespeicherte Vorhersagen mit den tatsächlichen Wetterdaten.
          MAE = Mean Absolute Error (mittlerer absoluter Fehler). Niedrigere Werte bedeuten bessere Genauigkeit.
          Die Farben zeigen Abweichungen: Rot bei größeren Fehlern.
        </p>
      </div>
    </div>
  );
}

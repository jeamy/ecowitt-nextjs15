"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { API_ENDPOINTS } from "@/constants";

interface ForecastAccuracyData {
  stationId: string;
  days: number;
  data: {
    dailyComparisons: DailyComparison[];
    accuracyStats: AccuracyStats;
  };
  generated: string;
  isDemo?: boolean;
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
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-GB" : "de-DE";
  const [stationId, setStationId] = useState("");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ForecastAccuracyData | null>(null);
  const [loading, setLoading] = useState(true); // Start with loading true
  const [error, setError] = useState<string | null>(null);
  const [stations, setStations] = useState<Record<string, any[]>>({});

  useEffect(() => {
    fetchStations();
    loadDefaultStation();
  }, []);

  const loadDefaultStation = async () => {
    try {
      const response = await fetch(API_ENDPOINTS.CONFIG_FORECAST_STATION);
      if (response.ok) {
        const data = await response.json();
        console.log('[ForecastAnalysis] Loaded default station:', data.stationId);
        setStationId(data.stationId);
      } else {
        console.log('[ForecastAnalysis] Failed to load default station, using fallback');
        setStationId("11035"); // Fallback: Wien Hohe Warte
      }
    } catch (err) {
      console.error("[ForecastAnalysis] Failed to load default station:", err);
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
      const response = await fetch(API_ENDPOINTS.FORECAST_STATIONS);
      if (!response.ok) {
        console.warn(`[ForecastAnalysis] Failed to fetch stations: ${response.status} - skipping station list`);
        setStations({});
        return;
      }
      const stationsData = await response.json();
      setStations(stationsData.stations || {});
    } catch (err) {
      console.error("[ForecastAnalysis] Failed to fetch stations:", err);
      setStations({});
    }
  };

  const fetchAnalysis = async () => {
    console.log(`[ForecastAnalysis] Fetching analysis for station ${stationId}, days ${days}`);
    setLoading(true);
    setError(null);

    try {
      // Try to fetch stored analysis first
      const response = await fetch(`${API_ENDPOINTS.FORECAST_ANALYSIS}?stationId=${stationId}&days=${days}`);
      console.log(`[ForecastAnalysis] API response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ForecastAnalysis] API error: ${response.status}`, errorText);
        // Show demo data on error
        setData(generateDemoData(stationId, days));
        setLoading(false);
        return;
      }

      const analysisData = await response.json();
      console.log(`[ForecastAnalysis] Received data:`, analysisData);

      // Check if we have any data
      if (!analysisData.dailyAnalysis || analysisData.dailyAnalysis.length === 0 || !analysisData.hasData) {
        console.log('[ForecastAnalysis] No analysis data available, showing demo data');
        // Show demo data if no real data available
        setData(generateDemoData(stationId, days));
        setLoading(false);
        return;
      }

      // Transform to match existing data structure
      setData({
        stationId: analysisData.stationId,
        days: analysisData.days,
        data: {
          dailyComparisons: analysisData.dailyAnalysis.map((day: any) => ({
            date: day.date,
            actual: day.forecasts[0]?.actual || {},
            forecasts: day.forecasts.reduce((acc: any, f: any) => {
              acc[f.source] = f.forecast;
              return acc;
            }, {}),
            errors: day.forecasts.reduce((acc: any, f: any) => {
              acc[f.source] = {
                tempMinError: f.errors.tempMin,
                tempMaxError: f.errors.tempMax,
                precipitationError: f.errors.precipitation,
                windSpeedError: f.errors.windSpeed
              };
              return acc;
            }, {})
          })),
          accuracyStats: analysisData.accuracyStats
        },
        generated: analysisData.generated,
        isDemo: false
      });
    } catch (err: any) {
      console.error('[ForecastAnalysis] Fetch error:', err);
      // On error, show demo data
      setData(generateDemoData(stationId || "11035", days));
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  const generateDemoData = (stationId: string, days: number) => {
    const dailyComparisons = [];
    const sources = ['geosphere', 'openweather', 'meteoblue', 'openmeteo'];

    // Generate demo data for the last 7 days
    for (let i = 1; i <= Math.min(days, 7); i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const actual = {
        tempMin: 8 + Math.random() * 5,
        tempMax: 18 + Math.random() * 5,
        precipitation: Math.random() > 0.7 ? Math.random() * 10 : 0,
        windSpeed: 10 + Math.random() * 15
      };

      const forecasts: any = {};
      const errors: any = {};

      sources.forEach(source => {
        const tempMinError = Math.random() * 3;
        const tempMaxError = Math.random() * 3;
        const precipError = Math.random() * 5;
        const windError = Math.random() * 8;

        forecasts[source] = {
          tempMin: actual.tempMin + (Math.random() > 0.5 ? tempMinError : -tempMinError),
          tempMax: actual.tempMax + (Math.random() > 0.5 ? tempMaxError : -tempMaxError),
          precipitation: Math.max(0, actual.precipitation + (Math.random() > 0.5 ? precipError : -precipError)),
          windSpeed: actual.windSpeed + (Math.random() > 0.5 ? windError : -windError)
        };

        errors[source] = {
          tempMinError,
          tempMaxError,
          precipitationError: precipError,
          windSpeedError: windError
        };
      });

      dailyComparisons.push({
        date: dateStr,
        actual,
        forecasts,
        errors
      });
    }

    // Calculate demo accuracy stats
    const accuracyStats: any = {};
    sources.forEach(source => {
      accuracyStats[source] = {
        sampleSize: dailyComparisons.length,
        tempMin: {
          mae: 1.5 + Math.random() * 1.5,
          rmse: 2.0 + Math.random() * 2.0
        },
        tempMax: {
          mae: 1.8 + Math.random() * 1.5,
          rmse: 2.3 + Math.random() * 2.0
        },
        precipitation: {
          mae: 2.5 + Math.random() * 2.0,
          rmse: 3.5 + Math.random() * 2.5
        },
        windSpeed: {
          mae: 4.0 + Math.random() * 3.0,
          rmse: 5.5 + Math.random() * 3.5
        }
      };
    });

    return {
      stationId,
      days,
      data: {
        dailyComparisons,
        accuracyStats
      },
      generated: new Date().toISOString(),
      isDemo: true
    };
  };

  const getSourceName = (source: string) => {
    const names: Record<string, string> = {
      geosphere: t("analysis.sourceGeosphere"),
      openweather: t("analysis.sourceOpenweather"),
      meteoblue: t("analysis.sourceMeteoblue"),
      openmeteo: t("analysis.sourceOpenmeteo")
    };
    return names[source] || source;
  };

  const formatError = (error: number | null) => {
    if (error === null) return "N/A";
    return error.toFixed(1);
  };

  if (loading) return <div className="p-6">{t("analysis.loading")}</div>;
  if (error) return <div className="p-6 text-red-500">{t("analysis.errorPrefix")} {error}</div>;
  if (!data) return <div className="p-6">{t("analysis.noData")}</div>;

  return (
    <div className="p-6 space-y-6">
      {/* Demo Data Warning */}
      {data.isDemo && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">ℹ️</span>
            <div>
              <h3 className="font-semibold text-yellow-800">{t("analysis.demoTitle")}</h3>
              <p className="text-sm text-yellow-700">
                {t("analysis.demoText")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end bg-white p-4 rounded-lg shadow">
        <div>
          <label className="block text-sm font-medium mb-1">{t("analysis.stationLabel")}</label>
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
          <label className="block text-sm font-medium mb-1">{t("analysis.daysLabel")}</label>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="border rounded px-3 py-2"
          >
            <option value={7}>{t("analysis.days7")}</option>
            <option value={14}>{t("analysis.days14")}</option>
            <option value={30}>{t("analysis.days30")}</option>
            <option value={60}>{t("analysis.days60")}</option>
          </select>
        </div>

        <button
          onClick={fetchAnalysis}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          disabled={loading}
        >
          {loading ? t("analysis.refreshLoading") : t("analysis.refresh")}
        </button>
      </div>

      {/* Summary Stats */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">{t("analysis.summaryTitle")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">{t("analysis.columnSource")}</th>
                <th className="text-left p-2">{t("analysis.columnSamples")}</th>
                <th className="text-left p-2">{t("analysis.columnTempMin")}</th>
                <th className="text-left p-2">{t("analysis.columnTempMax")}</th>
                <th className="text-left p-2">{t("analysis.columnPrecipitation")}</th>
                <th className="text-left p-2">{t("analysis.columnWind")}</th>
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
        <h2 className="text-xl font-bold mb-4">{t("analysis.dailyTitle")}</h2>
        <div className="space-y-2">
          {data.data.dailyComparisons.map((comparison, index) => (
            <details key={index} className="border rounded">
              <summary className="cursor-pointer p-4 hover:bg-gray-50 font-semibold">
                {new Date(comparison.date).toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              </summary>

              <div className="p-4 pt-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(comparison.forecasts).map(([source, forecast]) => {
                  const errors = comparison.errors[source];
                  return (
                    <div key={source} className="border rounded p-3">
                      <h4 className="font-medium text-sm mb-2">{getSourceName(source)}</h4>

                      <div className="space-y-1 text-xs">
                        <div>
                          <span className="text-gray-600">{t("analysis.tempMinLabel")} </span>
                          <span className={errors.tempMinError && errors.tempMinError > 2 ? "text-red-500" : ""}>
                            {forecast.tempMin?.toFixed(1) ?? "N/A"} vs {comparison.actual.tempMin?.toFixed(1) ?? "N/A"}
                            {errors.tempMinError && ` (${errors.tempMinError.toFixed(1)}°C)`}
                          </span>
                        </div>

                        <div>
                          <span className="text-gray-600">{t("analysis.tempMaxLabel")} </span>
                          <span className={errors.tempMaxError && errors.tempMaxError > 2 ? "text-red-500" : ""}>
                            {forecast.tempMax?.toFixed(1) ?? "N/A"} vs {comparison.actual.tempMax?.toFixed(1) ?? "N/A"}
                            {errors.tempMaxError && ` (${errors.tempMaxError.toFixed(1)}°C)`}
                          </span>
                        </div>

                        <div>
                          <span className="text-gray-600">{t("analysis.rainLabel")} </span>
                          <span className={errors.precipitationError && errors.precipitationError > 1 ? "text-red-500" : ""}>
                            {forecast.precipitation?.toFixed(1) ?? "0"} vs {comparison.actual.precipitation?.toFixed(1) ?? "0"}
                            {errors.precipitationError && ` (${errors.precipitationError.toFixed(1)}mm)`}
                          </span>
                        </div>

                        <div>
                          <span className="text-gray-600">{t("analysis.windLabel")} </span>
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
            </details>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>{t("analysis.infoTitle")}</strong> {t("analysis.infoText")}
        </p>
      </div>
    </div>
  );
}

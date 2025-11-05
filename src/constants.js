// API Endpoints
export const API_ENDPOINTS = {
  // Realtime data
  RT_LAST: '/api/rt/last',
  
  // Configuration
  CONFIG_CHANNELS: '/api/config/channels',
  
  // Device info
  DEVICE_INFO: '/api/device/info',
  
  // Temperature min/max
  TEMP_MINMAX: '/api/temp-minmax',
  TEMP_MINMAX_UPDATE: '/api/temp-minmax/update',
  
  // Data endpoints
  DATA_MONTHS: '/api/data/months',
  DATA_EXTENT: '/api/data/extent',
  DATA_ALLSENSORS: '/api/data/allsensors',
  DATA_MAIN: '/api/data/main',
  
  // Statistics endpoints
  STATISTICS: '/api/statistics',
  STATISTICS_UPDATE: '/api/statistics/update',
  STATISTICS_DAILY: '/api/statistics/daily',
  // Dashboard/server-side range statistics
  STATISTICS_RANGE: '/api/statistics/range',
  STATISTICS_CHANNELS: '/api/statistics/channels',
  
  // Forecast endpoints
  FORECAST_STATIONS: '/api/forecast?action=stations',
  FORECAST_DATA: '/api/forecast?action=forecast',
  FORECAST_METEOBLUE: '/api/forecast?action=meteoblue',
  FORECAST_OPENMETEO: '/api/forecast?action=openmeteo',
  FORECAST_OPENWEATHER: '/api/forecast?action=openweather',
  // Forecast storage/analysis
  FORECAST_STORE: '/api/forecast/store',
  FORECAST_ANALYZE: '/api/forecast/analyze',
  FORECAST_ANALYSIS: '/api/forecast/analysis',
  // Config
  CONFIG_FORECAST_STATION: '/api/config/forecast-station',
};

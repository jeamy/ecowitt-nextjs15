/**
 * A collection of API endpoint paths used throughout the application.
 * @property {string} RT_LAST - Endpoint for the last received real-time data.
 * @property {string} CONFIG_CHANNELS - Endpoint for channel configuration.
 * @property {string} DEVICE_INFO - Endpoint for device information (timezone, coordinates).
 * @property {string} TEMP_MINMAX - Endpoint to get today's min/max temperature data.
 * @property {string} TEMP_MINMAX_UPDATE - Endpoint to trigger an update of min/max data.
 * @property {string} DATA_MONTHS - Endpoint to get the list of available months with data.
 * @property {string} DATA_EXTENT - Endpoint to get the global time range of all data.
 * @property {string} DATA_ALLSENSORS - Endpoint for historical data from all channel sensors.
 * @property {string} DATA_MAIN - Endpoint for historical data from the main weather station sensors.
 */
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
  DATA_DAILY_CHART: '/api/data/dailychart',
};

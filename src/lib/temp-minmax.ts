import fs from 'fs';
import path from 'path';

/**
 * Interface for storing daily minimum and maximum temperature and humidity data.
 */
interface TempMinMax {
  /** The date in YYYY-MM-DD format. */
  date: string;
  /** A map of sensor keys to their min/max temperature data. */
  sensors: {
    [sensorKey: string]: {
      min: number;
      max: number;
      minTime: string; // ISO timestamp
      maxTime: string; // ISO timestamp
    };
  };
  /** A map of sensor keys to their min/max humidity data. */
  humidity: {
    [sensorKey: string]: {
      min: number;
      max: number;
      minTime: string; // ISO timestamp
      maxTime: string; // ISO timestamp
    };
  };
}

const DATA_FILE = path.join(process.cwd(), 'temp-minmax-data.json');

/**
 * Loads today's min/max data from the JSON file.
 * @returns {TempMinMax | null} The data for today, or null if it doesn't exist or an error occurs.
 * @private
 */
function loadData(): TempMinMax | null {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      const data = JSON.parse(content);
      const today = getTodayDate();
      
      // Only return today's data, ignore everything else
      if (data && data.date === today) {
        return data;
      }
    }
  } catch (error) {
    console.error('Error loading temp min/max data:', error);
  }
  return null;
}

/**
 * Saves the min/max data to the JSON file.
 * @param {TempMinMax} data - The data to save.
 * @private
 */
function saveData(data: TempMinMax): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving temp min/max data:', error);
  }
}

/**
 * Gets today's date in YYYY-MM-DD format.
 * @returns {string} Today's date string.
 * @private
 */
function getTodayDate(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function numericValue(input: any): number | null {
  const raw = input && typeof input === 'object' && 'value' in input ? input.value : input;
  if (raw == null) return null;
  const value = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function collectSensor(
  target: Record<string, number>,
  sensorKey: string,
  input: any
): void {
  const value = numericValue(input);
  if (value !== null) target[sensorKey] = value;
}

/**
 * Updates the min/max temperature and humidity for the current day based on new sensor data.
 * @param {Record<string, any>} sensorData - The latest sensor data payload.
 */
export function updateTempMinMax(sensorData: Record<string, any>): void {
  const today = getTodayDate();
  const now = new Date().toISOString();
  let todayEntry = loadData();
  
  // Create today's entry if it doesn't exist or is from a different day
  if (!todayEntry || todayEntry.date !== today) {
    todayEntry = {
      date: today,
      sensors: {},
      humidity: {}
    };
  }
  
  // Ensure humidity object exists even for existing entries
  if (!todayEntry.humidity) {
    todayEntry.humidity = {};
  }
  
  // Extract temperature and humidity values from sensor data
  const tempSensors: Record<string, number> = {};
  const humiditySensors: Record<string, number> = {};
  
  // Indoor temperature and humidity
  collectSensor(tempSensors, 'indoor', sensorData.indoor?.temperature);
  collectSensor(humiditySensors, 'indoor', sensorData.indoor?.humidity);
  
  // Outdoor temperature and humidity
  collectSensor(tempSensors, 'outdoor', sensorData.outdoor?.temperature);
  collectSensor(humiditySensors, 'outdoor', sensorData.outdoor?.humidity);
  
  // Channel temperatures and humidity - check all possible channel formats
  Object.keys(sensorData).forEach(key => {
    if (/^(ch\d+|temp_and_humidity_ch\d+)$/i.test(key)) {
      collectSensor(tempSensors, key, sensorData[key]?.temperature);
      collectSensor(humiditySensors, key, sensorData[key]?.humidity);
    }
  });
  
  // Update min/max for each temperature sensor
  Object.entries(tempSensors).forEach(([sensorKey, temp]) => {
    if (!Number.isFinite(temp)) return;
    
    if (!todayEntry!.sensors[sensorKey]) {
      todayEntry!.sensors[sensorKey] = {
        min: temp,
        max: temp,
        minTime: now,
        maxTime: now
      };
    } else {
      const sensor = todayEntry!.sensors[sensorKey];
      if (temp < sensor.min) {
        sensor.min = temp;
        sensor.minTime = now;
      }
      if (temp > sensor.max) {
        sensor.max = temp;
        sensor.maxTime = now;
      }
    }
  });
  
  // Update min/max for each humidity sensor
  Object.entries(humiditySensors).forEach(([sensorKey, humidity]) => {
    if (!Number.isFinite(humidity)) return;
    
    if (!todayEntry!.humidity[sensorKey]) {
      todayEntry!.humidity[sensorKey] = {
        min: humidity,
        max: humidity,
        minTime: now,
        maxTime: now
      };
    } else {
      const sensor = todayEntry!.humidity[sensorKey];
      if (humidity < sensor.min) {
        sensor.min = humidity;
        sensor.minTime = now;
      }
      if (humidity > sensor.max) {
        sensor.max = humidity;
        sensor.maxTime = now;
      }
    }
  });
  
  // Save only today's data
  saveData(todayEntry!);
}

/**
 * Gets today's min/max temperature and humidity data.
 * @returns {TempMinMax | null} The data for today, or null if not found.
 */
export function getTodayTempMinMax(): TempMinMax | null {
  return loadData();
}

/**
 * Gets all stored min/max data. Note: This currently only returns today's data.
 * @returns {TempMinMax[]} An array containing today's min/max data, or an empty array if none exists.
 */
export function getAllTempMinMax(): TempMinMax[] {
  const data = loadData();
  return data ? [data] : [];
}

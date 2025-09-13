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
  return new Date().toISOString().split('T')[0];
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
  if (sensorData.indoor?.temperature != null) {
    const temp = sensorData.indoor.temperature.value || sensorData.indoor.temperature;
    if (temp != null && !isNaN(parseFloat(temp))) {
      tempSensors['indoor'] = parseFloat(temp);
    }
  }
  if (sensorData.indoor?.humidity != null) {
    const humidity = sensorData.indoor.humidity.value || sensorData.indoor.humidity;
    if (humidity != null && !isNaN(parseFloat(humidity))) {
      humiditySensors['indoor'] = parseFloat(humidity);
    }
  }
  
  // Outdoor temperature and humidity
  if (sensorData.outdoor?.temperature != null) {
    const temp = sensorData.outdoor.temperature.value || sensorData.outdoor.temperature;
    if (temp != null && !isNaN(parseFloat(temp))) {
      tempSensors['outdoor'] = parseFloat(temp);
    }
  }
  if (sensorData.outdoor?.humidity != null) {
    const humidity = sensorData.outdoor.humidity.value || sensorData.outdoor.humidity;
    if (humidity != null && !isNaN(parseFloat(humidity))) {
      humiditySensors['outdoor'] = parseFloat(humidity);
    }
  }
  
  // Channel temperatures and humidity - check all possible channel formats
  Object.keys(sensorData).forEach(key => {
    if (/^(ch\d+|temp_and_humidity_ch\d+)$/i.test(key)) {
      const tempObj = sensorData[key]?.temperature;
      if (tempObj != null) {
        const temp = tempObj.value || tempObj;
        if (temp != null && !isNaN(parseFloat(temp))) {
          tempSensors[key] = parseFloat(temp);
        }
      }
      
      const humidityObj = sensorData[key]?.humidity;
      if (humidityObj != null) {
        const humidity = humidityObj.value || humidityObj;
        if (humidity != null && !isNaN(parseFloat(humidity))) {
          humiditySensors[key] = parseFloat(humidity);
        }
      }
    }
  });
  
  // Update min/max for each temperature sensor
  Object.entries(tempSensors).forEach(([sensorKey, temp]) => {
    if (!isFinite(temp)) return;
    
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
    if (!isFinite(humidity)) return;
    
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
 * Gets the min/max data for a specific date. Note: This currently only works for today.
 * @param {string} date - The date in YYYY-MM-DD format.
 * @returns {TempMinMax | null} The data for the specified date, or null if not found.
 */
export function getTempMinMaxForDate(date: string): TempMinMax | null {
  const data = loadData();
  if (data && data.date === date) {
    return data;
  }
  return null;
}

/**
 * Gets all stored min/max data. Note: This currently only returns today's data.
 * @returns {TempMinMax[]} An array containing today's min/max data, or an empty array if none exists.
 */
export function getAllTempMinMax(): TempMinMax[] {
  const data = loadData();
  return data ? [data] : [];
}

import fs from 'fs';
import path from 'path';

interface TempMinMax {
  date: string; // YYYY-MM-DD format
  sensors: {
    [sensorKey: string]: {
      min: number;
      max: number;
      minTime: string; // ISO timestamp
      maxTime: string; // ISO timestamp
    };
  };
}

const DATA_FILE = path.join(process.cwd(), 'temp-minmax-data.json');

// Load existing data from file (only today's data)
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

// Save data to file
function saveData(data: TempMinMax): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving temp min/max data:', error);
  }
}

// Get today's date in YYYY-MM-DD format
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// Update min/max temperatures for current day
export function updateTempMinMax(sensorData: Record<string, any>): void {
  const today = getTodayDate();
  const now = new Date().toISOString();
  let todayEntry = loadData();
  
  // Create today's entry if it doesn't exist or is from a different day
  if (!todayEntry || todayEntry.date !== today) {
    todayEntry = {
      date: today,
      sensors: {}
    };
  }
  
  // Extract temperature values from sensor data
  const tempSensors: Record<string, number> = {};
  
  // Indoor temperature
  if (sensorData.indoor?.temperature != null) {
    const temp = sensorData.indoor.temperature.value || sensorData.indoor.temperature;
    if (temp != null && !isNaN(parseFloat(temp))) {
      tempSensors['indoor'] = parseFloat(temp);
    }
  }
  
  // Outdoor temperature
  if (sensorData.outdoor?.temperature != null) {
    const temp = sensorData.outdoor.temperature.value || sensorData.outdoor.temperature;
    if (temp != null && !isNaN(parseFloat(temp))) {
      tempSensors['outdoor'] = parseFloat(temp);
    }
  }
  
  // Channel temperatures - check all possible channel formats
  Object.keys(sensorData).forEach(key => {
    if (/^(ch\d+|temp_and_humidity_ch\d+)$/i.test(key)) {
      const tempObj = sensorData[key]?.temperature;
      if (tempObj != null) {
        const temp = tempObj.value || tempObj;
        if (temp != null && !isNaN(parseFloat(temp))) {
          tempSensors[key] = parseFloat(temp);
        }
      }
    }
  });
  
  console.log(`[temp-minmax] Processing ${Object.keys(tempSensors).length} temperature sensors:`, Object.keys(tempSensors));
  
  // Update min/max for each sensor
  Object.entries(tempSensors).forEach(([sensorKey, temp]) => {
    if (!isFinite(temp)) return;
    
    if (!todayEntry.sensors[sensorKey]) {
      todayEntry.sensors[sensorKey] = {
        min: temp,
        max: temp,
        minTime: now,
        maxTime: now
      };
    } else {
      const sensor = todayEntry.sensors[sensorKey];
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
  
  // Save only today's data
  saveData(todayEntry);
}

// Get today's min/max temperatures
export function getTodayTempMinMax(): TempMinMax | null {
  return loadData();
}

// Get min/max data for a specific date (only works for today)
export function getTempMinMaxForDate(date: string): TempMinMax | null {
  const data = loadData();
  if (data && data.date === date) {
    return data;
  }
  return null;
}

// Get all min/max data (for debugging - only today's data)
export function getAllTempMinMax(): TempMinMax[] {
  const data = loadData();
  return data ? [data] : [];
}

import fs from 'fs';
import path from 'path';

/**
 * Interface for storing daily minimum and maximum temperature and humidity data.
 */
export interface TempMinMax {
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

const DATA_FILENAME = 'temp-minmax-data.json';
const PERSISTENT_DATA_FILE = path.join(process.cwd(), 'DNT', DATA_FILENAME);
const LEGACY_DATA_FILE = path.join(process.cwd(), DATA_FILENAME);

type MinMaxValue = TempMinMax['sensors'][string];

function ensureDataDir(): void {
  fs.mkdirSync(path.dirname(PERSISTENT_DATA_FILE), { recursive: true });
}

function dataFilePath(): string {
  ensureDataDir();
  if (!fs.existsSync(PERSISTENT_DATA_FILE) && fs.existsSync(LEGACY_DATA_FILE)) {
    try {
      fs.copyFileSync(LEGACY_DATA_FILE, PERSISTENT_DATA_FILE);
      console.log(`[temp-minmax] migrated legacy data file to ${PERSISTENT_DATA_FILE}`);
    } catch (error) {
      console.error('Error migrating legacy temp min/max data:', error);
    }
  }
  return PERSISTENT_DATA_FILE;
}

function hasMeasurements(data: TempMinMax | null): data is TempMinMax {
  return Boolean(data && (
    Object.keys(data.sensors || {}).length > 0
    || Object.keys(data.humidity || {}).length > 0
  ));
}

/**
 * Loads today's min/max data from the JSON file.
 * @returns {TempMinMax | null} The data for today, or null if it doesn't exist or an error occurs.
 * @private
 */
function loadData(options: { reconstruct?: boolean } = {}): TempMinMax | null {
  try {
    const file = dataFilePath();
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      const data = JSON.parse(content);
      const today = getTodayDate();
      
      // Only return today's data, ignore everything else
      if (data && data.date === today && hasMeasurements(data)) {
        return data;
      }
    }
  } catch (error) {
    console.error('Error loading temp min/max data:', error);
  }
  if (options.reconstruct !== false) {
    const reconstructed = reconstructTodayFromArchive();
    if (hasMeasurements(reconstructed)) {
      saveData(reconstructed);
      return reconstructed;
    }
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
    const file = dataFilePath();
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
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

function getCurrentMonth(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}${mm}`;
}

function datePrefixForCsv(date: string): string {
  return date.replaceAll('-', '/');
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

function normalizeColumnName(name: string): string {
  return name
    .normalize('NFKC')
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      cols.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current);
  return cols;
}

function parseCsvRows(absPath: string): Array<Record<string, string>> {
  if (!fs.existsSync(absPath)) return [];
  const lines = fs.readFileSync(absPath, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  if (lines[0].charCodeAt(0) === 0xfeff) lines[0] = lines[0].slice(1);
  const header = parseCsvLine(lines[0]).map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return Object.fromEntries(header.map((key, index) => [key, (cols[index] ?? '').trim()]));
  });
}

function csvNumber(input: string | undefined): number | null {
  if (input == null || input === '' || input === '--') return null;
  const value = Number(String(input).replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function csvTimeToIso(input: string): string {
  const match = input.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})/);
  if (!match) return new Date().toISOString();
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function addMinMax(target: Record<string, MinMaxValue>, sensorKey: string, value: number | null, time: string): void {
  if (value === null || !Number.isFinite(value)) return;
  const isoTime = csvTimeToIso(time);
  const current = target[sensorKey];
  if (!current) {
    target[sensorKey] = { min: value, max: value, minTime: isoTime, maxTime: isoTime };
    return;
  }
  if (value < current.min) {
    current.min = value;
    current.minTime = isoTime;
  }
  if (value > current.max) {
    current.max = value;
    current.maxTime = isoTime;
  }
}

function columnByNormalized(header: string[], normalizedName: string): string | undefined {
  return header.find((name) => {
    const normalized = normalizeColumnName(name);
    return normalized === normalizedName || normalized.startsWith(normalizedName);
  });
}

function reconstructTodayFromArchive(): TempMinMax | null {
  const today = getTodayDate();
  const todayPrefix = datePrefixForCsv(today);
  const month = getCurrentMonth();
  const dntDir = path.join(process.cwd(), 'DNT');
  const result: TempMinMax = { date: today, sensors: {}, humidity: {} };

  try {
    const mainRows = parseCsvRows(path.join(dntDir, `${month}A.CSV`));
    if (mainRows.length) {
      const header = Object.keys(mainRows[0]);
      const indoorTemp = columnByNormalized(header, 'temperaturinnen');
      const indoorHumidity = columnByNormalized(header, 'luftfeuchtigkeitinnen');
      const outdoorTemp = columnByNormalized(header, 'temperaturaussen');
      const outdoorHumidity = columnByNormalized(header, 'luftfeuchtigkeitaussen');
      for (const row of mainRows) {
        if (!row.Zeit?.startsWith(todayPrefix)) continue;
        addMinMax(result.sensors, 'indoor', csvNumber(indoorTemp ? row[indoorTemp] : undefined), row.Zeit);
        addMinMax(result.humidity, 'indoor', csvNumber(indoorHumidity ? row[indoorHumidity] : undefined), row.Zeit);
        addMinMax(result.sensors, 'outdoor', csvNumber(outdoorTemp ? row[outdoorTemp] : undefined), row.Zeit);
        addMinMax(result.humidity, 'outdoor', csvNumber(outdoorHumidity ? row[outdoorHumidity] : undefined), row.Zeit);
      }
    }

    const allsensorsRows = parseCsvRows(path.join(dntDir, `${month}Allsensors_A.CSV`));
    if (allsensorsRows.length) {
      const header = Object.keys(allsensorsRows[0]);
      for (let channel = 1; channel <= 8; channel += 1) {
        const sensorKey = `temp_and_humidity_ch${channel}`;
        const tempColumn = columnByNormalized(header, `ch${channel}temperature`);
        const humidityColumn = columnByNormalized(header, `ch${channel}luftfeuchtigkeit`);
        for (const row of allsensorsRows) {
          if (!row.Zeit?.startsWith(todayPrefix)) continue;
          addMinMax(result.sensors, sensorKey, csvNumber(tempColumn ? row[tempColumn] : undefined), row.Zeit);
          addMinMax(result.humidity, sensorKey, csvNumber(humidityColumn ? row[humidityColumn] : undefined), row.Zeit);
        }
      }
    }

    if (hasMeasurements(result)) {
      console.log(`[temp-minmax] reconstructed ${today} from DNT archive`);
      return result;
    }
  } catch (error) {
    console.error('Error reconstructing temp min/max from DNT archive:', error);
  }
  return null;
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

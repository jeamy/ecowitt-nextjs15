import { getDuckConn } from './db/duckdb';
import { ensureAllsensorsParquetsInRange } from './db/ingest';

interface ChartDataPoint {
  x: number; // timestamp
  y: number; // value
}

export async function getDailyChartData(sensor: string, type: 'temperature' | 'humidity'): Promise<ChartDataPoint[]> {
  try {
    const conn = await getDuckConn();
    
    // Get today's date range
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    
    // Get parquet files for today
    const parquetFiles = await ensureAllsensorsParquetsInRange(startOfDay, endOfDay);
    if (!parquetFiles.length) {
      console.warn('No parquet files found for today');
      return [];
    }
    
    // Map sensor names to exact column names in allsensors data
    // Note: allsensors data only contains CH1-CH8 sensors, no indoor/outdoor
    const getSensorColumn = (sensor: string, type: 'temperature' | 'humidity'): string[] => {
      const candidates: string[] = [];
      
      if (sensor === 'indoor') {
        // Indoor sensors don't exist in allsensors data - map to CH1 as fallback
        if (type === 'temperature') {
          candidates.push('CH1 Temperature(℃)');
        } else {
          candidates.push('CH1 Luftfeuchtigkeit(%)');
        }
      } else if (sensor === 'outdoor') {
        // Outdoor sensors don't exist in allsensors data - map to CH2 as fallback
        if (type === 'temperature') {
          candidates.push('CH2 Temperature(℃)');
        } else {
          candidates.push('CH2 Luftfeuchtigkeit(%)');
        }
      } else if (sensor.match(/temp_and_humidity_ch(\d+)/)) {
        const chNum = sensor.match(/temp_and_humidity_ch(\d+)/)?.[1];
        if (type === 'temperature') {
          // Exact German column names from the data
          candidates.push(`CH${chNum} Temperature(℃)`);
        } else {
          // Exact German column names from the data
          candidates.push(`CH${chNum} Luftfeuchtigkeit(%)`);
        }
      }
      
      return candidates;
    };
    
    const columnCandidates = getSensorColumn(sensor, type);
    
    // Build union of all parquet files
    const unionSources = parquetFiles.map((p) => `SELECT * FROM read_parquet('${p.replace(/\\/g, "/")}')`).join("\nUNION ALL\n");
    
    // First, get available columns to find the right one
    const first = parquetFiles[0].replace(/\\/g, "/");
    const describeSql = `DESCRIBE SELECT * FROM read_parquet('${first}')`;
    const descReader = await conn.runAndReadAll(describeSql);
    const cols: any[] = descReader.getRowObjects();
    const availableColumns = cols.map((r: any) => String(r.column_name || r.ColumnName || r.column || ""));
    
    // Find matching column
    let targetColumn = null;
    for (const candidate of columnCandidates) {
      const found = availableColumns.find(col => 
        col.toLowerCase().includes(candidate.toLowerCase()) || 
        candidate.toLowerCase().includes(col.toLowerCase())
      );
      if (found) {
        targetColumn = found;
        break;
      }
    }
    
    if (!targetColumn) {
      console.warn(`No matching column found for ${sensor} ${type}. Available columns:`, availableColumns);
      return [];
    }
    
    // Format dates for DuckDB
    const startStr = startOfDay.toISOString().replace('T', ' ').slice(0, 16);
    const endStr = endOfDay.toISOString().replace('T', ' ').slice(0, 16);
    
    // Query to get hourly averages for the day
    const query = `
      WITH src AS (
        ${unionSources}
      ),
      filt AS (
        SELECT * FROM src 
        WHERE ts IS NOT NULL 
          AND ts >= strptime('${startStr}', '%Y-%m-%d %H:%M')
          AND ts < strptime('${endStr}', '%Y-%m-%d %H:%M')
          AND "${targetColumn}" IS NOT NULL
      )
      SELECT 
        EXTRACT(EPOCH FROM date_trunc('hour', ts)) * 1000 as x,
        AVG(CAST("${targetColumn}" AS DOUBLE)) as y
      FROM filt
      GROUP BY date_trunc('hour', ts)
      ORDER BY x
    `;
    
    const result = await conn.runAndReadAll(query);
    
    const data: ChartDataPoint[] = [];
    const rows = result.getRowObjects();
    for (const row of rows) {
      const x = row.x as number;
      const y = row.y as number;
      if (x != null && y != null && isFinite(y)) {
        data.push({ x, y });
      }
    }
    
    return data;
    
  } catch (error) {
    console.error(`Error fetching daily chart data for ${sensor} ${type}:`, error);
    return [];
  }
}

export async function getDailyChartDataMinute(sensor: string, type: 'temperature' | 'humidity'): Promise<ChartDataPoint[]> {
  try {
    const conn = await getDuckConn();
    
    // Get today's date range
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    
    // Get parquet files for today
    const parquetFiles = await ensureAllsensorsParquetsInRange(startOfDay, endOfDay);
    if (!parquetFiles.length) {
      console.warn('No parquet files found for today');
      return [];
    }
    
    // Map sensor names to exact column names in allsensors data
    // Note: allsensors data only contains CH1-CH8 sensors, no indoor/outdoor
    const getSensorColumn = (sensor: string, type: 'temperature' | 'humidity'): string[] => {
      const candidates: string[] = [];
      
      if (sensor === 'indoor') {
        // Indoor sensors don't exist in allsensors data - map to CH1 as fallback
        if (type === 'temperature') {
          candidates.push('CH1 Temperature(℃)');
        } else {
          candidates.push('CH1 Luftfeuchtigkeit(%)');
        }
      } else if (sensor === 'outdoor') {
        // Outdoor sensors don't exist in allsensors data - map to CH2 as fallback
        if (type === 'temperature') {
          candidates.push('CH2 Temperature(℃)');
        } else {
          candidates.push('CH2 Luftfeuchtigkeit(%)');
        }
      } else if (sensor.match(/temp_and_humidity_ch(\d+)/)) {
        const chNum = sensor.match(/temp_and_humidity_ch(\d+)/)?.[1];
        if (type === 'temperature') {
          // Exact German column names from the data
          candidates.push(`CH${chNum} Temperature(℃)`);
        } else {
          // Exact German column names from the data
          candidates.push(`CH${chNum} Luftfeuchtigkeit(%)`);
        }
      }
      
      return candidates;
    };
    
    const columnCandidates = getSensorColumn(sensor, type);
    
    // Build union of all parquet files
    const unionSources = parquetFiles.map((p) => `SELECT * FROM read_parquet('${p.replace(/\\/g, "/")}')`).join("\nUNION ALL\n");
    
    // First, get available columns to find the right one
    const first = parquetFiles[0].replace(/\\/g, "/");
    const describeSql = `DESCRIBE SELECT * FROM read_parquet('${first}')`;
    const descReader = await conn.runAndReadAll(describeSql);
    const cols: any[] = descReader.getRowObjects();
    const availableColumns = cols.map((r: any) => String(r.column_name || r.ColumnName || r.column || ""));
    
    // Find matching column
    let targetColumn = null;
    for (const candidate of columnCandidates) {
      const found = availableColumns.find(col => 
        col.toLowerCase().includes(candidate.toLowerCase()) || 
        candidate.toLowerCase().includes(col.toLowerCase())
      );
      if (found) {
        targetColumn = found;
        break;
      }
    }
    
    if (!targetColumn) {
      console.warn(`No matching column found for ${sensor} ${type}. Available columns:`, availableColumns);
      return [];
    }
    
    // Format dates for DuckDB
    const startStr = startOfDay.toISOString().replace('T', ' ').slice(0, 16);
    const endStr = endOfDay.toISOString().replace('T', ' ').slice(0, 16);
    
    // Query to get 5-minute averages for the day
    const query = `
      WITH src AS (
        ${unionSources}
      ),
      filt AS (
        SELECT * FROM src 
        WHERE ts IS NOT NULL 
          AND ts >= strptime('${startStr}', '%Y-%m-%d %H:%M')
          AND ts < strptime('${endStr}', '%Y-%m-%d %H:%M')
          AND "${targetColumn}" IS NOT NULL
          AND EXTRACT(MINUTE FROM ts) % 5 = 0
      )
      SELECT 
        EXTRACT(EPOCH FROM date_trunc('minute', ts)) * 1000 as x,
        AVG(CAST("${targetColumn}" AS DOUBLE)) as y
      FROM filt
      GROUP BY date_trunc('minute', ts)
      ORDER BY x
    `;
    
    const result = await conn.runAndReadAll(query);
    
    const data: ChartDataPoint[] = [];
    const rows = result.getRowObjects();
    for (const row of rows) {
      const x = row.x as number;
      const y = row.y as number;
      if (x != null && y != null && isFinite(y)) {
        data.push({ x, y });
      }
    }
    
    return data;
    
  } catch (error) {
    console.error(`Error fetching minute daily chart data for ${sensor} ${type}:`, error);
    return [];
  }
}

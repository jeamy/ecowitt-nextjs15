import { NextResponse } from "next/server";
import { getDuckConn } from "@/lib/db/duckdb";

interface TableInfo {
  tableName: string;
  rowCount: number;
  sampleData: Record<string, any>[];
}

// Helper to convert DuckDB values to JSON-serializable values
function convertDuckDBValue(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object' && value.valueOf) {
    const primitive = value.valueOf();
    if (typeof primitive === 'bigint') return Number(primitive);
    if (primitive !== value) return convertDuckDBValue(primitive);
  }
  if (Array.isArray(value)) return value.map(convertDuckDBValue);
  if (typeof value === 'object') {
    const converted: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      converted[key] = convertDuckDBValue(val);
    }
    return converted;
  }
  return value;
}

export async function GET() {
  try {
    const conn = await getDuckConn();
    
    // Get all tables (DuckDB uses INFORMATION_SCHEMA)
    const tablesResult = await conn.runAndReadAll("SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'main';");
    const tables = tablesResult.getRowObjects();
    
    const tableInfo: TableInfo[] = [];
    
    for (const table of tables) {
      const name = String(table.name);
      
      // Get row count
      const countResult = await conn.runAndReadAll(`SELECT COUNT(*) as count FROM ${name}`);
      const rows = countResult.getRowObjects();
      const count = Number(rows[0]?.count || 0);
      
      const info: TableInfo = {
        tableName: name,
        rowCount: count,
        sampleData: []
      };
      
      // Show sample data if table has rows
      if (count > 0) {
        const sampleResult = await conn.runAndReadAll(`SELECT * FROM ${name} LIMIT 3`);
        const rawSamples = sampleResult.getRowObjects();
        // Convert all DuckDB values to JSON-serializable values
        info.sampleData = rawSamples.map(row => convertDuckDBValue(row));
      }
      
      tableInfo.push(info);
    }
    
    return NextResponse.json({
      database: 'weather.duckdb',
      tables: tableInfo
    });
    
  } catch (error: any) {
    console.error('Database check error:', error);
    return NextResponse.json({ 
      error: error.message 
    }, { status: 500 });
  }
}

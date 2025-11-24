
import { getDuckConn } from "./src/lib/db/duckdb";

async function check() {
    try {
        const conn = await getDuckConn();

        console.log("--- Forecasts Storage Dates ---");
        const forecasts = await conn.runAndReadAll(`
      SELECT DISTINCT storage_date 
      FROM forecasts 
      ORDER BY storage_date DESC 
      LIMIT 20
    `);
        const fRows = forecasts.getRowObjects();
        console.table(fRows);

        console.log("\n--- Analysis Dates ---");
        const analysis = await conn.runAndReadAll(`
      SELECT DISTINCT analysis_date 
      FROM forecast_analysis 
      ORDER BY analysis_date DESC 
      LIMIT 20
    `);
        const aRows = analysis.getRowObjects();
        console.table(aRows);

    } catch (e) {
        console.error(e);
    }
}

check();

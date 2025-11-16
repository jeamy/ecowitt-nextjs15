import { getDuckConn } from "../lib/db/duckdb";

const DEFAULT_CUTOFF = "2025-11-13";

async function cleanupForecastAnalysis() {
  const cutoffIso = process.env.FORECAST_ANALYSIS_CLEANUP_BEFORE ?? DEFAULT_CUTOFF;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffIso)) {
    throw new Error(`Invalid cutoff date: ${cutoffIso}. Expected format YYYY-MM-DD.`);
  }

  console.log(`[cleanup] Removing forecast_analysis rows before ${cutoffIso}...`);

  const conn = await getDuckConn();

  const reader = await conn.runAndReadAll(
    `SELECT COUNT(*) AS count FROM forecast_analysis WHERE analysis_date < ?`,
    [cutoffIso]
  );
  const deletable = reader.getRowObjects()[0]?.count ?? 0;

  if (!deletable) {
    console.log(`[cleanup] Nothing to delete (no rows before ${cutoffIso}).`);
    return;
  }

  await conn.run(`DELETE FROM forecast_analysis WHERE analysis_date < ?`, [cutoffIso]);
  console.log(`[cleanup] Deleted ${deletable} row(s) older than ${cutoffIso}.`);
}

cleanupForecastAnalysis().catch((err) => {
  console.error(`[cleanup] Failed to cleanup forecast_analysis:`, err);
  process.exitCode = 1;
});

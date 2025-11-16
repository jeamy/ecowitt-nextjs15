import { calculateAndStoreDailyAnalysis } from "../instrumentation";

async function main() {
  const stationId = process.env.FORECAST_STATION_ID || "11229";
  console.log(`[run-forecast-analysis] Station: ${stationId}`);

  try {
    await calculateAndStoreDailyAnalysis(stationId);
    console.log("[run-forecast-analysis] ✓ Analysis finished");
  } catch (err) {
    console.error("[run-forecast-analysis] ✗ Analysis failed:", err);
    process.exitCode = 1;
  }
}

main();

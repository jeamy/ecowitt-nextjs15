/**
 * Test script to manually trigger forecast storage and analysis
 * Run with: node scripts/test-forecast-analysis.js
 */

async function testForecastAnalysis() {
  try {
    console.log('Testing forecast storage and analysis...\n');
    
    // Import the functions
    const { storeForecastForStation, calculateAndStoreDailyAnalysis } = await import('../src/instrumentation.ts');
    
    const stationId = process.env.FORECAST_STATION_ID || "11035";
    console.log(`Station ID: ${stationId}\n`);
    
    // Step 1: Store forecasts
    console.log('Step 1: Storing forecasts...');
    await storeForecastForStation(stationId);
    console.log('✓ Forecasts stored\n');
    
    // Step 2: Calculate analysis
    console.log('Step 2: Calculating analysis...');
    await calculateAndStoreDailyAnalysis(stationId);
    console.log('✓ Analysis calculated\n');
    
    console.log('Test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

testForecastAnalysis();

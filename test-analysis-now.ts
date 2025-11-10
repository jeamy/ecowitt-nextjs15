import { calculateAndStoreDailyAnalysis } from './src/instrumentation';

async function test() {
  console.log('=== MANUAL ANALYSIS TEST ===');
  console.log('Calling calculateAndStoreDailyAnalysis for station 11229...');
  
  try {
    await calculateAndStoreDailyAnalysis('11229');
    console.log('=== SUCCESS ===');
  } catch (e: any) {
    console.error('=== ERROR ===');
    console.error('Message:', e?.message);
    console.error('Stack:', e?.stack);
  }
}

test();

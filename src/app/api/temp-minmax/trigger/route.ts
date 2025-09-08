import { NextResponse } from 'next/server';
import { updateTempMinMax, getTodayTempMinMax } from '@/lib/temp-minmax';
import { getLastRealtime } from '@/lib/realtimeArchiver';

/**
 * API route to manually trigger an update of the daily min/max temperature and humidity data.
 * It uses the last cached real-time data to perform the update.
 * @returns {Promise<NextResponse>} A JSON response indicating success or failure, and the updated data.
 * @example
 * // POST /api/temp-minmax/trigger
 * // Returns:
 * // {
 * //   "ok": true,
 * //   "data": { ... updated min/max data ... },
 * //   "message": "Min/max updated successfully"
 * // }
 */
export async function POST() {
  try {
    // Get current realtime data directly
    const rtData = await getLastRealtime();
    if (!rtData || !rtData.ok || !rtData.data) {
      return NextResponse.json({ ok: false, error: 'No realtime data available' }, { status: 500 });
    }
    
    // Update min/max with current data
    updateTempMinMax(rtData.data);
    
    // Return updated data
    const updatedData = getTodayTempMinMax();
    return NextResponse.json({ ok: true, data: updatedData, message: 'Min/max updated successfully' });
  } catch (error) {
    console.error('Error triggering temp min/max update:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

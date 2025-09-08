import { NextResponse } from 'next/server';
import { updateTempMinMax, getTodayTempMinMax } from '@/lib/temp-minmax';
import { getLastRealtime } from '@/lib/realtimeArchiver';

/**
 * API route to update and then retrieve the daily min/max temperature and humidity data.
 * This is triggered to ensure the min/max values are current based on the latest real-time data.
 * @returns {Promise<NextResponse>} A JSON response with the updated min/max data.
 * @example
 * // POST /api/temp-minmax/update
 * // Returns:
 * // {
 * //   "ok": true,
 * //   "data": { ... updated min/max data ... },
 * //   "message": "All temperatures updated successfully"
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
    return NextResponse.json({ ok: true, data: updatedData, message: 'All temperatures updated successfully' });
  } catch (error) {
    console.error('Error updating temp min/max:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Also allow GET for convenience. See POST for details.
 * @returns {Promise<NextResponse>} A JSON response with the updated min/max data.
 */
export async function GET() {
  return POST();
}

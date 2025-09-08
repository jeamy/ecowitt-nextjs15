import { NextRequest, NextResponse } from 'next/server';
import { getTodayTempMinMax, getAllTempMinMax } from '@/lib/temp-minmax';

/**
 * API route to get the daily minimum and maximum temperature and humidity data.
 * By default, it returns the data for the current day.
 * It can also return all stored data if the `all=true` query parameter is provided.
 * @param {NextRequest} request - The incoming request object.
 * @returns {Promise<NextResponse>} A JSON response containing the min/max data, or an error.
 * @example
 * // Get today's min/max data
 * GET /api/temp-minmax
 *
 * @example
 * // Get all stored min/max data
 * GET /api/temp-minmax?all=true
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const all = searchParams.get('all');
    
    if (all === 'true') {
      const data = getAllTempMinMax();
      return NextResponse.json({ ok: true, data });
    }
    
    const data = getTodayTempMinMax();
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error('Error fetching temp min/max:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

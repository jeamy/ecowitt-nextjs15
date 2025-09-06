import { NextResponse } from 'next/server';
import { updateTempMinMax, getTodayTempMinMax } from '@/lib/temp-minmax';
import { API_ENDPOINTS } from '@/constants';

export async function POST() {
  try {
    // Get current realtime data using internal API call
    const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}${API_ENDPOINTS.RT_LAST}`, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: 'Failed to fetch realtime data' }, { status: 500 });
    }
    
    const rtData = await res.json();
    if (!rtData.ok || !rtData.data) {
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

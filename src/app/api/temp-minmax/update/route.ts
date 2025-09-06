import { NextResponse } from 'next/server';
import { updateTempMinMax, getTodayTempMinMax } from '@/lib/temp-minmax';

export async function POST() {
  try {
    // Get current realtime data
    const res = await fetch('http://localhost:3000/api/rt/last', { cache: 'no-store' });
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
    return NextResponse.json({ ok: true, data: updatedData, message: 'All temperatures updated successfully' });
  } catch (error) {
    console.error('Error updating temp min/max:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

// Also allow GET for convenience
export async function GET() {
  return POST();
}

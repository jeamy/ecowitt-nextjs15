import { NextRequest, NextResponse } from 'next/server';
import { getTodayTempMinMax, getAllTempMinMax } from '@/lib/temp-minmax';

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

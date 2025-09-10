import { NextRequest, NextResponse } from 'next/server';
import { getDailyChartData, getDailyChartDataMinute } from '@/lib/daily-chart';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sensor = searchParams.get('sensor');
    const type = searchParams.get('type') as 'temperature' | 'humidity';
    const resolution = searchParams.get('resolution') || 'hour';
    
    if (!sensor || !type) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Missing required parameters: sensor and type' 
      }, { status: 400 });
    }
    
    if (type !== 'temperature' && type !== 'humidity') {
      return NextResponse.json({ 
        ok: false, 
        error: 'Type must be either "temperature" or "humidity"' 
      }, { status: 400 });
    }
    
    let data;
    if (resolution === 'minute') {
      data = await getDailyChartDataMinute(sensor, type);
    } else {
      data = await getDailyChartData(sensor, type);
    }
    
    return NextResponse.json({ ok: true, data });
    
  } catch (error) {
    console.error('Error fetching daily chart data:', error);
    return NextResponse.json({ 
      ok: false, 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { storeForecastForStation } from "@/instrumentation";

export const runtime = "nodejs";

/**
 * API route to store forecast data from all sources daily
 * POST /api/forecast/store
 * Body: { stationId: string }
 * 
 * This endpoint stores forecasts from all 4 sources directly in DuckDB
 * for later comparison with actual weather data
 */
export async function POST(req: Request) {
  try {
    const { stationId } = await req.json();
    
    if (!stationId) {
      return NextResponse.json({ error: "stationId is required" }, { status: 400 });
    }

    // Use the same function as the midnight job
    await storeForecastForStation(String(stationId));
    
    const storageDate = new Date().toISOString().split('T')[0];

    return NextResponse.json({ 
      success: true, 
      message: `Stored forecasts for station ${stationId} on ${storageDate}`
    });

  } catch (error: any) {
    console.error("Forecast storage error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * API route to get the default forecast station ID from environment
 * GET /api/config/forecast-station
 */
export async function GET() {
  const stationId = process.env.FORECAST_STATION_ID || "11035";
  return NextResponse.json({ stationId });
}

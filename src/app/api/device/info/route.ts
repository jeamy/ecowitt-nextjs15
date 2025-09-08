import { NextResponse } from "next/server";
import EcoCon from "eco";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Builds the URL for the Ecowitt device info API endpoint.
 * @returns {string} The full URL for the API request.
 * @private
 */
function buildDeviceInfoUrl() {
  const eco = EcoCon.getInstance().getConfig();
  const params = new URLSearchParams({
    mac: eco.mac,
    api_key: eco.apiKey,
    application_key: eco.applicationKey,
    method: "device/get",
  });
  const baseUrl = `https://${eco.server}/api/v3/device/info`;
  return `${baseUrl}?${params.toString()}`;
}

/**
 * API route to get device information from the Ecowitt API.
 * Fetches timezone, latitude, and longitude for the weather station.
 * @returns {Promise<NextResponse>} A JSON response containing the device info, or an error.
 * @example
 * // GET /api/device/info
 * // Returns:
 * // {
 * //   "ok": true,
 * //   "timezone": "Europe/Berlin",
 * //   "latitude": 52.52,
 * //   "longitude": 13.40,
 * //   "raw": { ...full api response... }
 * // }
 */
export async function GET() {
  try {
    const url = buildDeviceInfoUrl();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ ok: false, error: `Upstream ${res.status}`, body: text }, { status: res.status });
    }
    const json: any = await res.json();
    const data = json?.data || json;

    // Normalize fields
    const tz: string | null = data?.date_zone_id ?? null;
    let lat: number | null = data?.latitude ?? null;
    let lon: number | null = data?.longitude ?? null;

    // If latitude/longitude come as strings, coerce to number
    if (lat != null && typeof lat !== "number") lat = Number(lat);
    if (lon != null && typeof lon !== "number") lon = Number(lon);

    return NextResponse.json({ ok: true, timezone: tz, latitude: lat, longitude: lon, raw: json }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

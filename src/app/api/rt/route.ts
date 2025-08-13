import { NextResponse } from "next/server";
import EcoCon from "eco";

export const dynamic = "force-dynamic"; // always fetch fresh

function buildParams(all: boolean) {
  const eco = EcoCon.getInstance().getConfig();
  const params = new URLSearchParams({
    mac: eco.mac,
    api_key: eco.apiKey,
    application_key: eco.applicationKey,
    method: "device/real_time",
    call_back: all ? "all" : "indoor.temperature,outdoor.temperature",
    temp_unitid: "1",
    pressure_unitid: "3",
    wind_speed_unitid: "7",
    rainfall_unitid: "12",
    solar_irradiance_unitid: "16"
  });
  return params;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const all = url.searchParams.get("all") === "1";
    const eco = EcoCon.getInstance().getConfig();
    const baseUrl = `https://${eco.server}/api/v3/device/real_time`;
    const qs = buildParams(all);
    const target = `${baseUrl}?${qs.toString()}`;

    const res = await fetch(target, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ ok: false, error: `Upstream ${res.status}`, body: text }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

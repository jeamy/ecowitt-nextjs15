import { NextResponse } from "next/server";
import { buildTargetUrl } from "@/lib/realtimeArchiver";

export const dynamic = "force-dynamic"; // always fetch fresh
export const runtime = "nodejs"; // we need fs access

// (archiving logic moved to shared module)

/**
 * API route to proxy real-time data requests to the Ecowitt API.
 * This acts as a server-side proxy to hide API credentials from the client.
 * It can fetch either all data or a subset based on the `all` query parameter.
 *
 * @param {Request} req - The incoming request object.
 * @returns {Promise<NextResponse>} A JSON response containing the real-time data from the Ecowitt API.
 *
 * @example
 * // Get all real-time data
 * GET /api/rt?all=1
 *
 * @example
 * // Get a subset of real-time data
 * GET /api/rt
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const all = url.searchParams.get("all") === "1";
    const target = buildTargetUrl(all);

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

import { NextResponse } from "next/server";
import { getLastRealtime } from "@/lib/realtimeArchiver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const last = await getLastRealtime();
    if (!last) {
      return NextResponse.json({ ok: false, error: "no data yet", updatedAt: null }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(last, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

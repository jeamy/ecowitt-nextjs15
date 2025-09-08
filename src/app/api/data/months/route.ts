import { NextResponse } from "next/server";
import { listDntFiles } from "@/lib/files";

export const runtime = "nodejs";

export async function GET() {
  const files = await listDntFiles();
  const set = new Set<string>();
  for (const f of files) {
    const m = f.match(/^(\d{6})/);
    if (m) set.add(m[1]);
  }
  const months = Array.from(set).sort().reverse();
  return NextResponse.json({ months }, { status: 200 });
}

import { NextResponse } from "next/server";
import { listDntFiles } from "@/lib/files";

export const runtime = "nodejs";

/**
 * API route to get a list of available months from the CSV filenames.
 * It scans the DNT directory, extracts the YYYYMM prefix from filenames,
 * and returns a unique, sorted list of months.
 * @returns {Promise<NextResponse>} A JSON response containing an array of month strings.
 * @example
 * // GET /api/data/months
 * // Returns:
 * // {
 * //   "months": ["202508", "202507", "202506"]
 * // }
 */
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

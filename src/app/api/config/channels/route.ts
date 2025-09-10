import "server-only";
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

/**
 * API route to get the channel configuration.
 * @returns {Promise<NextResponse>} A JSON response containing the channel configuration.
 * @example
 * // GET /api/config/channels
 * // Returns:
 * // {
 * //   "ch1": { "name": "Garten" },
 * //   "ch2": { "name": "Keller" }
 * // }
 */
export async function GET() {
  const abs = path.join(process.cwd(), "src", "config", "channels.json");
  const text = await fs.readFile(abs, "utf8");
  const json = JSON.parse(text);
  return NextResponse.json(json, { status: 200 });
}

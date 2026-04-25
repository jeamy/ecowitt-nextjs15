import { NextResponse } from "next/server";

const ADMIN_TOKEN_ENV = "ADMIN_API_TOKEN";
const FALLBACK_TOKEN_ENV = "WEATHER_ADMIN_TOKEN";

export function requireAdminRequest(req: Request): NextResponse | null {
  const expected = process.env[ADMIN_TOKEN_ENV] || process.env[FALLBACK_TOKEN_ENV];
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: `${ADMIN_TOKEN_ENV} is not configured` },
      { status: 503 }
    );
  }

  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || req.headers.get("x-admin-token");
  if (token !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

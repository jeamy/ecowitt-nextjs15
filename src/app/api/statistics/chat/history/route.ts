import { NextRequest, NextResponse } from "next/server";
import {
  deleteStatisticsChatHistory,
  mergeStatisticsChatHistory,
  readStatisticsChatHistory,
} from "@/lib/server/statisticsChatStore";

export const runtime = "nodejs";

function conversationId(req: NextRequest) {
  return new URL(req.url).searchParams.get("conversation_id")?.trim() || "";
}

function invalid() {
  return NextResponse.json({ ok: false, error: "CONVERSATION_ID_REQUIRED" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const id = conversationId(req);
  if (!id) return invalid();
  return NextResponse.json({ ok: true, history: await readStatisticsChatHistory(id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.conversation_id === "string" ? body.conversation_id.trim() : "";
  if (!id) return invalid();
  const history = await mergeStatisticsChatHistory(id, body?.history || {});
  return NextResponse.json({ ok: true, history }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  const id = conversationId(req);
  if (!id) return invalid();
  return NextResponse.json({ ok: true, history: await deleteStatisticsChatHistory(id) }, { headers: { "Cache-Control": "no-store" } });
}

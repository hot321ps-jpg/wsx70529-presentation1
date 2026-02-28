import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import type { WarroomPayload } from "../../../lib/types";

const KEY = "warroom:latest";
export const runtime = "nodejs";

export async function GET() {
  const data = (await kv.get(KEY)) as WarroomPayload | null;
  if (!data) {
    return NextResponse.json(
      { error: "No data yet. Visit /api/warroom-refresh once." },
      { status: 404 }
    );
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

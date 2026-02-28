import { NextResponse } from "next/server";
import { makeMockWarroomData } from "@/lib/mock";

export const runtime = "nodejs";

export async function GET() {
  // 你之後要接真資料，就把 makeMockWarroomData() 換成：
  // - fetch Twitch API / DB 查詢 / 你自己的資料管線結果
  const data = makeMockWarroomData(Date.now());

  return NextResponse.json(data, {
    headers: {
      // 想「每次都最新」：no-store
      // 想省成本：可改成 s-maxage=30, stale-while-revalidate=60
      "Cache-Control": "no-store",
    },
  });
}

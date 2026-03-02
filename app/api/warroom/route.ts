import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

// 引入型別與 API 函數 (使用相對路徑確保 Vercel 能正確編譯)
import type { WarroomPayload } from "../../../lib/types";
import { getUserByLogin, getStreamByUserId, getRecentVideosByUserId } from "../../../lib/twitch";

const TARGET_LOGIN = "wsx70529"; // 您的 Twitch ID
const CACHE_KEY = "warroom:latest_data";
const LOCK_KEY = "warroom:refresh_lock";
const REFRESH_COOLDOWN = 60; // 60 秒內不會重複向 Twitch 發送請求

export async function GET() {
  try {
    // 1. 檢查 KV 中是否有最新的快取資料
    const cachedData = await kv.get<WarroomPayload>(CACHE_KEY);
    const now = Date.now();
    
    // 如果快取存在，且距離上次更新未滿 60 秒，直接回傳舊資料
    if (cachedData && (now - new Date(cachedData.updatedAt).getTime() < REFRESH_COOLDOWN * 1000)) {
      return NextResponse.json({ ok: true, source: "cache", data: cachedData });
    }

    // 2. 檢查去重鎖 (避免多人同時訪問時，同時觸發多個 Twitch API 請求)
    const isLocked = await kv.set(LOCK_KEY, "locked", { nx: true, ex: 10 });
    if (!isLocked && cachedData) {
      // 如果被鎖住了，代表背景有其他請求正在抓新資料，先回傳舊的頂著用
      return NextResponse.json({ ok: true, source: "cache_locked", data: cachedData });
    }

    // 3. 開始向 Twitch 抓取新資料
    const user = await getUserByLogin(TARGET_LOGIN);
    const [stream, videos] = await Promise.all([
      getStreamByUserId(user.id),
      getRecentVideosByUserId(user.id, 20)
    ]);

    // 4. 整理資料格式 (這裡的欄位名稱已完全對齊 types.ts)
    const payload: WarroomPayload = {
      updatedAt: new Date().toISOString(),
      channel: {
        userId: user.id,                 // ✅ 修正：對應型別的 userId
        login: user.login,
        displayName: user.displayName,   // ✅ 修正：使用駝峰命名
        profileImageUrl: user.profileImageUrl // ✅ 修正：使用駝峰命名
      },
      live: stream ? {
        isLive: true,
        title: stream.title,
        gameName: stream.gameName,
        viewerCount: stream.viewerCount,
        startedAt: stream.startedAt
      } : null,
      kpis: {
        isLive: !!stream,
        viewersNow: stream?.viewerCount || 0,
        vodCount30d: videos.length, 
        liveDaysEstimate30d: new Set(videos.map(v => v.createdAt.split('T')[0])).size
      },
      trend30d: [],
      events: [],
      recentVods: videos
    };

    // 5. 更新 KV 快取
    await kv.set(CACHE_KEY, payload);

    return NextResponse.json({ ok: true, source: "fresh", data: payload });

  } catch (error: any) {
    console.error("Warroom API Error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// app/api/warroom/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { Twitch } from "@/lib/twitch";
import type { WarroomPayload } from "@/lib/types";

const TARGET_LOGIN = "wsx70529"; // 您要監控的頻道 ID
const CACHE_KEY = "warroom:latest_data";
const LOCK_KEY = "warroom:refresh_lock";
const REFRESH_COOLDOWN = 60; // 60 秒內不重複抓取 Twitch

export async function GET() {
  try {
    // 1. 檢查是否有最新快取
    const cachedData = await kv.get<WarroomPayload>(CACHE_KEY);
    const now = Date.now();
    
    // 如果快取存在，且距離上次更新未滿 60 秒，直接回傳舊資料
    if (cachedData && (now - new Date(cachedData.updatedAt).getTime() < REFRESH_COOLDOWN * 1000)) {
      return NextResponse.json({ ok: true, source: "cache", data: cachedData });
    }

    // 2. 檢查去重鎖 (避免多人同時訪問時，同時觸發多個 Twitch API 請求)
    const isLocked = await kv.set(LOCK_KEY, "locked", { nx: true, ex: 10 });
    if (!isLocked && cachedData) {
      // 如果被鎖住了，代表有人正在抓新資料，先回傳舊的頂著用
      return NextResponse.json({ ok: true, source: "cache_locked", data: cachedData });
    }

    // 3. 開始向 Twitch 抓取新資料
    const user = await Twitch.getUser(TARGET_LOGIN);
    const [stream, videos] = await Promise.all([
      Twitch.getStream(user.id),
      Twitch.getVideos(user.id)
    ]);

    // 4. 整理資料格式
    const payload: WarroomPayload = {
      channel: {
        id: user.id,
        login: user.login,
        displayName: user.display_name,
        profileImageUrl: user.profile_image_url
      },
      live: stream ? {
        isLive: true,
        title: stream.title,
        gameName: stream.game_name,
        viewerCount: stream.viewer_count,
        startedAt: stream.started_at
      } : null,
      recentVods: videos.map((v: any) => ({
        id: v.id,
        title: v.title,
        createdAt: v.created_at,
        duration: v.duration,
        url: v.url,
        viewCount: v.view_count
      })),
      kpis: {
        vodCount30d: videos.length, // 簡單估算
        liveDaysEstimate30d: new Set(videos.map((v: any) => v.created_at.split('T')[0])).size
      },
      updatedAt: new Date().toISOString()
    };

    // 5. 更新 KV 快取
    await kv.set(CACHE_KEY, payload);

    return NextResponse.json({ ok: true, source: "fresh", data: payload });

  } catch (error: any) {
    console.error("Warroom API Error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

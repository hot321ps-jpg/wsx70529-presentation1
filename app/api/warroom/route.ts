import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import type { WarroomPayload } from "../../../lib/types";
// ✅ 修正：改為引入重構後的 Twitch 物件
import { Twitch } from "../../../lib/twitch";

const TARGET_LOGIN = "wsx70529"; 
const CACHE_KEY = "warroom:latest_data";
const LOCK_KEY = "warroom:refresh_lock";
const REFRESH_COOLDOWN = 60; 

export async function GET() {
  try {
    const cachedData = await kv.get<WarroomPayload>(CACHE_KEY);
    const now = Date.now();
    
    if (cachedData && (now - new Date(cachedData.updatedAt).getTime() < REFRESH_COOLDOWN * 1000)) {
      return NextResponse.json({ ok: true, source: "cache", data: cachedData });
    }

    const isLocked = await kv.set(LOCK_KEY, "locked", { nx: true, ex: 10 });
    if (!isLocked && cachedData) {
      return NextResponse.json({ ok: true, source: "cache_locked", data: cachedData });
    }

    // ✅ 修正：使用 Twitch.getUser, Twitch.getStream, Twitch.getVideos
    const user = await Twitch.getUser(TARGET_LOGIN);
    const [stream, videos] = await Promise.all([
      Twitch.getStream(user.id),
      Twitch.getVideos(user.id, 20)
    ]);

    const payload: WarroomPayload = {
      updatedAt: new Date().toISOString(),
      channel: {
        userId: user.id,
        login: user.login,
        displayName: user.display_name,       // Twitch 原始回傳底線命名，對應我們的駝峰命名
        profileImageUrl: user.profile_image_url
      },
      live: stream ? {
        isLive: true,
        title: stream.title,
        gameName: stream.game_name,
        viewerCount: stream.viewer_count,
        startedAt: stream.started_at
      } : null,
      kpis: {
        isLive: !!stream,
        viewersNow: stream?.viewer_count || 0,
        vodCount30d: videos.length, 
        liveDaysEstimate30d: new Set(videos.map((v: any) => v.created_at.split('T')[0])).size
      },
      trend30d: [],
      events: [],
      recentVods: videos.map((v: any) => ({   // ✅ 修正：將影片陣列完整轉換格式
        id: v.id,
        title: v.title,
        createdAt: v.created_at,
        duration: v.duration,
        url: v.url,
        viewCount: v.view_count
      }))
    };

    await kv.set(CACHE_KEY, payload);

    return NextResponse.json({ ok: true, source: "fresh", data: payload });

  } catch (error: any) {
    console.error("Warroom API Error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

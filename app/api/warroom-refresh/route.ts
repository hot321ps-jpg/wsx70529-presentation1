import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import type { WarroomPayload } from "@/lib/types";
import { getUserByLogin, getStreamByUserId, getRecentVideosByUserId } from "@/lib/twitch";
import { buildVodTrend30d, buildEvents } from "@/lib/compute";

const DATA_KEY = "warroom:latest";
const UPDATED_KEY = "warroom:updatedAt";

const LAST_REFRESH_MS_KEY = "warroom:last_refresh_ms";
const REFRESH_LOCK_KEY = "warroom:refresh_lock";

const LOGIN = "wsx70529";

const MIN_REFRESH_INTERVAL_MS = 60_000; // 60 秒內只刷新一次（可調）
const LOCK_TTL_SECONDS = 25;            // 鎖 TTL 避免卡死

export const runtime = "nodejs";

async function buildPayload(): Promise<WarroomPayload> {
  const updatedAt = new Date().toISOString();

  const user = await getUserByLogin(LOGIN);
  const stream = await getStreamByUserId(user.id);
  const recentVods = await getRecentVideosByUserId(user.id, 100);

  const vods30d = recentVods.filter((v) => {
    const dt = new Date(v.createdAt).getTime();
    return dt >= Date.now() - 30 * 24 * 3600 * 1000;
  });

  const trend30d = buildVodTrend30d(recentVods.map((v) => ({ createdAt: v.createdAt })));

  const isLive = !!stream;
  const viewerCount = stream?.viewerCount ?? 0;

  const payload: WarroomPayload = {
    updatedAt,
    channel: {
      login: user.login,
      userId: user.id,
      displayName: user.displayName,
      profileImageUrl: user.profileImageUrl
    },
    live: {
      isLive,
      title: stream?.title,
      gameName: stream?.gameName,
      viewerCount,
      startedAt: stream?.startedAt
    },
    kpis: {
      isLive,
      viewersNow: viewerCount,
      vodCount30d: vods30d.length,
      liveDaysEstimate30d: new Set(vods30d.map((v) => v.createdAt.slice(0, 10))).size
    },
    trend30d,
    events: buildEvents({ updatedAt, isLive, viewerCount, trend30d }),
    recentVods: recentVods.slice(0, 12)
  };

  return payload;
}

async function refreshOnce() {
  const now = Date.now();

  // 1) 最小間隔去重
  const lastMs = (await kv.get(LAST_REFRESH_MS_KEY)) as number | null;
  if (lastMs && now - lastMs < MIN_REFRESH_INTERVAL_MS) {
    const data = (await kv.get(DATA_KEY)) as WarroomPayload | null;
    return {
      ok: true,
      skipped: true,
      reason: "min_interval",
      updatedAt: data?.updatedAt ?? null
    };
  }

  // 2) 分散式鎖（同一時間只允許 1 個 refresh）
  const lockAcquired = await kv.set(REFRESH_LOCK_KEY, String(now), {
    nx: true,
    ex: LOCK_TTL_SECONDS
  });

  if (lockAcquired !== "OK") {
    const data = (await kv.get(DATA_KEY)) as WarroomPayload | null;
    return {
      ok: true,
      skipped: true,
      reason: "locked",
      updatedAt: data?.updatedAt ?? null
    };
  }

  try {
    const payload = await buildPayload();

    await kv.set(DATA_KEY, payload);
    await kv.set(UPDATED_KEY, payload.updatedAt);
    await kv.set(LAST_REFRESH_MS_KEY, now);

    return { ok: true, skipped: false, updatedAt: payload.updatedAt };
  } finally {
    await kv.del(REFRESH_LOCK_KEY);
  }
}

export async function GET() {
  const result = await refreshOnce();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  return GET();
}

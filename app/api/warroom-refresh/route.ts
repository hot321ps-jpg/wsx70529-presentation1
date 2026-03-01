import { NextResponse } from "next/server";
import type { WarroomPayload } from "../../../lib/types";
import { getUserByLogin, getStreamByUserId, getRecentVideosByUserId } from "../../../lib/twitch";
import { buildVodTrend30d, buildEvents } from "../../../lib/compute";

const DATA_KEY = "warroom:latest";
const UPDATED_KEY = "warroom:updatedAt";

const LAST_REFRESH_MS_KEY = "warroom:last_refresh_ms";
const REFRESH_LOCK_KEY = "warroom:refresh_lock";

const LOGIN = "wsx70529";

// 同一分鐘最多一次（可調）
const MIN_REFRESH_INTERVAL_MS = 60_000;
// 鎖 TTL（避免卡死）
const LOCK_TTL_SECONDS = 25;

export const runtime = "nodejs";

// -------------------------
// KV: Lazy import to avoid module-load crash (HTTP 500 white page)
// -------------------------
let _kv: any = null;

async function getKV() {
  if (_kv) return _kv;
  const mod = await import("@vercel/kv");
  _kv = mod.kv;
  return _kv;
}

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function kvSmokeTest() {
  const kv = await getKV();

  const k = "warroom:kv_smoke";
  const v = `ok:${Date.now()}`;
  await kv.set(k, v, { ex: 30 });
  const got = await kv.get(k);
  if (got !== v) throw new Error("KV smoke test failed (set/get mismatch)");
}

async function buildPayload(trace: string[]): Promise<WarroomPayload> {
  const updatedAt = new Date().toISOString();

  trace.push("twitch:getUserByLogin");
  const user = await getUserByLogin(LOGIN);

  trace.push("twitch:getStreamByUserId");
  const stream = await getStreamByUserId(user.id);

  trace.push("twitch:getRecentVideosByUserId");
  const recentVods = await getRecentVideosByUserId(user.id, 100);

  trace.push("compute:vods30d/filter");
  const vods30d = recentVods.filter((v) => {
    const dt = new Date(v.createdAt).getTime();
    return dt >= Date.now() - 30 * 24 * 3600 * 1000;
  });

  trace.push("compute:trend30d");
  const trend30d = buildVodTrend30d(recentVods.map((v) => ({ createdAt: v.createdAt })));

  const isLive = !!stream;
  const viewerCount = stream?.viewerCount ?? 0;

  trace.push("compute:events");
  const payload: WarroomPayload = {
    updatedAt,
    channel: {
      login: user.login,
      userId: user.id,
      displayName: user.displayName,
      profileImageUrl: user.profileImageUrl,
    },
    live: {
      isLive,
      title: stream?.title,
      gameName: stream?.gameName,
      viewerCount,
      startedAt: stream?.startedAt,
    },
    kpis: {
      isLive,
      viewersNow: viewerCount,
      vodCount30d: vods30d.length,
      liveDaysEstimate30d: new Set(vods30d.map((v) => v.createdAt.slice(0, 10))).size,
    },
    trend30d,
    events: buildEvents({ updatedAt, isLive, viewerCount, trend30d }),
    recentVods: recentVods.slice(0, 12),
  };

  return payload;
}

async function refreshOnce() {
  const now = Date.now();
  const trace: string[] = [];

  // env presence snapshot (safe to show)
  const envInfo = {
    hasTwitchClientId: !!process.env.TWITCH_CLIENT_ID,
    hasTwitchClientSecret: !!process.env.TWITCH_CLIENT_SECRET,
    hasTwitchAppToken: !!process.env.TWITCH_APP_ACCESS_TOKEN,
    hasKVRestUrl: !!process.env.KV_REST_API_URL,
    hasKVRestToken: !!process.env.KV_REST_API_TOKEN,
  };

  try {
    const kv = await getKV();

    // 1) 最小間隔去重
    trace.push("kv:get:last_refresh_ms");
    const lastRaw = await kv.get(LAST_REFRESH_MS_KEY);
    const lastMs = toNumberOrNull(lastRaw);

    if (lastMs && now - lastMs < MIN_REFRESH_INTERVAL_MS) {
      trace.push("kv:get:data_for_skip");
      const data = (await kv.get(DATA_KEY)) as WarroomPayload | null;
      return {
        ok: true,
        skipped: true,
        reason: "min_interval",
        updatedAt: data?.updatedAt ?? null,
        trace,
        envInfo,
      };
    }

    // 2) 分散式鎖
    trace.push("kv:set:refresh_lock");
    const lockAcquired = await kv.set(REFRESH_LOCK_KEY, String(now), {
      nx: true,
      ex: LOCK_TTL_SECONDS,
    });

    if (lockAcquired !== "OK") {
      trace.push("kv:get:data_for_locked");
      const data = (await kv.get(DATA_KEY)) as WarroomPayload | null;
      return {
        ok: true,
        skipped: true,
        reason: "locked",
        updatedAt: data?.updatedAt ?? null,
        trace,
        envInfo,
      };
    }

    try {
      // A) env 檢查（最常見問題）
      trace.push("env:check");
      requireEnv("TWITCH_CLIENT_ID");
      requireEnv("TWITCH_CLIENT_SECRET");

      // B) KV 連線測試（最常見問題）
      trace.push("kv:smoke_test");
      await kvSmokeTest();

      // C) Twitch 真抓資料
      trace.push("payload:build");
      const payload = await buildPayload(trace);

      // D) KV 寫入快照
      trace.push("kv:set:data");
      await kv.set(DATA_KEY, payload);
      await kv.set(UPDATED_KEY, payload.updatedAt);
      await kv.set(LAST_REFRESH_MS_KEY, String(now));

      return { ok: true, skipped: false, updatedAt: payload.updatedAt, trace, envInfo };
    } finally {
      // 解鎖（避免卡死）
      trace.push("kv:del:refresh_lock");
      await kv.del(REFRESH_LOCK_KEY);
    }
  } catch (err: any) {
    const message = err?.message ?? String(err);
    return { ok: false, error: message, trace, envInfo };
  }
}

export async function GET() {
  const result = await refreshOnce();
  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  return GET();
}

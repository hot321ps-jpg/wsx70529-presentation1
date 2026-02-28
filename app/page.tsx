"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WarroomPayload } from "../lib/types";

type ConnStatus = "connecting" | "live" | "degraded" | "error";

function fmt(ts?: string) {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pillLabel(s: ConnStatus) {
  if (s === "live") return "LIVE";
  if (s === "degraded") return "DEGRADED";
  if (s === "connecting") return "CONNECTING";
  return "ERROR";
}

function pillTone(s: ConnStatus) {
  if (s === "live") return "bg-emerald-400/15 text-emerald-200 border-emerald-300/20";
  if (s === "degraded") return "bg-amber-400/15 text-amber-200 border-amber-300/20";
  if (s === "connecting") return "bg-white/10 text-neutral-200 border-white/10";
  return "bg-red-400/15 text-red-200 border-red-300/20";
}

function useAnimatedNumber(target: number | null, durationMs = 650) {
  const [value, setValue] = useState<number>(target ?? 0);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const lastTarget = useRef<number | null>(null);

  useEffect(() => {
    if (target == null || !Number.isFinite(target)) return;

    if (lastTarget.current === target) return;
    lastTarget.current = target;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    fromRef.current = value;
    startRef.current = performance.now();

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const t = clamp((now - startRef.current) / durationMs, 0, 1);
      const eased = easeOutCubic(t);
      const v = fromRef.current + (target - fromRef.current) * eased;
      setValue(v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return Math.round(value);
}

function SparkLine({
  points,
  height = 56,
}: {
  points: { date: string; value: number }[];
  height?: number;
}) {
  const w = 520;
  const h = height;
  const pad = 6;

  const vals = points.map((p) => p.value);
  const min = Math.min(...(vals.length ? vals : [0]));
  const max = Math.max(...(vals.length ? vals : [1]));
  const range = Math.max(1, max - min);

  const path = points
    .map((p, i) => {
      const x = pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
      const y = h - pad - ((p.value - min) * (h - pad * 2)) / range;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgba(56,189,248,0.65)" />
          <stop offset="1" stopColor="rgba(168,85,247,0.65)" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={path} fill="none" stroke="url(#spark)" strokeWidth="2.5" filter="url(#glow)" />
    </svg>
  );
}

export default function Page() {
  const [data, setData] = useState<WarroomPayload | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");

  const sseRetry = useRef(0);
  const refreshRetry = useRef(0);
  const refreshTimer = useRef<number | null>(null);

  // 0) 首次載入先拿快照（有就先顯示）
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/warroom", { cache: "no-store" });
        if (r.ok) setData(await r.json());
      } catch {}
    })();
  }, []);

  // 1) 前端主動 refresh（Hobby 免 Cron）：首次立即刷新 + 之後每 60 秒
  useEffect(() => {
    let stopped = false;

    const schedule = (ms: number) => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(loop, ms);
    };

    const loop = async () => {
      if (stopped) return;

      try {
        const res = await fetch("/api/warroom-refresh", { cache: "no-store" });

        if (!res.ok) {
          refreshRetry.current += 1;
          const wait = Math.min(10 * 60_000, 10_000 * 2 ** refreshRetry.current);
          schedule(wait);
          return;
        }

        refreshRetry.current = 0;

        // refresh 成功後再拉一次快照，讓 UI 立刻有值（不用等 SSE）
        try {
          const r = await fetch("/api/warroom", { cache: "no-store" });
          if (r.ok) setData(await r.json());
        } catch {}

        schedule(60_000);
      } catch {
        refreshRetry.current += 1;
        const wait = Math.min(10 * 60_000, 10_000 * 2 ** refreshRetry.current);
        schedule(wait);
      }
    };

    loop();

    return () => {
      stopped = true;
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  // 2) SSE 訂閱
  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;

    const connect = () => {
      setStatus((prev) => (prev === "live" ? "live" : "connecting"));
      es = new EventSource("/api/warroom-stream");

      es.addEventListener("snapshot", (ev) => {
        sseRetry.current = 0;
        setStatus("live");
        try {
          setData(JSON.parse((ev as MessageEvent).data));
        } catch {
          setStatus("degraded");
        }
      });

      es.onerror = async () => {
        es?.close();
        if (stopped) return;

        // SSE 掛了就 fallback 拉快照
        try {
          const r = await fetch("/api/warroom", { cache: "no-store" });
          if (r.ok) setData(await r.json());
          setStatus("degraded");
        } catch {
          setStatus("error");
        }

        sseRetry.current += 1;
        const wait = Math.min(15_000, 1000 * 2 ** sseRetry.current);
        setTimeout(() => !stopped && connect(), wait);
      };
    };

    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, []);

  const isLive = !!data?.live?.isLive;
  const viewersTarget = data?.live?.viewerCount ?? data?.kpis?.viewersNow ?? null;
  const vodCount30d = data?.kpis?.vodCount30d ?? null;
  const liveDays30d = data?.kpis?.liveDaysEstimate30d ?? null;

  const viewers = useAnimatedNumber(viewersTarget, 650);
  const vods = useAnimatedNumber(vodCount30d ?? 0, 650);
  const liveDays = useAnimatedNumber(liveDays30d ?? 0, 650);

  const title = data?.live?.title ?? "—";
  const game = data?.live?.gameName ?? "—";
  const trend = data?.trend30d ?? [];
  const latestEvents = (data?.events ?? []).slice(0, 6);

  const tickerText = useMemo(() => {
    const pieces: string[] = [];
    pieces.push(isLive ? `● LIVE · 同接 ${viewersTarget ?? "-"} · ${game}` : "○ OFFLINE");
    pieces.push(`更新：${fmt(data?.updatedAt)}`);
    for (const e of latestEvents.slice(0, 3)) {
      pieces.push(`${e.level.toUpperCase()}: ${e.title}`);
    }
    return pieces.join("  •  ");
  }, [isLive, viewersTarget, game, data?.updatedAt, latestEvents]);

  const liveAccent = isLive
    ? "from-emerald-400/20 via-cyan-400/10 to-fuchsia-500/20"
    : "from-white/10 via-white/5 to-white/10";
  const liveGlow = isLive
    ? "shadow-[0_0_80px_rgba(16,185,129,0.22)]"
    : "shadow-[0_0_70px_rgba(168,85,247,0.12)]";

  return (
    <div className="relative min-h-screen overflow-hidden bg-neutral-950 text-neutral-100">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className={`absolute -top-40 left-1/2 h-[520px] w-[860px] -translate-x-1/2 rounded-full bg-gradient-to-r ${liveAccent} blur-3xl`}
        />
        <div className="absolute -bottom-48 -left-40 h-[520px] w-[520px] rounded-full bg-gradient-to-tr from-fuchsia-500/20 via-purple-500/10 to-cyan-400/10 blur-3xl" />
        <div className="absolute -top-48 -right-40 h-[520px] w-[520px] rounded-full bg-gradient-to-tr from-cyan-400/15 via-emerald-400/10 to-fuchsia-500/15 blur-3xl" />

        {/* grid */}
        <div
          className="absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            backgroundPosition: "center",
          }}
        />
        {/* scanlines */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, rgba(255,255,255,0.9) 1px, transparent 1px)",
            backgroundSize: "100% 6px",
          }}
        />
        {/* noise */}
        <div
          className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
          style={{
            backgroundImage:
              "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"240\" height=\"240\"><filter id=\"n\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.8\" numOctaves=\"3\" stitchTiles=\"stitch\"/></filter><rect width=\"240\" height=\"240\" filter=\"url(%23n)\" opacity=\"0.5\"/></svg>')",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 py-10">
        {/* Top bar */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`h-12 w-12 rounded-2xl bg-gradient-to-br from-cyan-400/30 via-fuchsia-500/20 to-emerald-400/25 ${liveGlow} border border-white/10`}
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">wsx70529 WAR ROOM</h1>
                <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${pillTone(status)}`}>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      status === "live"
                        ? "bg-emerald-300"
                        : status === "degraded"
                        ? "bg-amber-300"
                        : status === "error"
                        ? "bg-red-300"
                        : "bg-neutral-300"
                    }`}
                  />
                  {pillLabel(status)}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-400">
                Twitch 真資料 · KV 快取 · 去重鎖 · SSE 推送 · Hobby 免 Cron
              </p>
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs text-neutral-400">Last snapshot</div>
            <div className="font-medium">{fmt(data?.updatedAt)}</div>
          </div>
        </div>

        {/* Status Banner */}
        <div className={`mt-6 rounded-2xl border border-white/10 ${isLive ? "bg-emerald-400/10" : "bg-white/5"} p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isLive ? "bg-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.75)]" : "bg-neutral-400"
                }`}
              />
              <div className="font-semibold tracking-tight">
                {isLive ? "ON AIR — LIVE SIGNAL LOCKED" : "OFFLINE — WAITING FOR NEXT SESSION"}
              </div>
              <div className="text-sm text-neutral-400">
                {isLive ? `Viewers ${viewersTarget ?? "-"}` : `Last snapshot ${fmt(data?.updatedAt)}`}
              </div>
            </div>
            <div className="text-xs text-neutral-500">
              API: <span className="text-neutral-200">/api/warroom-refresh</span> · SSE:{" "}
              <span className="text-neutral-200">{status}</span>
            </div>
          </div>
        </div>

        {/* Ticker */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-neutral-950 to-transparent" />
            <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-neutral-950 to-transparent" />
            <div className="animate-[marquee_18s_linear_infinite] whitespace-nowrap px-6 py-3 text-sm text-neutral-200">
              <span className="mx-6 inline-flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${isLive ? "bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.6)]" : "bg-neutral-400"}`} />
                {tickerText}
              </span>
              <span className="mx-6 inline-flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${isLive ? "bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.6)]" : "bg-neutral-400"}`} />
                {tickerText}
              </span>
            </div>
          </div>
        </div>

        {/* Main grid */}
        <div className="mt-6 grid gap-4 lg:grid-cols-12">
          {/* KPI column */}
          <div className="lg:col-span-8">
            <div className="grid gap-4 md:grid-cols-3">
              <div className={`rounded-2xl border border-white/10 bg-white/5 p-5 ${liveGlow}`}>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-neutral-400">LIVE VIEWERS</div>
                  <div className={`text-[11px] ${isLive ? "text-emerald-200" : "text-neutral-400"}`}>
                    {isLive ? "ON AIR" : "OFFLINE"}
                  </div>
                </div>
                <div className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">
                  {viewersTarget == null ? "—" : viewers.toLocaleString()}
                </div>
                <div className="mt-2 text-xs text-neutral-400">
                  {isLive ? `Game: ${game}` : "等待下一次開播"}
                </div>
                <div className="mt-4 h-[56px] rounded-xl border border-white/10 bg-black/20 p-2">
                  <SparkLine points={trend.slice(-20)} height={48} />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="text-xs text-neutral-400">VOD (30D)</div>
                <div className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">
                  {vodCount30d == null ? "—" : vods.toLocaleString()}
                </div>
                <div className="mt-2 text-xs text-neutral-400">近 30 天內容產出量</div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[11px] text-neutral-500">LIVE DAYS (est)</div>
                    <div className="mt-1 text-xl font-semibold tabular-nums">
                      {liveDays30d == null ? "—" : liveDays.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[11px] text-neutral-500">MODE</div>
                    <div className="mt-1 text-sm font-medium">
                      {isLive ? "HYPER MODE" : "IDLE MODE"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="text-xs text-neutral-400">NOW PLAYING</div>
                <div className="mt-3 line-clamp-2 text-lg font-semibold leading-snug">
                  {title}
                </div>
                <div className="mt-2 text-sm text-neutral-400">{game}</div>

                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[11px] text-neutral-500">STREAM START</div>
                  <div className="mt-1 text-sm font-medium">
                    {data?.live?.startedAt ? fmt(data.live.startedAt) : "—"}
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[11px] text-neutral-500">CHANNEL</div>
                  <div className="mt-1 text-sm font-medium">
                    {data?.channel?.displayName ?? "wsx70529"}{" "}
                    <span className="text-neutral-500">(@{data?.channel?.login ?? "wsx70529"})</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Events */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">ALERTS & EVENTS</div>
                <div className="text-xs text-neutral-500">
                  SSE: {status === "live" ? "Connected" : status === "connecting" ? "Connecting" : "Fallback"}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {latestEvents.length ? (
                  latestEvents.map((e) => (
                    <div
                      key={e.id}
                      className="rounded-xl border border-white/10 bg-black/20 p-4 hover:bg-black/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-medium">{e.title}</div>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-1 text-[11px] ${
                            e.level === "critical"
                              ? "border-red-300/20 bg-red-400/10 text-red-200"
                              : e.level === "warn"
                              ? "border-amber-300/20 bg-amber-400/10 text-amber-200"
                              : "border-cyan-300/20 bg-cyan-400/10 text-cyan-200"
                          }`}
                        >
                          {e.level.toUpperCase()}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-neutral-300">{e.detail}</div>
                      <div className="mt-2 text-[11px] text-neutral-500">{fmt(e.ts)}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-neutral-500">尚無事件（等第一次 refresh 成功後會出現）。</div>
                )}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="lg:col-span-4">
            <div className={`rounded-2xl border border-white/10 bg-white/5 p-5 ${liveGlow}`}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">RECENT VODS</div>
                <div className="text-xs text-neutral-500">{(data?.recentVods?.length ?? 0) ? "Latest" : "—"}</div>
              </div>

              <div className="mt-4 space-y-3">
                {(data?.recentVods ?? []).slice(0, 10).map((v) => (
                  <a
                    key={v.id}
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group block rounded-xl border border-white/10 bg-black/20 p-4 hover:bg-black/30 transition-colors"
                  >
                    <div className="line-clamp-2 font-medium group-hover:text-white text-neutral-200">
                      {v.title}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                      <span>{fmt(v.createdAt)}</span>
                      <span>•</span>
                      <span>{v.duration}</span>
                      <span>•</span>
                      <span>{v.viewCount.toLocaleString()} views</span>
                    </div>
                  </a>
                ))}
                {!data?.recentVods?.length ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-neutral-500">
                    尚無資料（請先打一次 <span className="text-neutral-300">/api/warroom-refresh</span>）。
                  </div>
                ) : null}
              </div>

              <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="text-[11px] text-neutral-500">OPS</div>
                <div className="mt-1 text-sm text-neutral-300">
                  Hobby 模式：頁面開著才會刷新（不靠 Cron）。多人同時觀看由後端「去重鎖」保護 Twitch API。
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-neutral-500">
          Tip: 如果一直沒有資料，直接開 <span className="text-neutral-300">/api/warroom-refresh</span> 看是否回 <span className="text-neutral-300">{`{ ok: true }`}</span>
        </div>
      </div>

      {/* marquee keyframes */}
      <style jsx global>{`
        @keyframes marquee {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WarroomPayload } from "../lib/types";

type ConnStatus = "connecting" | "live" | "degraded" | "error";

function fmt(ts?: string) {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pillLabel(s: ConnStatus) {
  if (s === "live") return "LIVE";
  if (s === "degraded") return "DEGRADED";
  if (s === "connecting") return "CONNECTING";
  return "ERROR";
}

function pillTone(s: ConnStatus) {
  if (s === "live") return "bg-emerald-400/15 text-emerald-200 border-emerald-300/20";
  if (s === "degraded") return "bg-amber-400/15 text-amber-200 border-amber-300/20";
  if (s === "connecting") return "bg-white/10 text-neutral-200 border-white/10";
  return "bg-red-400/15 text-red-200 border-red-300/20";
}

function useAnimatedNumber(target: number | null, durationMs = 650) {
  const [value, setValue] = useState<number>(target ?? 0);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const lastTarget = useRef<number | null>(null);

  useEffect(() => {
    if (target == null || !Number.isFinite(target)) return;

    if (lastTarget.current === target) return;
    lastTarget.current = target;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    fromRef.current = value;
    startRef.current = performance.now();

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const t = clamp((now - startRef.current) / durationMs, 0, 1);
      const eased = easeOutCubic(t);
      const v = fromRef.current + (target - fromRef.current) * eased;
      setValue(v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return Math.round(value);
}

function SparkLine({
  points,
  height = 56,
}: {
  points: { date: string; value: number }[];
  height?: number;
}) {
  const w = 520;
  const h = height;
  const pad = 6;

  const vals = points.map((p) => p.value);
  const min = Math.min(...(vals.length ? vals : [0]));
  const max = Math.max(...(vals.length ? vals : [1]));
  const range = Math.max(1, max - min);

  const path = points
    .map((p, i) => {
      const x = pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
      const y = h - pad - ((p.value - min) * (h - pad * 2)) / range;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgba(56,189,248,0.65)" />
          <stop offset="1" stopColor="rgba(168,85,247,0.65)" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={path} fill="none" stroke="url(#spark)" strokeWidth="2.5" filter="url(#glow)" />
    </svg>
  );
}

export default function Page() {
  const [data, setData] = useState<WarroomPayload | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");

  const sseRetry = useRef(0);
  const refreshRetry = useRef(0);
  const refreshTimer = useRef<number | null>(null);

  // 0) 首次載入先拿快照（有就先顯示）
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/warroom", { cache: "no-store" });
        if (r.ok) setData(await r.json());
      } catch {}
    })();
  }, []);

  // 1) 前端主動 refresh（Hobby 免 Cron）：首次立即刷新 + 之後每 60 秒
  useEffect(() => {
    let stopped = false;

    const schedule = (ms: number) => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(loop, ms);
    };

    const loop = async () => {
      if (stopped) return;

      try {
        const res = await fetch("/api/warroom-refresh", { cache: "no-store" });

        if (!res.ok) {
          refreshRetry.current += 1;
          const wait = Math.min(10 * 60_000, 10_000 * 2 ** refreshRetry.current);
          schedule(wait);
          return;
        }

        refreshRetry.current = 0;

        // refresh 成功後再拉一次快照，讓 UI 立刻有值（不用等 SSE）
        try {
          const r = await fetch("/api/warroom", { cache: "no-store" });
          if (r.ok) setData(await r.json());
        } catch {}

        schedule(60_000);
      } catch {
        refreshRetry.current += 1;
        const wait = Math.min(10 * 60_000, 10_000 * 2 ** refreshRetry.current);
        schedule(wait);
      }
    };

    loop();

    return () => {
      stopped = true;
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  // 2) SSE 訂閱
  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;

    const connect = () => {
      setStatus((prev) => (prev === "live" ? "live" : "connecting"));
      es = new EventSource("/api/warroom-stream");

      es.addEventListener("snapshot", (ev) => {
        sseRetry.current = 0;
        setStatus("live");
        try {
          setData(JSON.parse((ev as MessageEvent).data));
        } catch {
          setStatus("degraded");
        }
      });

      es.onerror = async () => {
        es?.close();
        if (stopped) return;

        // SSE 掛了就 fallback 拉快照
        try {
          const r = await fetch("/api/warroom", { cache: "no-store" });
          if (r.ok) setData(await r.json());
          setStatus("degraded");
        } catch {
          setStatus("error");
        }

        sseRetry.current += 1;
        const wait = Math.min(15_000, 1000 * 2 ** sseRetry.current);
        setTimeout(() => !stopped && connect(), wait);
      };
    };

    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, []);

  const isLive = !!data?.live?.isLive;
  const viewersTarget = data?.live?.viewerCount ?? data?.kpis?.viewersNow ?? null;
  const vodCount30d = data?.kpis?.vodCount30d ?? null;
  const liveDays30d = data?.kpis?.liveDaysEstimate30d ?? null;

  const viewers = useAnimatedNumber(viewersTarget, 650);
  const vods = useAnimatedNumber(vodCount30d ?? 0, 650);
  const liveDays = useAnimatedNumber(liveDays30d ?? 0, 650);

  const title = data?.live?.title ?? "—";
  const game = data?.live?.gameName ?? "—";
  const trend = data?.trend30d ?? [];
  const latestEvents = (data?.events ?? []).slice(0, 6);

  const tickerText = useMemo(() => {
    const pieces: string[] = [];
    pieces.push(isLive ? `● LIVE · 同接 ${viewersTarget ?? "-"} · ${game}` : "○ OFFLINE");
    pieces.push(`更新：${fmt(data?.updatedAt)}`);
    for (const e of latestEvents.slice(0, 3)) {
      pieces.push(`${e.level.toUpperCase()}: ${e.title}`);
    }
    return pieces.join("  •  ");
  }, [isLive, viewersTarget, game, data?.updatedAt, latestEvents]);

  const liveAccent = isLive
    ? "from-emerald-400/20 via-cyan-400/10 to-fuchsia-500/20"
    : "from-white/10 via-white/5 to-white/10";
  const liveGlow = isLive
    ? "shadow-[0_0_80px_rgba(16,185,129,0.22)]"
    : "shadow-[0_0_70px_rgba(168,85,247,0.12)]";

  return (
    <div className="relative min-h-screen overflow-hidden bg-neutral-950 text-neutral-100">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className={`absolute -top-40 left-1/2 h-[520px] w-[860px] -translate-x-1/2 rounded-full bg-gradient-to-r ${liveAccent} blur-3xl`}
        />
        <div className="absolute -bottom-48 -left-40 h-[520px] w-[520px] rounded-full bg-gradient-to-tr from-fuchsia-500/20 via-purple-500/10 to-cyan-400/10 blur-3xl" />
        <div className="absolute -top-48 -right-40 h-[520px] w-[520px] rounded-full bg-gradient-to-tr from-cyan-400/15 via-emerald-400/10 to-fuchsia-500/15 blur-3xl" />

        {/* grid */}
        <div
          className="absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            backgroundPosition: "center",
          }}
        />
        {/* scanlines */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, rgba(255,255,255,0.9) 1px, transparent 1px)",
            backgroundSize: "100% 6px",
          }}
        />
        {/* noise */}
        <div
          className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
          style={{
            backgroundImage:
              "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"240\" height=\"240\"><filter id=\"n\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.8\" numOctaves=\"3\" stitchTiles=\"stitch\"/></filter><rect width=\"240\" height=\"240\" filter=\"url(%23n)\" opacity=\"0.5\"/></svg>')",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 py-10">
        {/* Top bar */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`h-12 w-12 rounded-2xl bg-gradient-to-br from-cyan-400/30 via-fuchsia-500/20 to-emerald-400/25 ${liveGlow} border border-white/10`}
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">wsx70529 WAR ROOM</h1>
                <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${pillTone(status)}`}>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      status === "live"
                        ? "bg-emerald-300"
                        : status === "degraded"
                        ? "bg-amber-300"
                        : status === "error"
                        ? "bg-red-300"
                        : "bg-neutral-300"
                    }`}
                  />
                  {pillLabel(status)}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-400">
                Twitch 真資料 · KV 快取 · 去重鎖 · SSE 推送 · Hobby 免 Cron
              </p>
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs text-neutral-400">Last snapshot</div>
            <div className="font-medium">{fmt(data?.updatedAt)}</div>
          </div>
        </div>

        {/* Status Banner */}
        <div className={`mt-6 rounded-2xl border border-white/10 ${isLive ? "bg-emerald-400/10" : "bg-white/5"} p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isLive ? "bg-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.75)]" : "bg-neutral-400"
                }`}
              />
              <div className="font-semibold tracking-tight">
                {isLive ? "ON AIR — LIVE SIGNAL LOCKED" : "OFFLINE — WAITING FOR NEXT SESSION"}
              </div>
              <div className="text-sm text-neutral-400">
                {isLive ? `Viewers ${viewersTarget ?? "-"}` : `Last snapshot ${fmt(data?.updatedAt)}`}
              </div>
            </div>
            <div className="text-xs text-neutral-500">
              API: <span className="text-neutral-200">/api/warroom-refresh</span> · SSE:{" "}
              <span className="text-neutral-200">{status}</span>
            </div>
          </div>
        </div>

        {/* Ticker */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-neutral-950 to-transparent" />
            <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-neutral-950 to-transparent" />
            <div className="animate-[marquee_18s_linear_infinite] whitespace-nowrap px-6 py-3 text-sm text-neutral-200">
              <span className="mx-6 inline-flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${isLive ? "bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.6)]" : "bg-neutral-400"}`} />
                {tickerText}
              </span>
              <span className="mx-6 inline-flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${isLive ? "bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.6)]" : "bg-neutral-400"}`} />
                {tickerText}
              </span>
            </div>
          </div>
        </div>

        {/* Main grid */}
        <div className="mt-6 grid gap-4 lg:grid-cols-12">
          {/* KPI column */}
          <div className="lg:col-span-8">
            <div className="grid gap-4 md:grid-cols-3">
              <div className={`rounded-2xl border border-white/10 bg-white/5 p-5 ${liveGlow}`}>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-neutral-400">LIVE VIEWERS</div>
                  <div className={`text-[11px] ${isLive ? "text-emerald-200" : "text-neutral-400"}`}>
                    {isLive ? "ON AIR" : "OFFLINE"}
                  </div>
                </div>
                <div className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">
                  {viewersTarget == null ? "—" : viewers.toLocaleString()}
                </div>
                <div className="mt-2 text-xs text-neutral-400">
                  {isLive ? `Game: ${game}` : "等待下一次開播"}
                </div>
                <div className="mt-4 h-[56px] rounded-xl border border-white/10 bg-black/20 p-2">
                  <SparkLine points={trend.slice(-20)} height={48} />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="text-xs text-neutral-400">VOD (30D)</div>
                <div className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">
                  {vodCount30d == null ? "—" : vods.toLocaleString()}
                </div>
                <div className="mt-2 text-xs text-neutral-400">近 30 天內容產出量</div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[11px] text-neutral-500">LIVE DAYS (est)</div>
                    <div className="mt-1 text-xl font-semibold tabular-nums">
                      {liveDays30d == null ? "—" : liveDays.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[11px] text-neutral-500">MODE</div>
                    <div className="mt-1 text-sm font-medium">
                      {isLive ? "HYPER MODE" : "IDLE MODE"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="text-xs text-neutral-400">NOW PLAYING</div>
                <div className="mt-3 line-clamp-2 text-lg font-semibold leading-snug">
                  {title}
                </div>
                <div className="mt-2 text-sm text-neutral-400">{game}</div>

                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[11px] text-neutral-500">STREAM START</div>
                  <div className="mt-1 text-sm font-medium">
                    {data?.live?.startedAt ? fmt(data.live.startedAt) : "—"}
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[11px] text-neutral-500">CHANNEL</div>
                  <div className="mt-1 text-sm font-medium">
                    {data?.channel?.displayName ?? "wsx70529"}{" "}
                    <span className="text-neutral-500">(@{data?.channel?.login ?? "wsx70529"})</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Events */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">ALERTS & EVENTS</div>
                <div className="text-xs text-neutral-500">
                  SSE: {status === "live" ? "Connected" : status === "connecting" ? "Connecting" : "Fallback"}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {latestEvents.length ? (
                  latestEvents.map((e) => (
                    <div
                      key={e.id}
                      className="rounded-xl border border-white/10 bg-black/20 p-4 hover:bg-black/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-medium">{e.title}</div>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-1 text-[11px] ${
                            e.level === "critical"
                              ? "border-red-300/20 bg-red-400/10 text-red-200"
                              : e.level === "warn"
                              ? "border-amber-300/20 bg-amber-400/10 text-amber-200"
                              : "border-cyan-300/20 bg-cyan-400/10 text-cyan-200"
                          }`}
                        >
                          {e.level.toUpperCase()}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-neutral-300">{e.detail}</div>
                      <div className="mt-2 text-[11px] text-neutral-500">{fmt(e.ts)}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-neutral-500">尚無事件（等第一次 refresh 成功後會出現）。</div>
                )}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="lg:col-span-4">
            <div className={`rounded-2xl border border-white/10 bg-white/5 p-5 ${liveGlow}`}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">RECENT VODS</div>
                <div className="text-xs text-neutral-500">{(data?.recentVods?.length ?? 0) ? "Latest" : "—"}</div>
              </div>

              <div className="mt-4 space-y-3">
                {(data?.recentVods ?? []).slice(0, 10).map((v) => (
                  <a
                    key={v.id}
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group block rounded-xl border border-white/10 bg-black/20 p-4 hover:bg-black/30 transition-colors"
                  >
                    <div className="line-clamp-2 font-medium group-hover:text-white text-neutral-200">
                      {v.title}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                      <span>{fmt(v.createdAt)}</span>
                      <span>•</span>
                      <span>{v.duration}</span>
                      <span>•</span>
                      <span>{v.viewCount.toLocaleString()} views</span>
                    </div>
                  </a>
                ))}
                {!data?.recentVods?.length ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-neutral-500">
                    尚無資料（請先打一次 <span className="text-neutral-300">/api/warroom-refresh</span>）。
                  </div>
                ) : null}
              </div>

              <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="text-[11px] text-neutral-500">OPS</div>
                <div className="mt-1 text-sm text-neutral-300">
                  Hobby 模式：頁面開著才會刷新（不靠 Cron）。多人同時觀看由後端「去重鎖」保護 Twitch API。
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-neutral-500">
          Tip: 如果一直沒有資料，直接開 <span className="text-neutral-300">/api/warroom-refresh</span> 看是否回 <span className="text-neutral-300">{`{ ok: true }`}</span>
        </div>
      </div>

      {/* marquee keyframes */}
      <style jsx global>{`
        @keyframes marquee {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

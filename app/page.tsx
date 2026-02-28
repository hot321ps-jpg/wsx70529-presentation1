"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WarroomPayload } from "../lib/types";

type ConnStatus = "connecting" | "live" | "degraded" | "error";

function pillLabel(s: ConnStatus) {
  if (s === "live") return "LIVE";
  if (s === "degraded") return "DEGRADED";
  if (s === "connecting") return "CONNECTING";
  return "ERROR";
}

function pillClass(s: ConnStatus) {
  if (s === "live") return "bg-emerald-500/15 text-emerald-200";
  if (s === "degraded") return "bg-amber-500/15 text-amber-200";
  if (s === "connecting") return "bg-white/10 text-neutral-200";
  return "bg-red-500/15 text-red-200";
}

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

export default function Page() {
  const [data, setData] = useState<WarroomPayload | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");

  const sseRetry = useRef(0);
  const refreshRetry = useRef(0);
  const refreshTimer = useRef<number | null>(null);

  // 1) 前端主動 refresh（Hobby 免 Cron）
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
          const wait = Math.min(10 * 60_000, 30_000 * 2 ** refreshRetry.current);
          schedule(wait);
          return;
        }
        refreshRetry.current = 0;
        schedule(60_000);
      } catch {
        refreshRetry.current += 1;
        const wait = Math.min(10 * 60_000, 30_000 * 2 ** refreshRetry.current);
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
  const viewers = data?.live?.viewerCount ?? data?.kpis?.viewersNow ?? null;
  const title = data?.live?.title ?? "-";
  const game = data?.live?.gameName ?? "-";
  const trend = data?.trend30d ?? [];

  const trendStats = useMemo(() => {
    if (!trend.length) return { min: 0, max: 1 };
    const vals = trend.map((t) => t.value);
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [trend]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">wsx70529 即時戰情室</h1>
            <p className="mt-1 text-sm text-neutral-400">Twitch 真資料（KV + 去重鎖 + SSE + Hobby 前端刷新）</p>
          </div>
          <span className={`rounded-full px-2 py-1 text-xs ${pillClass(status)}`}>{pillLabel(status)}</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="text-neutral-300">
              最後更新： <span className="text-neutral-200">{fmt(data?.updatedAt)}</span>
            </div>
            <div className="text-xs text-neutral-500">
              直播狀態： <span className="text-neutral-200">{isLive ? "直播中" : "離線"}</span>
              {isLive ? (
                <>
                  {" · 同接 "}
                  <span className="text-neutral-200">{viewers ?? "-"}</span>
                  {" · "}
                  <span className="text-neutral-200">{game}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-xs text-neutral-400">即時同接</div>
            <div className="mt-2 text-2xl font-semibold">{viewers ?? "-"}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-xs text-neutral-400">近 30 日 VOD</div>
            <div className="mt-2 text-2xl font-semibold">{data?.kpis?.vodCount30d ?? "-"}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-xs text-neutral-400">近 30 日直播天數（估）</div>
            <div className="mt-2 text-2xl font-semibold">{data?.kpis?.liveDaysEstimate30d ?? "-"}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-xs text-neutral-400">目前標題</div>
            <div className="mt-2 line-clamp-2 text-sm text-neutral-200">{title}</div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm font-semibold">近 30 日趨勢（每日 VOD 數量）</div>
            <div className="mt-4 flex h-20 items-end gap-1">
              {trend.map((p) => {
                const { min, max } = trendStats;
                const t = max === min ? 0.5 : (p.value - min) / (max - min);
                const h = clamp(Math.round(t * 100), 8, 100);
                return (
                  <div key={p.date} className="flex-1">
                    <div className="w-full rounded-md bg-white/20" style={{ height: `${h}%` }} title={`${p.date}: ${p.value}`} />
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex justify-between text-[11px] text-neutral-500">
              <span>{trend[0]?.date ?? ""}</span>
              <span>{trend.at(-1)?.date ?? ""}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm font-semibold">事件與告警</div>
            <div className="mt-4 space-y-3">
              {(data?.events ?? []).slice(0, 6).map((e) => (
                <div key={e.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{e.title}</div>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-neutral-200">
                      {e.level.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-neutral-300">{e.detail}</div>
                  <div className="mt-2 text-[11px] text-neutral-500">{fmt(e.ts)}</div>
                </div>
              ))}
              {!data?.events?.length ? <div className="text-sm text-neutral-500">尚無資料（等第一次 refresh 成功）。</div> : null}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm font-semibold">最新 VOD</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(data?.recentVods ?? []).map((v) => (
              <a
                key={v.id}
                href={v.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-white/10 bg-black/20 p-4 hover:bg-black/30"
              >
                <div className="font-medium">{v.title}</div>
                <div className="mt-2 text-xs text-neutral-400">
                  {fmt(v.createdAt)} · {v.duration} · views {v.viewCount}
                </div>
              </a>
            ))}
            {!data?.recentVods?.length ? <div className="text-sm text-neutral-500">尚無資料（等第一次 refresh 成功）。</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

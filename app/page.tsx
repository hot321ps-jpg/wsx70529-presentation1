"use client";

import useSWR from "swr";
import type { WarroomPayload } from "@/lib/types";
import { Shell } from "@/components/shell";
import { KpiCard } from "@/components/kpi-card";
import { TrendPanel } from "@/components/trend-panel";
import { EventsPanel } from "@/components/events-panel";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function Page() {
  const { data, isLoading, error } = useSWR<WarroomPayload>("/api/warroom", fetcher, {
    refreshInterval: 30_000, // ✅ 每 30 秒自動更新
    revalidateOnFocus: true,
    dedupingInterval: 5_000,
  });

  return (
    <Shell>
      <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-neutral-300">
            狀態：
            {isLoading ? (
              <span className="ml-2 text-neutral-200">載入中…</span>
            ) : error ? (
              <span className="ml-2 text-red-300">API 讀取失敗</span>
            ) : (
              <span className="ml-2 text-emerald-300">運作中（自動刷新）</span>
            )}
          </div>
          <div className="text-xs text-neutral-400">
            最後更新：{" "}
            <span className="text-neutral-200">
              {data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : "-"}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard
          label="近 30 日直播場次"
          value={data ? data.kpis.liveCount30d : "-"}
          hint="可換成你實際統計口徑"
        />
        <KpiCard
          label="平均觀看"
          value={data ? data.kpis.avgViewers : "-"}
          hint="可接平台 API / DB"
        />
        <KpiCard
          label="最高同接"
          value={data ? data.kpis.peakViewers : "-"}
          hint="可改成峰值/中位數等"
        />
        <KpiCard
          label="追隨者變化（30d）"
          value={data ? data.kpis.followersDelta30d : "-"}
          hint="正負值都能顯示"
        />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <TrendPanel data={data?.trend30d ?? []} />
        <EventsPanel events={data?.events ?? []} />
      </div>
    </Shell>
  );
}

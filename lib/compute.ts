import type { TrendPoint, WarroomEvent } from "./types";

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function buildVodTrend30d(vods: { createdAt: string }[]): TrendPoint[] {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 29);

  const map = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    map.set(ymd(d), 0);
  }

  for (const v of vods) {
    const dt = new Date(v.createdAt);
    if (dt < start || dt > today) continue;
    const key = ymd(dt);
    if (map.has(key)) map.set(key, (map.get(key) ?? 0) + 1);
  }

  return Array.from(map.entries()).map(([date, value]) => ({ date, value }));
}

export function buildEvents(args: {
  updatedAt: string;
  isLive: boolean;
  viewerCount: number;
  trend30d: TrendPoint[];
}): WarroomEvent[] {
  const { updatedAt, isLive, viewerCount, trend30d } = args;
  const events: WarroomEvent[] = [];

  events.push({
    id: `live-${updatedAt}`,
    level: isLive ? "info" : "warn",
    title: isLive ? "直播中" : "離線中",
    detail: isLive ? `即時同接 ${viewerCount}` : "目前未偵測到直播。",
    ts: updatedAt
  });

  const vals = trend30d.map((x) => x.value);
  const last = vals.at(-1) ?? 0;
  const prev = vals.at(-2) ?? last;
  const delta = last - prev;

  if (Math.abs(delta) >= 3) {
    events.push({
      id: `vod-delta-${updatedAt}`,
      level: "info",
      title: "內容節奏變化",
      detail: `今日 VOD 數量相較昨日變動 ${delta > 0 ? "+" : ""}${delta}（以 VOD 發布日估算）。`,
      ts: updatedAt
    });
  }

  if (isLive && viewerCount >= 1500) {
    events.push({
      id: `peak-${updatedAt}`,
      level: "warn",
      title: "高同接尖峰",
      detail: "同接偏高，建議即時置頂：訂閱/社群導流/精華剪輯提醒。",
      ts: updatedAt
    });
  }

  return events;
}

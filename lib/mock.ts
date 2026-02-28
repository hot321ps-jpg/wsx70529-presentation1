import type { WarroomPayload, TrendPoint, WarroomEvent } from "./types";

function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeMockWarroomData(seed = Date.now()): WarroomPayload {
  const rand = mulberry32(seed);

  // 30 天趨勢（例如每日直播熱度/觀看指標）
  const today = new Date();
  const trend30d: TrendPoint[] = [];
  let base = 80 + Math.floor(rand() * 40);

  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);

    // 小幅波動 + 偶爾尖峰
    const spike = rand() < 0.08 ? 60 + Math.floor(rand() * 120) : 0;
    base = Math.max(10, base + Math.floor((rand() - 0.5) * 18) + Math.floor(spike * 0.15));

    trend30d.push({
      date: formatDate(d),
      value: base + spike,
    });
  }

  const peakViewers = 600 + Math.floor(rand() * 1800);
  const avgViewers = 180 + Math.floor(rand() * 420);
  const liveCount30d = 6 + Math.floor(rand() * 18);
  const followersDelta30d = Math.floor((rand() - 0.3) * 2000);

  const nowIso = new Date().toISOString();

  const events: WarroomEvent[] = [
    {
      id: "evt-1",
      level: rand() < 0.2 ? "critical" : "warn",
      title: "高波動風險",
      detail: "近 7 日峰值波動偏大，建議檢查是否有爆量題材或外部導流。",
      ts: nowIso,
    },
    {
      id: "evt-2",
      level: "info",
      title: "主題熱度建議",
      detail: "可嘗試把高互動片段切短，製作 30–60 秒精華，提升回訪率。",
      ts: nowIso,
    },
    {
      id: "evt-3",
      level: rand() < 0.25 ? "warn" : "info",
      title: "排程提醒",
      detail: "若本週直播天數 < 3，建議固定週期以穩定推薦權重。",
      ts: nowIso,
    },
  ];

  return {
    updatedAt: nowIso,
    kpis: { liveCount30d, avgViewers, peakViewers, followersDelta30d },
    trend30d,
    events,
  };
}

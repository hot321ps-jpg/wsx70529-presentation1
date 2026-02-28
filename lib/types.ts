export type KPI = {
  liveCount30d: number;
  avgViewers: number;
  peakViewers: number;
  followersDelta30d: number;
};

export type TrendPoint = {
  date: string; // YYYY-MM-DD
  value: number;
};

export type WarroomEvent = {
  id: string;
  level: "info" | "warn" | "critical";
  title: string;
  detail: string;
  ts: string; // ISO
};

export type WarroomPayload = {
  updatedAt: string; // ISO
  kpis: KPI;
  trend30d: TrendPoint[];
  events: WarroomEvent[];
};

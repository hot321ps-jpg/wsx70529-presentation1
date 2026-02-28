export type KPI = {
  isLive: boolean;
  viewersNow: number;
  vodCount30d: number;
  liveDaysEstimate30d: number;
};

export type TrendPoint = { date: string; value: number };

export type WarroomEvent = {
  id: string;
  level: "info" | "warn" | "critical";
  title: string;
  detail: string;
  ts: string;
};

export type WarroomPayload = {
  updatedAt: string;
  channel: {
    login: string;
    userId: string;
    displayName: string;
    profileImageUrl?: string;
  };
  live: {
    isLive: boolean;
    title?: string;
    gameName?: string;
    viewerCount?: number;
    startedAt?: string;
  };
  kpis: KPI;
  trend30d: TrendPoint[];
  events: WarroomEvent[];
  recentVods: Array<{
    id: string;
    title: string;
    createdAt: string;
    duration: string;
    url: string;
    viewCount: number;
  }>;
};

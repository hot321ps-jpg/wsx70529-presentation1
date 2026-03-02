// lib/types.ts
export interface WarroomPayload {
  channel: {
    id: string;
    login: string;
    displayName: string;
    profileImageUrl: string;
  };
  live: {
    isLive: boolean;
    title: string;
    gameName: string;
    viewerCount: number;
    startedAt: string;
  } | null;
  recentVods: Array<{
    id: string;
    title: string;
    createdAt: string;
    duration: string;
    url: string;
    viewCount: number;
  }>;
  kpis: {
    vodCount30d: number;
    liveDaysEstimate30d: number;
  };
  updatedAt: string; // ISO 日期字串
}

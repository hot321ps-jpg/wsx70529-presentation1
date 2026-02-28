import React from "react";
import type { WarroomEvent } from "@/lib/types";

const levelStyle: Record<WarroomEvent["level"], string> = {
  info: "bg-white/10 text-neutral-200",
  warn: "bg-amber-500/15 text-amber-200",
  critical: "bg-red-500/15 text-red-200",
};

export function EventsPanel({ events }: { events: WarroomEvent[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="text-sm font-semibold">事件與風險</div>
      <div className="mt-1 text-xs text-neutral-400">由資料計算或規則引擎產生（之後可接你的真規則）</div>

      <div className="mt-4 space-y-3">
        {events.map((e) => (
          <div key={e.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{e.title}</div>
              <span className={`rounded-full px-2 py-1 text-[11px] ${levelStyle[e.level]}`}>
                {e.level.toUpperCase()}
              </span>
            </div>
            <div className="mt-2 text-sm text-neutral-300">{e.detail}</div>
            <div className="mt-2 text-[11px] text-neutral-500">{new Date(e.ts).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

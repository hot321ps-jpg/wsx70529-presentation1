import React from "react";
import type { TrendPoint } from "@/lib/types";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function TrendPanel({ data }: { data: TrendPoint[] }) {
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const last = data.at(-1);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-sm font-semibold">近 30 日趨勢</div>
          <div className="mt-1 text-xs text-neutral-400">以日為單位的指標變化（可替換成你的真實指標）</div>
        </div>
        <div className="text-xs text-neutral-400">
          最新：<span className="font-semibold text-neutral-200">{last?.value ?? "-"}</span>
        </div>
      </div>

      <div className="mt-4 flex h-20 items-end gap-1">
        {data.map((p) => {
          const t = max === min ? 0.5 : (p.value - min) / (max - min);
          const h = clamp(Math.round(t * 100), 8, 100);
          return (
            <div key={p.date} className="flex-1">
              <div
                className="w-full rounded-md bg-white/20"
                style={{ height: `${h}%` }}
                title={`${p.date}: ${p.value}`}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex justify-between text-[11px] text-neutral-500">
        <span>{data[0]?.date}</span>
        <span>{data.at(-1)?.date}</span>
      </div>
    </div>
  );
}

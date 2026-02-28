import React from "react";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">wsx70529 戰情室</h1>
            <p className="mt-1 text-sm text-neutral-400">自動刷新資料面板（可直接接真 API）</p>
          </div>
          <div className="text-xs text-neutral-500">Vercel-ready / Next.js App Router</div>
        </div>
        {children}
      </div>
    </div>
  );
}

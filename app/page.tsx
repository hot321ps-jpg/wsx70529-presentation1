"use client";

import { useEffect, useState } from "react";
// ✅ 使用相對路徑 (往上退一層)
import type { WarroomPayload } from "../lib/types";

export default function WarRoomPage() {
  const [data, setData] = useState<WarroomPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [lastRefreshed, setLastRefreshed] = useState("");

  const fetchData = async () => {
    try {
      const res = await fetch("/api/warroom", { cache: "no-store" });
      const json = await res.json();
      
      if (json.ok) {
        setData(json.data);
        setStatus("live");
        setLastRefreshed(new Date().toLocaleTimeString());
      } else {
        setStatus("error");
      }
    } catch (e) {
      setStatus("error");
    }
  };

  useEffect(() => {
    fetchData(); // 初次載入
    const interval = setInterval(fetchData, 30000); // 每 30 秒向後端請求一次
    return () => clearInterval(interval);
  }, []);

  if (status === "loading" && !data) {
    return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-cyan-400 animate-pulse">連線至 War Room 系統中...</div>;
  }

  if (status === "error" && !data) {
    return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-red-500">系統連線失敗，請檢查環境變數。</div>;
  }

  const isLive = !!data?.live;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 p-6 md:p-12 font-mono selection:bg-cyan-900">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header 區塊 */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-neutral-800 pb-6">
          <div className="flex items-center gap-4">
            <img src={data?.channel.profileImageUrl} alt="Profile" className="w-16 h-16 rounded-full border border-neutral-700 shadow-[0_0_15px_rgba(34,211,238,0.2)]" />
            <div>
              <h1 className="text-2xl font-bold tracking-wider text-white">[{data?.channel.displayName?.toUpperCase()}] WAR ROOM</h1>
              <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500">
                <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-red-500 shadow-[0_0_8px_red] animate-pulse' : 'bg-neutral-600'}`}></span>
                狀態: {isLive ? "LIVE SIGNAL DETECTED" : "OFFLINE"}
                <span className="ml-4 text-cyan-600">更新時間: {lastRefreshed}</span>
              </div>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左側：即時數據 */}
          <div className="lg:col-span-2 space-y-6">
            <div className={`p-6 rounded-xl border ${isLive ? 'bg-red-950/20 border-red-900/50' : 'bg-neutral-900/50 border-neutral-800'} backdrop-blur-sm`}>
              <h2 className="text-sm text-neutral-500 uppercase tracking-widest mb-4">Current Operation</h2>
              {isLive ? (
                <div>
                  <div className="text-3xl md:text-5xl font-bold text-white mb-2">{data?.live?.title}</div>
                  <div className="flex gap-6 mt-6 text-sm">
                    <div className="bg-black/50 px-4 py-2 rounded border border-neutral-800">
                      <span className="text-neutral-500 block text-xs">Category</span>
                      <span className="text-cyan-400">{data?.live?.gameName}</span>
                    </div>
                    <div className="bg-black/50 px-4 py-2 rounded border border-neutral-800">
                      <span className="text-neutral-500 block text-xs">Viewers</span>
                      <span className="text-red-400 font-bold">{data?.live?.viewerCount?.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xl text-neutral-600 py-8 text-center border border-dashed border-neutral-800 rounded-lg">
                  Awaiting Transmission...
                </div>
              )}
            </div>

            {/* KPI 區塊 */}
            <div className="grid grid-cols-2 gap-6">
              <div className="p-6 rounded-xl border border-neutral-800 bg-neutral-900/50">
                <div className="text-xs text-neutral-500 mb-1">30 Days VOD Output</div>
                <div className="text-4xl font-light text-white">{data?.kpis.vodCount30d} <span className="text-sm text-neutral-600">Sessions</span></div>
              </div>
              <div className="p-6 rounded-xl border border-neutral-800 bg-neutral-900/50">
                <div className="text-xs text-neutral-500 mb-1">Estimated Active Days</div>
                <div className="text-4xl font-light text-white">{data?.kpis.liveDaysEstimate30d} <span className="text-sm text-neutral-600">Days</span></div>
              </div>
            </div>
          </div>

          {/* 右側：近期 VOD */}
          <div className="space-y-4">
            <h2 className="text-sm text-neutral-500 uppercase tracking-widest">Recent Archives</h2>
            <div className="flex flex-col gap-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {data?.recentVods.slice(0, 8).map((vod) => (
                <a key={vod.id} href={vod.url} target="_blank" rel="noreferrer" 
                   className="group p-4 rounded-lg bg-neutral-900/30 border border-neutral-800 hover:bg-neutral-800/50 hover:border-cyan-900/50 transition-all">
                  <div className="text-sm text-neutral-300 group-hover:text-white line-clamp-2">{vod.title}</div>
                  <div className="mt-3 flex justify-between text-xs text-neutral-600">
                    <span>{new Date(vod.createdAt).toLocaleDateString()}</span>
                    <span>{vod.duration} • {vod.viewCount} views</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

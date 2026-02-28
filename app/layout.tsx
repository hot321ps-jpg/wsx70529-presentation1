import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        {/* 背景特效層 */}
        <div className="wr-bg-glow" />
        <div className="wr-grid" />
        <div className="wr-scanlines" />
        <div className="wr-noise" />

        {/* 內容 */}
        <main className="relative z-10 min-h-screen">{children}</main>
      </body>
    </html>
  );
}

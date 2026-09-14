import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IGLO — Kişisel Cloud",
  description: "Telegram tabanlı şifreli kişisel cloud depolama sistemi",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "IGLO" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        {/* Ambient background orbs */}
        <div className="ambient-orb" style={{ width: 600, height: 600, background: "#6366f1", top: -200, left: -200 }} />
        <div className="ambient-orb" style={{ width: 400, height: 400, background: "#8b5cf6", bottom: -100, right: -100 }} />
        {children}
      </body>
    </html>
  );
}

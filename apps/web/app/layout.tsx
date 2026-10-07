import "@fontsource/ibm-plex-sans-thai-looped/400.css";
import "@fontsource/ibm-plex-sans-thai-looped/500.css";
import "@fontsource/ibm-plex-sans-thai-looped/600.css";
import "@fontsource/ibm-plex-sans-thai-looped/700.css";
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { isAdmin } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: { default: "Tournament Ranking", template: "%s · Tournament Ranking" },
  description: "สถิติและอันดับของทีมและผู้เล่นในทัวร์นาเมนต์",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin();
  const theme = (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="th" data-theme={theme === "light" ? "light" : undefined}>
      <body>
        <header className="header">
          <div className="container header-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">🏆</span>
              Tournament Ranking
            </Link>
            <nav className="nav">
              <Link href="/rankings">Ranking ทีม</Link>
              <Link href="/rankings/players">Ranking ผู้เล่น</Link>
              <Link href="/tournaments">ทัวร์นาเมนต์</Link>
              <Link href="/teams">ทีม</Link>
              <Link href="/players">ผู้เล่น</Link>
              <Link href="/matches">ผลการแข่ง</Link>
              <Link href="/admin">{admin ? "จัดการข้อมูล" : "เข้าสู่ระบบ"}</Link>
            </nav>
            <div className="header-tools">
            <form action="/search" className="header-search" role="search">
              <input name="q" placeholder="ค้นหาทีม ผู้เล่น…" aria-label="ค้นหาทีม ผู้เล่น ทัวร์นาเมนต์" />
              <button className="btn btn-primary" type="submit">ค้นหา</button>
            </form>
            <ThemeToggle initial={theme} />
            </div>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="footer">
          <div className="container row between">
            <span>Tournament Ranking</span>
            <a href={`${process.env.PUBLIC_API_URL ?? process.env.API_URL ?? "http://localhost:4000"}/docs`} target="_blank" rel="noreferrer">
              เอกสาร API สำหรับเชื่อมเว็บอื่น
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}

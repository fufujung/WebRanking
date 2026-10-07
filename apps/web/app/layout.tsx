import "@fontsource-variable/inter";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/600.css";
import "@fontsource/noto-sans-thai/700.css";
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { isAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: { default: "Tournament Ranking", template: "%s · Tournament Ranking" },
  description: "สถิติและอันดับของทีมและผู้เล่นในทัวร์นาเมนต์",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin();
  return (
    <html lang="th">
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
            <form action="/search" className="header-search" role="search">
              <input name="q" placeholder="ค้นหาทีม ผู้เล่น ทัวร์นาเมนต์" aria-label="ค้นหา" />
              <button className="btn btn-primary" type="submit">ค้นหา</button>
            </form>
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

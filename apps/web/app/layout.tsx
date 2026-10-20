import "@fontsource/ibm-plex-sans-thai-looped/400.css";
import "@fontsource/ibm-plex-sans-thai-looped/500.css";
import "@fontsource/ibm-plex-sans-thai-looped/600.css";
import "@fontsource/ibm-plex-sans-thai-looped/700.css";
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { isAdmin } from "@/lib/auth";
import { getMember } from "@/lib/member";
import { discordEnabled } from "@/lib/discord";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MobileHeader } from "@/components/MobileHeader";
import { WatchCoins } from "@/components/WatchCoins";
import { AdBanner, AdPopupSlot } from "@/components/ads/Ads";
import { HideOnAdmin } from "@/components/ads/HideOnAdmin";
import { DiscordJoin } from "@/components/DiscordJoin";
import { siteSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: { default: "Tournament Ranking", template: "%s · Tournament Ranking" },
  description: "สถิติและอันดับของทีมและผู้เล่นในทัวร์นาเมนต์",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin();
  const member = await getMember();
  const { discordInvite } = await siteSettings();
  const theme = (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="th" data-theme={theme === "light" ? "light" : undefined}>
      <body>
        <header className="header">
          <div className="container header-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">🏆</span>
              <span className="brand-name">Tournament Ranking</span>
            </Link>
            <nav className="nav">
              <Link href="/rankings/players">Ranking ผู้เล่น</Link>
              <Link href="/rankings">Ranking ทีม</Link>
              <Link href="/tournaments">ทัวร์นาเมนต์</Link>
              <Link href="/teams">ทีม</Link>
              <Link href="/guilds">กิลด์</Link>
              <Link href="/players">ผู้เล่น</Link>
              <Link href="/matches">ผลการแข่ง</Link>
              <Link href="/special">เล่นเก่งปากเก่ง</Link>
              <Link href="/predict">ทายผล</Link>
              <Link href="/blacklist">Blacklist</Link>
              {admin && <Link href="/admin">จัดการข้อมูล</Link>}
              <DiscordJoin href={discordInvite} className="nav-discord" label="Discord" />
              {member ? (
                <Link href="/me" className="nav-me" title="โปรไฟล์ของฉัน">
                  {member.avatar ? <img src={member.avatar} alt="" /> : null}
                  {member.name}
                </Link>
              ) : discordEnabled() ? (
                <Link href="/me">เข้าสู่ระบบ</Link>
              ) : null}
            </nav>
            <div className="header-tools">
            <form action="/search" className="header-search" role="search">
              <input name="q" placeholder="ค้นหาทีม ผู้เล่น…" aria-label="ค้นหาทีม ผู้เล่น ทัวร์นาเมนต์" />
              <button className="btn btn-primary" type="submit">ค้นหา</button>
            </form>
            <ThemeToggle initial={theme} />
            <DiscordJoin href={discordInvite} className="header-discord" label="" />
            <MobileHeader />
            </div>
          </div>
        </header>
        <main className="container">
          <HideOnAdmin>
            <AdBanner />
          </HideOnAdmin>
          {children}
        </main>
        <HideOnAdmin>
          <AdPopupSlot />
        </HideOnAdmin>
        {member && <WatchCoins />}
        <footer className="footer">
          <div className="container row between">
            <span className="row" style={{ gap: 16 }}>
              <span>Tournament Ranking</span>
              <Link href="/blacklist">⛔ Blacklist</Link>
              <DiscordJoin href={discordInvite} className="btn-sm" />
            </span>
            {/* Only organizers need the API docs; visitors don't see the link. */}
            {admin && (
              <a href={`${process.env.PUBLIC_API_URL ?? process.env.API_URL ?? "http://localhost:4000"}/docs`} target="_blank" rel="noreferrer">
                เอกสาร API สำหรับเชื่อมเว็บอื่น
              </a>
            )}
          </div>
        </footer>
      </body>
    </html>
  );
}

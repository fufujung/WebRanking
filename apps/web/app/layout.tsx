import "@fontsource/ibm-plex-sans-thai/400.css";
import "@fontsource/ibm-plex-sans-thai/500.css";
import "@fontsource/ibm-plex-sans-thai/600.css";
import "@fontsource/ibm-plex-sans-thai/700.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./globals.css";
import "./public-ui.css";
import { NavigationLoadingProvider, NavigationContent } from "@/components/NavigationLoading";
import type { Metadata } from "next";
import Link from "@/components/LoadingLink";
import { cookies } from "next/headers";
import { isAdmin } from "@/lib/auth";
import { getMember } from "@/lib/member";
import { Brand } from "@/components/public/Brand";
import { PublicNavigation } from "@/components/public/PublicNavigation";
import { HeaderSearch } from "@/components/public/HeaderSearch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MobileHeader } from "@/components/MobileHeader";
import { WatchCoins } from "@/components/WatchCoins";
import { AdBanner, AdPopupSlot } from "@/components/ads/Ads";
import { HideOnAdmin } from "@/components/ads/HideOnAdmin";
import { DiscordJoin } from "@/components/DiscordJoin";
import { DiscordMark } from "@/components/DiscordMark";
import { siteSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: { default: "Tournament Ranking", template: "%s · Tournament Ranking" },
  description: "สถิติและอันดับของทีมและผู้เล่นในทัวร์นาเมนต์",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await isAdmin();
  const member = await getMember();
  const { discordInvite } = await siteSettings();
  const theme =
    (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="th" data-theme={theme === "light" ? "light" : undefined}>
      <body>
        <NavigationLoadingProvider>
        <a className="skip-link" href="#main-content">
          ข้ามไปยังเนื้อหา
        </a>
        <header className="header tr-header">
          <div className="container header-inner">
            <Brand />
            <PublicNavigation />
            <Link
              href="/me"
              className={`btn tr-login-link${member ? "" : " btn-discord"}`}
            >
              {member ? (
                <>
                  {member.avatar && (
                    <img src={member.avatar} alt="" width="24" height="24" />
                  )}
                  {member.name}
                </>
              ) : (
                <>
                  <DiscordMark />
                  เข้าสู่ระบบด้วย Discord
                </>
              )}
            </Link>
            {member && (
              <Link
                href="/me"
                className="tr-profile-link"
                aria-label="โปรไฟล์ของฉัน"
                title="โปรไฟล์ของฉัน"
              >
                {member.avatar ? (
                  <img src={member.avatar} alt="" width="24" height="24" />
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="8" r="4" />
                    <path d="M5 20a7 7 0 0 1 14 0" />
                  </svg>
                )}
              </Link>
            )}
            <div className="header-tools">
              <HeaderSearch />
              <DiscordJoin
                href={discordInvite}
                className="header-discord"
                label=""
              />
              <MobileHeader />
            </div>
          </div>
        </header>
        <main className="container" id="main-content">
          <HideOnAdmin>
            <AdBanner />
          </HideOnAdmin>
          <NavigationContent>{children}</NavigationContent>
        </main>
        <HideOnAdmin>
          <AdPopupSlot />
        </HideOnAdmin>
        {member && <WatchCoins />}
        <footer className="footer tr-footer">
          <div className="container row between">
            <span className="row" style={{ gap: 16 }}>
              <span className="tr-footer-brand">
                <Brand />
                <small>พื้นที่ของคนรักการแข่งขัน</small>
              </span>
              <Link href="/rankings">อันดับ</Link>
              <Link href="/tournaments">ทัวร์นาเมนต์</Link>
              <Link href="/teams">ทีมและผู้เล่น</Link>
              <Link href="/predict">ทายผล</Link>
              <Link href="/special">เล่นเก่งปากเก่ง</Link>
              <Link href="/blacklist">Blacklist</Link>
              {admin && <Link href="/admin">จัดการข้อมูล</Link>}
              <DiscordJoin href={discordInvite} className="btn-sm" />
              {/* <ThemeToggle initial={theme} /> Comment the theme switch part */}
            </span>
            {/* Only organizers need the API docs; visitors don't see the link. */}
            {admin && (
              <a
                href={`${process.env.PUBLIC_API_URL ?? process.env.API_URL ?? "http://localhost:4000"}/docs`}
                target="_blank"
                rel="noreferrer"
              >
                เอกสาร API สำหรับเชื่อมเว็บอื่น
              </a>
            )}
          </div>
        </footer>
      </NavigationLoadingProvider>
      </body>
    </html>
  );
}

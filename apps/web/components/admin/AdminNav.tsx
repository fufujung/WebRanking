"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icons";

const MAIN: { href: string; label: string; icon: IconName }[] = [
  { href: "/admin", label: "ภาพรวม", icon: "dashboard" },
  { href: "/admin/matches", label: "ผลการแข่ง", icon: "matches" },
  { href: "/admin/tournaments", label: "ทัวร์นาเมนต์", icon: "tournaments" },
  { href: "/admin/teams", label: "ทีม", icon: "teams" },
  { href: "/admin/guilds", label: "กิลด์", icon: "guild" },
  { href: "/admin/players", label: "ผู้เล่น", icon: "players" },
  { href: "/admin/reserve", label: "ตัวสำรอง เล่นเก่งปากเก่ง", icon: "flag" },
  { href: "/admin/seasons", label: "ซีซั่น เล่นเก่งปากเก่ง", icon: "calendar" },
  { href: "/admin/predict", label: "ทายผล · รางวัล", icon: "gift" },
  { href: "/admin/blacklist", label: "Blacklist", icon: "ban" },
  { href: "/admin/games", label: "เกม", icon: "game" },
  { href: "/admin/ads", label: "โฆษณาร้าน", icon: "megaphone" },
];

const MORE: { href: string; label: string; icon: IconName }[] = [
  { href: "/admin/keys", label: "API keys", icon: "key" },
  { href: "/rankings/players", label: "ดู Ranking หน้าเว็บ", icon: "ranking" },
];

/** The admin side menu. On phones it folds into a button. */
export function AdminNav({ badges }: { badges: Partial<Record<string, number>> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
  const item = (l: { href: string; label: string; icon: IconName }) => (
    <Link key={l.href} href={l.href} className={`side-link ${active(l.href) ? "side-link-active" : ""}`} aria-current={active(l.href) ? "page" : undefined}>
      <Icon name={l.icon} />
      <span className="grow">{l.label}</span>
      {badges[l.href] ? <span className="side-count">{badges[l.href]}</span> : null}
    </Link>
  );
  return (
    <>
      <button type="button" className="side-toggle btn" aria-expanded={open} aria-controls="admin-menu" onClick={() => setOpen((o) => !o)}>
        <Icon name="menu" /> เมนูหลังบ้าน
      </button>
      <nav id="admin-menu" className={`side-nav ${open ? "side-nav-open" : ""}`} aria-label="เมนูหลังบ้าน">
        <Link href="/admin/matches/new" className="btn btn-primary side-cta">
          <Icon name="plus" size={18} /> บันทึกผลการแข่ง
        </Link>
        <span className="side-heading">จัดการ</span>
        {MAIN.map(item)}
        <span className="side-heading">เชื่อมต่อ</span>
        {MORE.map(item)}
      </nav>
    </>
  );
}

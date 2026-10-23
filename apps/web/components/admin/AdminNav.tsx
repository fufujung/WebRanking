"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icons";

type Item = { href: string; label: string; icon: IconName };

/** The menu in groups, so each job is easy to find. */
const GROUPS: { heading: string; items: Item[] }[] = [
  {
    heading: "งานแข่ง",
    items: [
      { href: "/admin", label: "ภาพรวม", icon: "dashboard" },
      { href: "/admin/tournaments", label: "ทัวร์นาเมนต์", icon: "tournaments" },
      { href: "/admin/matches", label: "ผลการแข่ง", icon: "matches" },
    ],
  },
  {
    heading: "ทีมและผู้เล่น",
    items: [
      { href: "/admin/teams", label: "ทีม", icon: "teams" },
      { href: "/admin/players", label: "ผู้เล่น", icon: "players" },
      { href: "/admin/guilds", label: "กิลด์", icon: "guild" },
      { href: "/admin/blacklist", label: "Blacklist", icon: "ban" },
    ],
  },
  {
    heading: "เล่นเก่งปากเก่ง",
    items: [
      { href: "/admin/reserve", label: "ตัวสำรอง · สุ่มรายชื่อ", icon: "flag" },
      { href: "/admin/seasons", label: "ซีซั่น", icon: "calendar" },
    ],
  },
  {
    heading: "กิจกรรมคนดู",
    items: [
      { href: "/admin/predict", label: "ทายผล · รางวัล", icon: "gift" },
      { href: "/admin/draws", label: "Lucky Draw สุ่มแจกของ", icon: "dice" },
      { href: "/admin/ads", label: "โฆษณาร้าน", icon: "megaphone" },
    ],
  },
  {
    heading: "ระบบ",
    items: [
      { href: "/admin/games", label: "เกม", icon: "game" },
      { href: "/admin/trash", label: "ถังขยะ (กู้คืนทัวร์)", icon: "trash" },
      { href: "/admin/settings", label: "ตั้งค่าเว็บ · Discord", icon: "site" },
      { href: "/admin/keys", label: "API keys", icon: "key" },
      { href: "/rankings/players", label: "ดู Ranking หน้าเว็บ", icon: "ranking" },
    ],
  },
];

/** The admin side menu. On phones it folds into a button. */
export function AdminNav({ badges }: { badges: Partial<Record<string, number>> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
  const item = (l: Item) => (
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
        {GROUPS.map((g) => (
          <div key={g.heading} className="side-group">
            <span className="side-heading">{g.heading}</span>
            {g.items.map(item)}
          </div>
        ))}
      </nav>
    </>
  );
}

import Link from "next/link";

const TABS = [
  ["players", "/rankings/players", "ผู้เล่น (MMR)"],
  ["teams", "/rankings", "ทีม"],
  ["stats", "/rankings/stats", "สถิติผู้เล่น"],
] as const;

/** Switches between the three ranking pages. */
export function RankingTabs({ active }: { active: (typeof TABS)[number][0] }) {
  return (
    <nav className="ranking-tabs" aria-label="หน้า Ranking">
      {TABS.map(([key, href, label]) => (
        <Link key={key} href={href} className={key === active ? "active" : ""} aria-current={key === active ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

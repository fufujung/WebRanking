import Link from "@/components/LoadingLink";
import { qs } from "@/lib/api";

const TABS = [
  ["teams", "/rankings", "ทีม"],
  ["players", "/rankings/players", "ผู้เล่น (MMR)"],
  ["stats", "/rankings/stats", "สถิติผู้เล่น"],
] as const;

/** Switches between the three ranking pages. */
export function RankingTabs({ active, game, teamId }: { active: (typeof TABS)[number][0]; game?: string; teamId?: string }) {
  return (
    <nav className="ranking-tabs" aria-label="หน้า Ranking">
      {TABS.map(([key, href, label]) => (
        <Link key={key} href={`${href}${qs({ game, teamId: key === "teams" ? undefined : teamId })}`} className={key === active ? "active" : ""} aria-current={key === active ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

import Link from "next/link";
import { api, qs } from "@/lib/api";
import { STAT_KEYS, type Page, type Player, type PlayerStats, type Team } from "@/lib/types";
import { fmtRating, statLabels } from "@/lib/format";
import { Empty, PlayerLink, TeamLink } from "@/components/ui";
import { TeamFilter } from "@/components/TeamFilter";

export const metadata = { title: "Ranking ผู้เล่น" };

const SORTS = [
  ["pts", "แต้มรวม"],
  ["ppg", "แต้มเฉลี่ย"],
  ["avgRating", "เรตติ้งเฉลี่ย"],
  ["mvp", "MVP"],
  ["reb", "รีบาวด์"],
  ["ast", "แอสซิสต์"],
  ["blk", "บล็อก"],
  ["stl", "ขโมยบอล"],
  ["wins", "เกมที่ชนะ"],
  ["winRate", "% ชนะ"],
] as const;

type Row = Player & { rank: number; stats: PlayerStats };

export default async function PlayerRankings({ searchParams }: { searchParams: Promise<{ sort?: string; teamId?: string }> }) {
  const sp = await searchParams;
  const sort = SORTS.some(([k]) => k === sp.sort) ? sp.sort! : "pts";
  const [page, teams] = await Promise.all([
    api<Page<Row>>(`/rankings/players${qs({ sort, teamId: sp.teamId, minGames: 1, limit: 200 })}`),
    api<Page<Team>>("/teams?limit=200"),
  ]);
  const link = (s: string) => `/rankings/players${qs({ sort: s, teamId: sp.teamId })}`;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ranking ผู้เล่น</h1>
          <p className="muted small" style={{ margin: 0 }}>นับจากสกอร์บอร์ดทุกเกม เฉพาะผู้เล่นที่ลงแข่งอย่างน้อย 1 เกม</p>
        </div>
      </div>
      <div className="filters">
        <div className="tabs grow" style={{ alignSelf: "center" }}>
          {SORTS.map(([k, label]) => (
            <Link key={k} href={link(k)} className={`tab ${sort === k ? "tab-active" : ""}`}>{label}</Link>
          ))}
        </div>
        <div style={{ minWidth: 260 }}><TeamFilter teams={teams.data} /></div>
      </div>
      {page.data.length === 0 ? (
        <Empty>ยังไม่มีสถิติผู้เล่น</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>อันดับ</th><th>ผู้เล่น</th><th>ทีม</th><th className="num">เกม</th><th className="num">% ชนะ</th>
                <th className="num" title="เรตติ้งเฉลี่ย">เรตติ้ง</th><th className="num" title="แต้มเฉลี่ยต่อเกม">PPG</th>
                {STAT_KEYS.map((k) => <th key={k} className="num" title={statLabels[k].th}>{statLabels[k].short}</th>)}
                <th className="num">MVP</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((p) => (
                <tr key={p.id}>
                  <td className={`rank rank-${p.rank}`}>{p.rank}</td>
                  <td><PlayerLink player={p} /></td>
                  <td>{p.team ? <TeamLink team={p.team} /> : <span className="muted">-</span>}</td>
                  <td className="num">{p.stats.games}</td>
                  <td className="num">{p.stats.winRate}%</td>
                  <td className="num">{fmtRating(p.stats.avgRating)}</td>
                  <td className="num">{p.stats.ppg}</td>
                  {STAT_KEYS.map((k) => <td key={k} className="num">{sort === k ? <strong>{p.stats[k]}</strong> : p.stats[k]}</td>)}
                  <td className="num">{p.stats.mvp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

import Link from "next/link";
import { api, qs } from "@/lib/api";
import type { Page, Player, PlayerStats, Team } from "@/lib/types";
import { Empty, PlayerLink, TeamLink } from "@/components/ui";
import { TeamFilter } from "@/components/TeamFilter";

export const metadata = { title: "Ranking ผู้เล่น" };

const SORTS = [
  ["score", "คะแนนรวม"],
  ["kills", "Kills"],
  ["kda", "KDA"],
  ["avgScore", "คะแนนเฉลี่ย"],
  ["wins", "ชนะ"],
  ["winRate", "% ชนะ"],
  ["assists", "Assists"],
] as const;

type Row = Player & { rank: number; stats: PlayerStats };

export default async function PlayerRankings({ searchParams }: { searchParams: Promise<{ sort?: string; teamId?: string }> }) {
  const sp = await searchParams;
  const sort = SORTS.some(([k]) => k === sp.sort) ? sp.sort! : "score";
  const [page, teams] = await Promise.all([
    api<Page<Row>>(`/rankings/players${qs({ sort, teamId: sp.teamId, minMatches: 1, limit: 200 })}`),
    api<Page<Team>>("/teams?limit=200"),
  ]);
  const link = (s: string) => `/rankings/players${qs({ sort: s, teamId: sp.teamId })}`;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ranking ผู้เล่น</h1>
          <p className="muted small" style={{ margin: 0 }}>เฉพาะผู้เล่นที่มีสถิติอย่างน้อย 1 แมตช์</p>
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
                <th>อันดับ</th><th>ผู้เล่น</th><th>ทีม</th><th className="num">แข่ง</th><th className="num">K</th>
                <th className="num">D</th><th className="num">A</th><th className="num">KDA</th><th className="num">คะแนน</th>
                <th className="num">เฉลี่ย</th><th className="num">% ชนะ</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((p) => (
                <tr key={p.id}>
                  <td className={`rank rank-${p.rank}`}>{p.rank}</td>
                  <td><PlayerLink player={p} /></td>
                  <td>{p.team ? <TeamLink team={p.team} /> : <span className="muted">-</span>}</td>
                  <td className="num">{p.stats.matches}</td>
                  <td className="num">{p.stats.kills}</td>
                  <td className="num">{p.stats.deaths}</td>
                  <td className="num">{p.stats.assists}</td>
                  <td className="num"><strong>{p.stats.kda.toFixed(2)}</strong></td>
                  <td className="num">{p.stats.score}</td>
                  <td className="num">{p.stats.avgScore}</td>
                  <td className="num">{p.stats.winRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

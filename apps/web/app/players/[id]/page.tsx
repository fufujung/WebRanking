import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import type { PlayerDetail } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Avatar, Empty, Result, StatTile, TeamLink } from "@/components/ui";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await apiOrNull<PlayerDetail>(`/players/${encodeURIComponent((await params).id)}`);
  if (!p) notFound();
  const s = p.stats;
  return (
    <>
      <div className="page-head">
        <div className="row">
          <Avatar src={p.avatarUrl} name={p.name} size="lg" round />
          <div>
            <h1>{p.name}</h1>
            <span className="muted">{[p.nickname && `“${p.nickname}”`, p.role, p.country].filter(Boolean).join(" · ") || " "}</span>
          </div>
        </div>
        <div>{p.team ? <TeamLink team={p.team} /> : <span className="muted">ไม่มีสังกัด</span>}</div>
      </div>

      <div className="grid grid-4">
        <StatTile label="แข่ง" value={s.matches} />
        <StatTile label="KDA" value={s.kda.toFixed(2)} />
        <StatTile label="Kills / Deaths / Assists" value={`${s.kills} / ${s.deaths} / ${s.assists}`} />
        <StatTile label="คะแนนรวม (เฉลี่ย)" value={`${s.score} (${s.avgScore})`} />
        <StatTile label="ชนะ / แพ้ / เสมอ" value={`${s.wins} / ${s.losses} / ${s.draws}`} />
        <StatTile label="อัตราชนะ" value={`${s.winRate}%`} />
      </div>

      <h2 className="mt">สถิติรายแมตช์</h2>
      {p.recentMatches.length === 0 ? (
        <Empty>ยังไม่มีสถิติ</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>วันที่</th><th>ผล</th><th>ทีม</th><th>คู่แข่ง</th><th>รายการ</th><th className="num">K</th><th className="num">D</th><th className="num">A</th><th className="num">คะแนน</th></tr>
            </thead>
            <tbody>
              {p.recentMatches.map(({ match: m, team, kills, deaths, assists, score }) => {
                const opp = m.teamAId === team.id ? m.teamB : m.teamA;
                return (
                  <tr key={m.id}>
                    <td className="muted"><Link href={`/matches/${m.id}`}>{fmtDate(m.playedAt)}</Link></td>
                    <td><Result match={m} teamId={team.id} /></td>
                    <td><TeamLink team={team} /></td>
                    <td><TeamLink team={opp} /></td>
                    <td className="muted">{m.tournament.name}</td>
                    <td className="num">{kills}</td>
                    <td className="num">{deaths}</td>
                    <td className="num">{assists}</td>
                    <td className="num"><strong>{score}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

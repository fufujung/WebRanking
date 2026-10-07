import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import { STAT_KEYS, type PlayerDetail } from "@/lib/types";
import { fmtDate, fmtRating, statLabels } from "@/lib/format";
import { AwardBadge, Avatar, Empty, StatTile, TeamLink } from "@/components/ui";

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
        <StatTile label="เกม (ซีรีส์)" value={`${s.games} (${s.matches})`} />
        <StatTile label="ชนะ / แพ้ (เกม)" value={`${s.wins} / ${s.losses} · ${s.winRate}%`} />
        <StatTile label="เรตติ้งเฉลี่ย" value={fmtRating(s.avgRating)} />
        <StatTile label="MVP / SVP" value={`${s.mvp} / ${s.svp}`} />
        <StatTile label="แต้มรวม (เฉลี่ย/เกม)" value={`${s.pts} (${s.ppg})`} />
        <StatTile label="รีบาวด์ (เฉลี่ย/เกม)" value={`${s.reb} (${s.rpg})`} />
        <StatTile label="แอสซิสต์ (เฉลี่ย/เกม)" value={`${s.ast} (${s.apg})`} />
        <StatTile label="BLK / STL / LBR" value={`${s.blk} / ${s.stl} / ${s.lbr}`} />
      </div>

      <h2 className="mt">สถิติรายเกม</h2>
      {p.recentGames.length === 0 ? (
        <Empty>ยังไม่มีสถิติ</Empty>
      ) : (
        <div className="table-wrap">
          <table className="score-table">
            <thead>
              <tr>
                <th>วันที่</th><th>เกม</th><th>ผล</th><th>คู่แข่ง</th><th className="num">สกอร์</th><th className="num">เรตติ้ง</th>
                {STAT_KEYS.map((k) => <th key={k} className="num" title={statLabels[k].th}>{statLabels[k].short}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {p.recentGames.map((r) => {
                const m = r.match;
                const onA = m.teamAId === r.team.id;
                const opp = onA ? m.teamB : m.teamA;
                const own = onA ? r.game.scoreA : r.game.scoreB;
                const other = onA ? r.game.scoreB : r.game.scoreA;
                return (
                  <tr key={`${m.id}-${r.game.number}`}>
                    <td className="muted"><Link href={`/matches/${m.id}`}>{fmtDate(m.playedAt)}</Link></td>
                    <td className="muted">{r.game.number}</td>
                    <td>{own === other ? <span className="result-D">เสมอ</span> : own > other ? <span className="result-W">ชนะ</span> : <span className="result-L">แพ้</span>}</td>
                    <td><TeamLink team={opp} /></td>
                    <td className="num">{own} : {other}</td>
                    <td className="num">{fmtRating(r.rating)}</td>
                    {STAT_KEYS.map((k) => <td key={k} className="num">{k === "pts" ? <strong>{r[k]}</strong> : r[k]}</td>)}
                    <td>{r.award && <AwardBadge award={r.award} />}</td>
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

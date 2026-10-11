import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import type { TeamDetail } from "@/lib/types";
import { fmtDate, fmtRating } from "@/lib/format";
import { Avatar, Delta, Empty, PlayerLink, Result, StatTile, StatusBadge, TeamLink } from "@/components/ui";
import { Form, RankMove, TierBadge, TierEmblem, TierProgress } from "@/components/Tier";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const team = await apiOrNull<TeamDetail>(`/teams/${encodeURIComponent((await params).id)}`);
  if (!team) notFound();
  const s = team.stats;
  return (
    <>
      <div className="page-head">
        <div className="row">
          <Avatar src={team.logoUrl} name={team.tag || team.name} size="lg" />
          <div>
            <h1>{team.name}</h1>
            <span className="muted">{[team.tag, team.country].filter(Boolean).join(" · ") || " "}</span>
          </div>
        </div>
        <div className="row team-rank" style={{ ["--tier" as string]: team.tier.color }}>
          <TierEmblem tier={team.tier} size={64} />
          <div>
            <div className="stat-value">#{team.rank} <RankMove change={team.rankChange} isNew={team.form.length > 0} /></div>
            <div className="small"><strong>{team.rating} MMR</strong> · <span style={{ color: team.tier.color }}>{team.tier.name}</span></div>
            <TierProgress tier={team.tier} progress={team.tierProgress} toNext={team.toNextTier} compact />
            <div style={{ marginTop: 6 }}><Form results={team.form} /></div>
          </div>
        </div>
      </div>

      <div className="grid grid-4">
        <StatTile label="แข่ง" value={s.matches} />
        <StatTile label="ชนะ / แพ้ / เสมอ" value={`${s.wins} / ${s.losses} / ${s.draws}`} />
        <StatTile label="อัตราชนะ" value={`${s.winRate}%`} />
        <StatTile label="แชมป์ / ติดโพเดียม" value={`${s.titles ?? 0} / ${s.podiums ?? 0}`} />
      </div>

      <h2 className="mt">ผู้เล่นในทีม</h2>
      {team.players.length === 0 ? (
        <Empty>ยังไม่มีผู้เล่น</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>ผู้เล่น</th><th>แรงค์</th><th className="num">MMR</th><th>ตำแหน่ง</th><th className="num">เกม</th><th className="num">เรตติ้งเฉลี่ย</th><th className="num">แต้มเฉลี่ย</th><th className="num">REB / AST / BLK</th><th className="num">MVP</th></tr>
            </thead>
            <tbody>
              {team.players.map((p) => (
                <tr key={p.id}>
                  <td><PlayerLink player={p} /></td>
                  <td>{p.stats.games ? <TierBadge tier={p.tier} size={20} /> : <span className="muted">-</span>}</td>
                  <td className="num"><strong>{p.stats.games ? p.mmr : "-"}</strong></td>
                  <td className="muted">{p.role ?? "-"}</td>
                  <td className="num">{p.stats.games}</td>
                  <td className="num"><strong>{fmtRating(p.stats.avgRating)}</strong></td>
                  <td className="num">{p.stats.ppg}</td>
                  <td className="num">{p.stats.reb} / {p.stats.ast} / {p.stats.blk}</td>
                  <td className="num">{p.stats.mvp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-2 mt">
        <section>
          <h2>แมตช์ล่าสุด</h2>
          {team.recentMatches.length === 0 ? (
            <Empty>ยังไม่มีแมตช์</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>ผล</th><th>คู่แข่ง</th><th className="num">สกอร์</th><th className="num">MMR</th></tr></thead>
                <tbody>
                  {team.recentMatches.map((m) => {
                    const isA = m.teamAId === team.id;
                    const opp = isA ? m.teamB : m.teamA;
                    return (
                      <tr key={m.id}>
                        <td><Link href={`/matches/${m.id}`}><Result match={m} teamId={team.id} /></Link></td>
                        <td><TeamLink team={opp} /><div className="muted small">{m.tournament.name}</div></td>
                        <td className="num"><Link href={`/matches/${m.id}`}>{isA ? `${m.scoreA} : ${m.scoreB}` : `${m.scoreB} : ${m.scoreA}`}</Link></td>
                        <td className="num"><Delta value={isA ? m.ratingDeltaA : m.ratingDeltaB} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section>
          <h2>ทัวร์นาเมนต์</h2>
          {team.tournaments.length === 0 ? (
            <Empty>ยังไม่เคยลงแข่ง</Empty>
          ) : (
            <div className="stack">
              {team.tournaments.map(({ tournament: t, placement }) => (
                <Link key={t.id} href={`/tournaments/${t.id}`} className="card card-link row between">
                  <span><strong>{t.name}</strong><br /><span className="muted small">{fmtDate(t.startDate)}</span></span>
                  <span className="row">
                    {placement && <span className={`badge ${placement === 1 ? "badge-accent" : ""}`}>อันดับ {placement}</span>}
                    <StatusBadge status={t.status} />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

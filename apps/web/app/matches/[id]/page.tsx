import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import type { MatchDetail } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { Avatar, Delta, Empty, PlayerLink } from "@/components/ui";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const m = await apiOrNull<MatchDetail>(`/matches/${encodeURIComponent((await params).id)}`);
  if (!m) notFound();
  const admin = await isAdmin();
  const side = (teamId: string) => m.playerStats.filter((s) => s.teamId === teamId);
  const result = (id: string) => (m.winnerId === null ? "เสมอ" : m.winnerId === id ? "ชนะ" : "แพ้");

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <Link href={`/tournaments/${m.tournament.id}`} className="muted">← {m.tournament.name}{m.round ? ` · ${m.round}` : ""}</Link>
        {admin && <Link href={`/admin/matches/${m.id}`} className="btn btn-sm">แก้ไขผลการแข่ง</Link>}
      </div>
      <h1 className="sr-only">{m.teamA.name} vs {m.teamB.name}</h1>
      <div className="hero">
        <div className="match">
          <Link href={`/teams/${m.teamA.id}`} className="stack" style={{ alignItems: "center", gap: 8 }}>
            <Avatar src={m.teamA.logoUrl} name={m.teamA.tag || m.teamA.name} size="lg" />
            <strong>{m.teamA.name}</strong>
            <span className="small">{result(m.teamAId)} · <Delta value={m.ratingDeltaA} /></span>
          </Link>
          <div className="stack" style={{ alignItems: "center", gap: 6 }}>
            <span className="score" style={{ fontSize: 34 }}>{m.scoreA} : {m.scoreB}</span>
            <span className="muted small">{fmtDateTime(m.playedAt)}</span>
          </div>
          <Link href={`/teams/${m.teamB.id}`} className="stack" style={{ alignItems: "center", gap: 8 }}>
            <Avatar src={m.teamB.logoUrl} name={m.teamB.tag || m.teamB.name} size="lg" />
            <strong>{m.teamB.name}</strong>
            <span className="small">{result(m.teamBId)} · <Delta value={m.ratingDeltaB} /></span>
          </Link>
        </div>
      </div>
      {m.notes && <p className="card">{m.notes}</p>}

      <div className="grid grid-2 mt">
        {[m.teamA, m.teamB].map((team) => {
          const lines = side(team.id);
          return (
            <section key={team.id}>
              <h2>{team.name}</h2>
              {lines.length === 0 ? <Empty>ไม่มีสถิติผู้เล่น</Empty> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>ผู้เล่น</th><th className="num">K</th><th className="num">D</th><th className="num">A</th><th className="num">คะแนน</th></tr></thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.id}>
                          <td><PlayerLink player={l.player} /></td>
                          <td className="num">{l.kills}</td>
                          <td className="num">{l.deaths}</td>
                          <td className="num">{l.assists}</td>
                          <td className="num"><strong>{l.score}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {m.imageUrl && (
        <section className="mt">
          <h2>ภาพผลการแข่ง</h2>
          <a href={m.imageUrl} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="shot" src={m.imageUrl} alt="ภาพหน้าจอผลการแข่ง" />
          </a>
        </section>
      )}
    </>
  );
}

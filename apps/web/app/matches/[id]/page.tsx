import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import type { MatchDetail, MatchGame } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { Avatar, Delta, Empty } from "@/components/ui";
import { ScoreTable } from "@/components/ScoreTable";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const m = await apiOrNull<MatchDetail>(`/matches/${encodeURIComponent((await params).id)}`);
  if (!m) notFound();
  const admin = await isAdmin();
  const result = (id: string) => (m.winnerId === null ? "เสมอ" : m.winnerId === id ? "ชนะ" : "แพ้");
  const gameRows = (g: MatchGame, teamId: string) =>
    g.playerStats.filter((s) => s.teamId === teamId).map((s) => ({ ...s, key: s.id }));
  const totalRows = (teamId: string) =>
    m.players.filter((p) => p.teamId === teamId).map((p) => ({ ...p, key: p.player.id, rating: p.avgRating }));

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
            <span className="muted small">{m.games.length ? `${m.games.length} เกม · ` : ""}{fmtDateTime(m.playedAt)}</span>
            {m.source === "discord" && <span className="muted small">บันทึกจาก Discord</span>}
          </div>
          <Link href={`/teams/${m.teamB.id}`} className="stack" style={{ alignItems: "center", gap: 8 }}>
            <Avatar src={m.teamB.logoUrl} name={m.teamB.tag || m.teamB.name} size="lg" />
            <strong>{m.teamB.name}</strong>
            <span className="small">{result(m.teamBId)} · <Delta value={m.ratingDeltaB} /></span>
          </Link>
        </div>
      </div>
      {m.notes && <p className="card">{m.notes}</p>}

      {m.games.length === 0 ? (
        <Empty>ไม่มีรายละเอียดรายเกม</Empty>
      ) : (
        m.games.map((g) => (
          <section key={g.id} className="card game-card mt">
            <div className="game-head">
              <h2 style={{ margin: 0 }}>เกม {g.number}</h2>
              <span className="game-score">
                <span className={g.scoreA > g.scoreB ? "" : "muted"}>{m.teamA.name} {g.scoreA}</span>
                {" : "}
                <span className={g.scoreB > g.scoreA ? "" : "muted"}>{g.scoreB} {m.teamB.name}</span>
              </span>
            </div>
            <div className="grid grid-2">
              {[m.teamA, m.teamB].map((team) => {
                const rows = gameRows(g, team.id);
                return (
                  <div key={team.id}>
                    <h3 className="small" style={{ margin: "0 0 6px" }}>{team.name}</h3>
                    {rows.length ? <ScoreTable rows={rows} /> : <Empty>ไม่มีสถิติผู้เล่น</Empty>}
                  </div>
                );
              })}
            </div>
            {g.imageUrl && (
              <a href={g.imageUrl} target="_blank" rel="noreferrer" className="mt" style={{ display: "inline-block" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="game-shot game-shot-thumb" src={g.imageUrl} alt={`สกอร์บอร์ดเกม ${g.number}`} />
              </a>
            )}
          </section>
        ))
      )}

      {m.games.length > 1 && (
        <section className="mt">
          <h2>สถิติรวมทั้งซีรีส์</h2>
          <div className="grid grid-2">
            {[m.teamA, m.teamB].map((team) => (
              <div key={team.id}>
                <h3 className="small" style={{ margin: "0 0 6px" }}>{team.name}</h3>
                <ScoreTable rows={totalRows(team.id)} ratingLabel="เรตติ้งเฉลี่ย" />
              </div>
            ))}
          </div>
        </section>
      )}

      {m.imageUrl && (
        <section className="mt">
          <h2>ภาพเพิ่มเติม</h2>
          <a href={m.imageUrl} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="game-shot" src={m.imageUrl} alt="ภาพผลการแข่ง" />
          </a>
        </section>
      )}
    </>
  );
}

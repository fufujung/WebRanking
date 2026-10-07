import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import type { TournamentDetail } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Empty, MatchCard, StatusBadge, TeamLink } from "@/components/ui";

export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await apiOrNull<TournamentDetail>(`/tournaments/${encodeURIComponent((await params).id)}`);
  if (!t) notFound();
  const podium = t.teams.filter((x) => x.placement && x.placement <= 3);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 8 }}><StatusBadge status={t.status} /></div>
          <h1>{t.name}</h1>
          <span className="muted">
            {[t.game, t.location, `${fmtDate(t.startDate)}${t.endDate ? ` – ${fmtDate(t.endDate)}` : ""}`].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>
      {t.description && <p className="card">{t.description}</p>}

      {podium.length > 0 && (
        <div className="grid grid-3 mt">
          {podium.map((x) => (
            <div key={x.id} className="card row between">
              <TeamLink team={x} />
              <span className={`badge ${x.placement === 1 ? "badge-accent" : ""}`}>{x.placement === 1 ? "🏆 แชมป์" : `อันดับ ${x.placement}`}</span>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt">ตารางคะแนน</h2>
      <p className="muted small">ชนะ 3 แต้ม เสมอ 1 แต้ม เท่ากันดูผลต่างสกอร์</p>
      {t.standings.length === 0 ? (
        <Empty>ยังไม่มีทีมในรายการนี้</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>ทีม</th><th className="num">แข่ง</th><th className="num">ชนะ</th><th className="num">เสมอ</th><th className="num">แพ้</th><th className="num">ได้</th><th className="num">เสีย</th><th className="num">+/-</th><th className="num">แต้ม</th></tr>
            </thead>
            <tbody>
              {t.standings.map((s) => (
                <tr key={s.teamId}>
                  <td className={`rank rank-${s.position}`}>{s.position}</td>
                  <td>{s.team ? <TeamLink team={s.team} /> : "-"}</td>
                  <td className="num">{s.matches}</td>
                  <td className="num">{s.wins}</td>
                  <td className="num">{s.draws}</td>
                  <td className="num">{s.losses}</td>
                  <td className="num">{s.pointsFor}</td>
                  <td className="num">{s.pointsAgainst}</td>
                  <td className="num">{s.diff > 0 ? `+${s.diff}` : s.diff}</td>
                  <td className="num"><strong>{s.points}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt">แมตช์</h2>
      {t.matches.length === 0 ? <Empty>ยังไม่มีผลการแข่ง</Empty> : (
        <div className="grid grid-2">{t.matches.map((m) => <MatchCard key={m.id} match={m} />)}</div>
      )}
    </>
  );
}

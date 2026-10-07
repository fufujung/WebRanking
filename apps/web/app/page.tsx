import Link from "next/link";
import { api } from "@/lib/api";
import type { Overview } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Empty, MatchCard, StatTile, StatusBadge, TeamLink } from "@/components/ui";

export default async function Home() {
  const o = await api<Overview>("/stats/overview");
  return (
    <>
      <section className="hero">
        <h1>สถิติและ Ranking ทัวร์นาเมนต์</h1>
        <p className="muted">ติดตามอันดับทีม ผลการแข่ง และสถิติผู้เล่นทุกรายการในที่เดียว</p>
        <form action="/search" className="row" role="search" style={{ maxWidth: 560 }}>
          <input name="q" placeholder="ค้นหาทีม ผู้เล่น หรือทัวร์นาเมนต์" aria-label="ค้นหา" style={{ flex: 1 }} />
          <button className="btn btn-primary" type="submit">ค้นหา</button>
        </form>
      </section>

      <div className="grid grid-4">
        <StatTile label="ทีม" value={o.totals.teams} />
        <StatTile label="ผู้เล่น" value={o.totals.players} />
        <StatTile label="ทัวร์นาเมนต์" value={o.totals.tournaments} />
        <StatTile label="แมตช์" value={o.totals.matches} />
      </div>

      <div className="grid grid-2 mt">
        <section>
          <div className="row between">
            <h2>อันดับทีมสูงสุด</h2>
            <Link href="/rankings" className="small muted">ดูทั้งหมด →</Link>
          </div>
          {o.topTeams.length === 0 ? (
            <Empty>ยังไม่มีทีม</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>ทีม</th><th className="num">Rating</th></tr>
                </thead>
                <tbody>
                  {o.topTeams.map((t, i) => (
                    <tr key={t.id}>
                      <td className={`rank rank-${i + 1}`}>{i + 1}</td>
                      <td><TeamLink team={t} /></td>
                      <td className="num"><strong>{t.rating}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row between mt">
            <h2>ทัวร์นาเมนต์ที่กำลังแข่งและกำลังจะมา</h2>
            <Link href="/tournaments" className="small muted">ดูทั้งหมด →</Link>
          </div>
          <div className="stack">
            {o.upcomingTournaments.length === 0 && <Empty>ยังไม่มีรายการ</Empty>}
            {o.upcomingTournaments.map((t) => (
              <Link key={t.id} href={`/tournaments/${t.id}`} className="card card-link row between">
                <span>
                  <strong>{t.name}</strong>
                  <br />
                  <span className="muted small">{[t.game, t.location, fmtDate(t.startDate)].filter(Boolean).join(" · ")}</span>
                </span>
                <StatusBadge status={t.status} />
              </Link>
            ))}
          </div>
        </section>

        <section>
          <div className="row between">
            <h2>ผลการแข่งล่าสุด</h2>
            <Link href="/matches" className="small muted">ดูทั้งหมด →</Link>
          </div>
          <div className="stack">
            {o.recentMatches.length === 0 && <Empty>ยังไม่มีผลการแข่ง</Empty>}
            {o.recentMatches.map((m) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      </div>
    </>
  );
}

import Link from "next/link";
import { api, qs } from "@/lib/api";
import type { Player, Team, Tournament } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Empty, PlayerLink, StatusBadge, TeamLink } from "@/components/ui";

export const metadata = { title: "ค้นหา" };

type Results = { teams: Team[]; players: (Player & { team: { id: string; name: string } | null })[]; tournaments: Tournament[] };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim();
  const r = q ? await api<Results>(`/stats/search${qs({ q })}`) : { teams: [], players: [], tournaments: [] };
  const none = r.teams.length + r.players.length + r.tournaments.length === 0;
  return (
    <>
      <div className="page-head"><h1>ค้นหา</h1></div>
      <form className="row" role="search" style={{ marginBottom: 24 }}>
        <input name="q" defaultValue={q} placeholder="พิมพ์ชื่อทีม ผู้เล่น หรือทัวร์นาเมนต์" aria-label="คำค้นหา" style={{ flex: 1 }} autoFocus />
        <button className="btn btn-primary" type="submit">ค้นหา</button>
      </form>
      {!q && <Empty>พิมพ์คำที่ต้องการค้นหาแล้วกดปุ่มค้นหา</Empty>}
      {q && none && <Empty>ไม่พบผลลัพธ์สำหรับ “{q}”</Empty>}
      <div className="grid grid-3">
        {r.teams.length > 0 && (
          <section className="card stack">
            <h2>ทีม ({r.teams.length})</h2>
            {r.teams.map((t) => (
              <div key={t.id} className="row between"><TeamLink team={t} /><span className="muted small">{t.rating}</span></div>
            ))}
          </section>
        )}
        {r.players.length > 0 && (
          <section className="card stack">
            <h2>ผู้เล่น ({r.players.length})</h2>
            {r.players.map((p) => (
              <div key={p.id} className="row between"><PlayerLink player={p} /><span className="muted small">{p.team?.name ?? "ไม่มีสังกัด"}</span></div>
            ))}
          </section>
        )}
        {r.tournaments.length > 0 && (
          <section className="card stack">
            <h2>ทัวร์นาเมนต์ ({r.tournaments.length})</h2>
            {r.tournaments.map((t) => (
              <Link key={t.id} href={`/tournaments/${t.id}`} className="row between">
                <span>{t.name}<br /><span className="muted small">{fmtDate(t.startDate)}</span></span>
                <StatusBadge status={t.status} />
              </Link>
            ))}
          </section>
        )}
      </div>
    </>
  );
}

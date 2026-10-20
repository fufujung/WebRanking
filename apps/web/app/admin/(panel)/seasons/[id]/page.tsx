import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import { allGames } from "@/lib/games";
import type { SeasonView } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Avatar, Empty, StatusBadge } from "@/components/ui";
import { RemoveSeasonPlayer, SeasonForm, SeasonPaste } from "@/components/admin/SeasonAdmin";

export const metadata = { title: "จัดการซีซั่น" };

/** One season: its name and dates, the players allowed to play, and its events. */
export default async function AdminSeason({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const { id } = await params;
  const q = ((await searchParams).q ?? "").trim().toLowerCase();
  const season = await apiOrNull<SeasonView>(`/special/seasons/${encodeURIComponent(id)}`);
  if (!season) notFound();
  const games = await allGames();
  const players = season.players.filter((p) => !q || [p.name, p.nickname, p.uid].some((v) => v?.toLowerCase().includes(q)));
  return (
    <>
      <p className="small"><Link href="/admin/seasons">← ซีซั่นทั้งหมด</Link></p>
      <div className="dash-head">
        <div>
          <h1>{season.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {season.game ? `${season.game.name} · ` : ""}{fmtDate(season.startDate)} – {season.endDate ? fmtDate(season.endDate) : "ไม่กำหนด"} · ผู้เล่น {season.players.length} คน · ทัวร์ {season.tournaments.length} รายการ
          </p>
        </div>
        <Link className="btn" href={`/special?season=${season.id}`}>ดูหน้าเว็บ</Link>
      </div>
      <SeasonForm season={{ ...season, players: undefined, events: undefined }} games={games} />
      <SeasonPaste seasonId={season.id} />

      <h2>รายชื่อผู้เล่น ({season.players.length} คน)</h2>
      {season.players.length > 8 && (
        <form className="row" style={{ marginBottom: 12 }}>
          <input name="q" defaultValue={q} placeholder="ค้นหาชื่อหรือ UID" aria-label="ค้นหาชื่อหรือ UID" />
          <button className="btn">ค้นหา</button>
        </form>
      )}
      {players.length === 0 ? (
        <Empty>{season.players.length ? "ไม่พบรายชื่อ" : "ยังไม่มีผู้เล่นในซีซั่นนี้ วางรายชื่อด้านบน"}</Empty>
      ) : (
        <div className="table-wrap admin-table">
          <table>
            <thead>
              <tr><th>ผู้เล่น</th><th>UID</th><th className="num hide-sm">MMR พิเศษ</th><th className="hide-sm">เพิ่มเมื่อ</th><th /></tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/admin/players/${p.id}`} className="entity">
                      <Avatar src={p.avatarUrl} name={p.name} />
                      <span>{p.nickname || p.name}</span>
                    </Link>
                  </td>
                  <td className="small">{p.uid ?? "-"}</td>
                  <td className="num hide-sm">{p.specialMmr}</td>
                  <td className="small hide-sm">{fmtDate(p.addedAt)}</td>
                  <td><RemoveSeasonPlayer seasonId={season.id} playerId={p.id} name={p.nickname || p.name} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt">ทัวร์ในซีซั่นนี้</h2>
      {season.tournaments.length === 0 ? (
        <Empty>ยังไม่มีทัวร์ เลือกซีซั่นนี้ตอนสร้างทัวร์นาเมนต์ (ติ๊ก ⭐ รายการพิเศษ แล้วเลือกซีซั่น)</Empty>
      ) : (
        <ul className="stack">
          {season.tournaments.map((t) => (
            <li key={t.id} className="row between">
              <Link href={`/admin/tournaments/${t.id}`}>{t.name}</Link>
              <span className="row small"><StatusBadge status={t.status} /> {fmtDate(t.startDate)} · {t.matches} แมตช์</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

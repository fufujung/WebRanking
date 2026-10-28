import Link from "@/components/LoadingLink";
import { api, qs } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import type { Match, Page, Team, Tournament } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { Avatar, Empty, Pager, pageOffset } from "@/components/ui";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { ListHead } from "@/components/admin/ListParts";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "จัดการผลการแข่ง" };

const LIMIT = 30;

export default async function AdminMatches({ searchParams }: { searchParams: Promise<{ tournamentId?: string; teamId?: string; sort?: string; page?: string; deleted?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const offset = pageOffset(sp.page, LIMIT);
  const sort = sp.sort === "created" ? "created" : undefined;
  const [page, tournaments, teams] = await Promise.all([
    api<Page<Match>>(`/matches${qs({ tournamentId: sp.tournamentId, teamId: sp.teamId, sort, limit: LIMIT, offset })}`),
    fetchAll<Tournament>("/tournaments"),
    fetchAll<Team>("/teams"),
  ]);
  const filtered = Boolean(sp.tournamentId || sp.teamId);
  return (
    <>
      <ListHead title="ผลการแข่ง" sub={`${page.total} แมตช์${filtered ? "ที่ตรงกับตัวกรอง" : ""} · กดแก้ไขเพื่อเปลี่ยนสกอร์ สถิติ หรือรูปหลักฐาน`} action={{ href: "/admin/matches/new", label: "+ บันทึกผลการแข่ง" }} />
      {sp.deleted && <div className="success" style={{ marginBottom: 16 }}>ลบเรียบร้อยแล้ว</div>}
      <form className="list-bar list-filters" aria-label="กรองผลการแข่ง">
        <label>
          <span className="small muted">ทัวร์นาเมนต์</span>
          <select name="tournamentId" defaultValue={sp.tournamentId ?? ""}>
            <option value="">ทุกรายการ</option>
            {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>
          <span className="small muted">ทีม</span>
          <select name="teamId" defaultValue={sp.teamId ?? ""}>
            <option value="">ทุกทีม</option>
            {[...teams].sort((a, b) => a.name.localeCompare(b.name, "th")).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>
          <span className="small muted">เรียงตาม</span>
          <select name="sort" defaultValue={sort ?? ""}>
            <option value="">วันที่แข่ง</option>
            <option value="created">บันทึกล่าสุด</option>
          </select>
        </label>
        <button className="btn" type="submit">กรอง</button>
        {(filtered || sort) && <Link className="btn btn-sm" href="/admin/matches">ล้าง</Link>}
      </form>
      {page.data.length === 0 ? (
        <Empty>{filtered ? "ไม่พบแมตช์ตามตัวกรอง" : "ยังไม่มีผลการแข่ง กด + บันทึกผลการแข่ง เพื่อเริ่ม"}</Empty>
      ) : (
        <div className="table-wrap admin-table">
          <table>
            <thead>
              <tr><th className="hide-sm">วันที่แข่ง</th><th>คู่แข่ง</th><th className="num">สกอร์</th><th className="hide-sm">รายการ</th><th className="hide-sm">ที่มา</th><th /></tr>
            </thead>
            <tbody>
              {page.data.map((m) => (
                <tr key={m.id}>
                  <td className="hide-sm muted nowrap">{fmtDateTime(m.playedAt)}</td>
                  <td>
                    <div className="vs-cell">
                      <span className={`entity ${m.winnerId === m.teamA.id ? "winner" : "loser"}`}><Avatar src={m.teamA.logoUrl} name={m.teamA.tag || m.teamA.name} />{m.teamA.name}</span>
                      <span className="muted small">vs</span>
                      <span className={`entity ${m.winnerId === m.teamB.id ? "winner" : "loser"}`}><Avatar src={m.teamB.logoUrl} name={m.teamB.tag || m.teamB.name} />{m.teamB.name}</span>
                    </div>
                  </td>
                  <td className="num"><span className="score-chip">{m.scoreA} : {m.scoreB}</span></td>
                  <td className="hide-sm">
                    <Link href={`/admin/tournaments/${m.tournament.id}`}>{m.tournament.name}</Link>
                    {m.round && <div className="muted small">{m.round}</div>}
                  </td>
                  <td className="hide-sm">{m.source === "discord" ? <span className="pill pill-info">Discord</span> : <span className="pill">เว็บ</span>}</td>
                  <td className="right">
                    <span className="row-actions">
                      <Link className="btn btn-sm" href={`/admin/matches/${m.id}`}>แก้ไข</Link>
                      <DeleteButton kind="matches" id={m.id} label={`แมตช์ ${m.teamA.name} vs ${m.teamB.name}`} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager total={page.total} limit={LIMIT} offset={offset} params={{ tournamentId: sp.tournamentId, teamId: sp.teamId, sort }} path="/admin/matches" />
    </>
  );
}

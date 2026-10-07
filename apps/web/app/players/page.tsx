import { api, qs } from "@/lib/api";
import type { Page, Player, Team } from "@/lib/types";
import { Empty, Pager, PlayerLink, TeamLink, pageOffset } from "@/components/ui";
import { TeamFilter } from "@/components/TeamFilter";

export const metadata = { title: "ผู้เล่น" };
const LIMIT = 50;

export default async function PlayersPage({ searchParams }: { searchParams: Promise<{ q?: string; teamId?: string; page?: string }> }) {
  const sp = await searchParams;
  const offset = pageOffset(sp.page, LIMIT);
  const [page, teams] = await Promise.all([
    api<Page<Player>>(`/players${qs({ search: sp.q, teamId: sp.teamId, limit: LIMIT, offset })}`),
    api<Page<Team>>("/teams?limit=200"),
  ]);
  return (
    <>
      <div className="page-head"><h1>ผู้เล่นทั้งหมด</h1><span className="muted">{page.total} คน</span></div>
      <div className="filters">
        <form className="row grow" role="search">
          {sp.teamId && <input type="hidden" name="teamId" value={sp.teamId} />}
          <input name="q" defaultValue={sp.q} placeholder="ค้นหาชื่อหรือชื่อเล่นผู้เล่น" aria-label="ค้นหาผู้เล่น" style={{ flex: 1 }} />
          <button className="btn btn-primary" type="submit">ค้นหา</button>
        </form>
        <div style={{ minWidth: 260 }}><TeamFilter teams={teams.data} /></div>
      </div>
      {page.data.length === 0 ? (
        <Empty>ไม่พบผู้เล่น</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>ผู้เล่น</th><th>ทีม</th><th>ตำแหน่ง</th><th>ประเทศ</th></tr></thead>
            <tbody>
              {page.data.map((p) => (
                <tr key={p.id}>
                  <td><PlayerLink player={p} /></td>
                  <td>{p.team ? <TeamLink team={p.team} /> : <span className="muted">ไม่มีสังกัด</span>}</td>
                  <td className="muted">{p.role ?? "-"}</td>
                  <td className="muted">{p.country ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager total={page.total} limit={LIMIT} offset={offset} params={sp} path="/players" />
    </>
  );
}

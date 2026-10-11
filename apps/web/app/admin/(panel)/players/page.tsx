import Link from "next/link";
import { fetchAll } from "@/lib/fetchAll";
import type { Player } from "@/lib/types";
import { Avatar, Empty, Pager, pageOffset } from "@/components/ui";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { FilterTabs, ListHead, ListSearch, href } from "@/components/admin/ListParts";

export const metadata = { title: "จัดการผู้เล่น" };

const LIMIT = 50;
const SHOWS = ["nouid", "noteam"] as const;

export default async function AdminPlayers({ searchParams }: { searchParams: Promise<{ q?: string; show?: string; page?: string; deleted?: string }> }) {
  const sp = await searchParams;
  const players = (await fetchAll<Player>("/players")).sort((a, b) => a.name.localeCompare(b.name, "th"));
  const q = (sp.q ?? "").trim().toLowerCase();
  const show = (SHOWS as readonly string[]).includes(sp.show ?? "") ? (sp.show as (typeof SHOWS)[number]) : "all";
  const groups = {
    all: players,
    nouid: players.filter((p) => !p.uid),
    noteam: players.filter((p) => !p.teamId),
  };
  const rows = groups[show].filter(
    (p) => !q || [p.name, p.nickname, p.uid, p.team?.name].some((v) => v?.toLowerCase().includes(q)),
  );
  const offset = pageOffset(sp.page, LIMIT);
  const keep = show === "all" ? undefined : show;
  return (
    <>
      <ListHead title="ผู้เล่น" sub={`${players.length} คน · ใส่ UID ไว้ แล้วเปลี่ยนชื่อในเกมได้โดยสถิติไม่หาย`} action={{ href: "/admin/players/new", label: "+ เพิ่มผู้เล่น" }} />
      {sp.deleted && <div className="success" style={{ marginBottom: 16 }}>ลบเรียบร้อยแล้ว</div>}
      <div className="list-bar">
        <FilterTabs
          label="กรองผู้เล่น"
          active={show}
          tabs={[
            { key: "all", label: "ทั้งหมด", count: groups.all.length, href: href("/admin/players", { q: sp.q }) },
            { key: "nouid", label: "ยังไม่มี UID", count: groups.nouid.length, href: href("/admin/players", { q: sp.q, show: "nouid" }) },
            { key: "noteam", label: "ไม่มีสังกัด", count: groups.noteam.length, href: href("/admin/players", { q: sp.q, show: "noteam" }) },
          ]}
        />
        <ListSearch q={sp.q} placeholder="ค้นหาชื่อ UID หรือทีม" keep={{ show: keep }} />
      </div>
      {rows.length === 0 ? (
        <Empty>{players.length === 0 ? "ยังไม่มีผู้เล่น กด + เพิ่มผู้เล่น เพื่อเริ่ม" : "ไม่พบผู้เล่น"}</Empty>
      ) : (
        <div className="table-wrap admin-table">
          <table>
            <thead>
              <tr><th>ผู้เล่น</th><th>UID</th><th className="hide-sm">ทีม</th><th className="num">MMR</th><th /></tr>
            </thead>
            <tbody>
              {rows.slice(offset, offset + LIMIT).map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/admin/players/${p.id}`} className="entity">
                      <Avatar src={p.avatarUrl} name={p.name} round />
                      <span>
                        <strong>{p.name}</strong>
                        {p.nickname && <span className="muted small"> “{p.nickname}”</span>}
                      </span>
                    </Link>
                  </td>
                  <td>
                    {p.uid ? <span className="mono">{p.uid}{p.server ? <span className="muted small"> · {p.server}</span> : null}</span> : <Link href={`/admin/players/${p.id}`} className="pill pill-warn">ใส่ UID</Link>}
                  </td>
                  <td className="hide-sm">{p.team ? <Link href={`/admin/teams/${p.team.id}`}>{p.team.name}</Link> : <span className="muted">ไม่มีสังกัด</span>}</td>
                  <td className="num"><strong>{p.mmr ?? "-"}</strong></td>
                  <td className="right">
                    <span className="row-actions">
                      <Link className="btn btn-sm" href={`/admin/players/${p.id}`}>แก้ไข</Link>
                      <DeleteButton kind="players" id={p.id} label={`ผู้เล่น ${p.name} (สถิติรายแมตช์จะถูกลบด้วย)`} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager total={rows.length} limit={LIMIT} offset={offset} params={{ q: sp.q, show: keep }} path="/admin/players" />
    </>
  );
}

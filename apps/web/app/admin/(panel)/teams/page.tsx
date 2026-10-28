import Link from "@/components/LoadingLink";
import { fetchAll } from "@/lib/fetchAll";
import type { Team } from "@/lib/types";
import { Avatar, Empty, Pager, pageOffset } from "@/components/ui";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { FilterTabs, ListHead, ListSearch, href } from "@/components/admin/ListParts";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "จัดการทีม" };

const LIMIT = 50;

export default async function AdminTeams({ searchParams }: { searchParams: Promise<{ q?: string; show?: string; page?: string; deleted?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const teams = (await fetchAll<Team>("/teams")).sort((a, b) => a.name.localeCompare(b.name, "th"));
  const q = (sp.q ?? "").trim().toLowerCase();
  const show = sp.show === "nologo" || sp.show === "empty" ? sp.show : "all";
  const groups = {
    all: teams,
    nologo: teams.filter((t) => !t.logoUrl),
    empty: teams.filter((t) => !t.playerCount),
  };
  const rows = groups[show].filter((t) => !q || t.name.toLowerCase().includes(q) || t.tag?.toLowerCase().includes(q));
  const offset = pageOffset(sp.page, LIMIT);
  return (
    <>
      <ListHead title="ทีม" sub={`${teams.length} ทีม · กดชื่อเพื่อแก้ไข เปลี่ยนโลโก้ หรือเพิ่มผู้เล่น`} action={{ href: "/admin/teams/new", label: "+ เพิ่มทีม" }} />
      {sp.deleted && <div className="success" style={{ marginBottom: 16 }}>ลบเรียบร้อยแล้ว</div>}
      <div className="list-bar">
        <FilterTabs
          label="กรองทีม"
          active={show}
          tabs={[
            { key: "all", label: "ทั้งหมด", count: groups.all.length, href: href("/admin/teams", { q: sp.q }) },
            { key: "nologo", label: "ยังไม่มีโลโก้", count: groups.nologo.length, href: href("/admin/teams", { q: sp.q, show: "nologo" }) },
            { key: "empty", label: "ยังไม่มีผู้เล่น", count: groups.empty.length, href: href("/admin/teams", { q: sp.q, show: "empty" }) },
          ]}
        />
        <ListSearch q={sp.q} placeholder="ค้นหาชื่อทีมหรือตัวย่อ" keep={{ show: show === "all" ? undefined : show }} />
      </div>
      {rows.length === 0 ? (
        <Empty>{teams.length === 0 ? "ยังไม่มีทีม กด + เพิ่มทีม เพื่อเริ่ม" : "ไม่พบทีม"}</Empty>
      ) : (
        <div className="table-wrap admin-table">
          <table>
            <thead>
              <tr><th>ทีม</th><th className="hide-sm">ตัวย่อ</th><th className="num">ผู้เล่น</th><th className="num">MMR</th><th className="hide-sm">โลโก้</th><th /></tr>
            </thead>
            <tbody>
              {rows.slice(offset, offset + LIMIT).map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/admin/teams/${t.id}`} className="entity">
                      <Avatar src={t.logoUrl} name={t.tag || t.name} />
                      <strong>{t.name}</strong>
                    </Link>
                  </td>
                  <td className="hide-sm muted">{t.tag ?? "-"}</td>
                  <td className="num">{t.playerCount ?? 0}</td>
                  <td className="num"><strong>{t.rating}</strong></td>
                  <td className="hide-sm">{t.logoUrl ? <span className="pill pill-ok">มีแล้ว</span> : <Link href={`/admin/teams/${t.id}`} className="pill pill-warn">ใส่โลโก้</Link>}</td>
                  <td className="right">
                    <span className="row-actions">
                      <Link className="btn btn-sm" href={`/admin/teams/${t.id}`}>แก้ไข</Link>
                      <DeleteButton kind="teams" id={t.id} label={`ทีม ${t.name} (แมตช์ของทีมนี้จะถูกลบด้วย)`} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager total={rows.length} limit={LIMIT} offset={offset} params={{ q: sp.q, show: show === "all" ? undefined : show }} path="/admin/teams" />
    </>
  );
}

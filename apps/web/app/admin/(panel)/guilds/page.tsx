import Link from "next/link";
import { fetchAll } from "@/lib/fetchAll";
import type { GuildListItem } from "@/lib/types";
import { Avatar, Empty, Pager, pageOffset } from "@/components/ui";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { FilterTabs, ListHead, ListSearch, href } from "@/components/admin/ListParts";

export const metadata = { title: "จัดการกิลด์" };

const LIMIT = 50;

export default async function AdminGuilds({ searchParams }: { searchParams: Promise<{ q?: string; show?: string; page?: string; deleted?: string }> }) {
  const sp = await searchParams;
  const guilds = await fetchAll<GuildListItem>("/guilds");
  const q = (sp.q ?? "").trim().toLowerCase();
  const show = sp.show === "full" || sp.show === "noleader" ? sp.show : "all";
  const groups = {
    all: guilds,
    full: guilds.filter((g) => g.memberCount >= g.capacity),
    noleader: guilds.filter((g) => !g.leader),
  };
  const rows = groups[show].filter((g) => !q || g.name.toLowerCase().includes(q) || g.tag?.toLowerCase().includes(q));
  const offset = pageOffset(sp.page, LIMIT);
  return (
    <>
      <ListHead title="กิลด์" sub={`${guilds.length} กิลด์ · ผู้เล่นสร้างกิลด์เองที่หน้าโปรไฟล์ ที่นี่เปลี่ยนหัวหน้า เพิ่มจำนวนรับ หรือลบได้`} />
      {sp.deleted && <div className="success" style={{ marginBottom: 16 }}>ลบเรียบร้อยแล้ว</div>}
      <div className="list-bar">
        <FilterTabs
          label="กรองกิลด์"
          active={show}
          tabs={[
            { key: "all", label: "ทั้งหมด", count: groups.all.length, href: href("/admin/guilds", { q: sp.q }) },
            { key: "full", label: "เต็มแล้ว", count: groups.full.length, href: href("/admin/guilds", { q: sp.q, show: "full" }) },
            { key: "noleader", label: "ไม่มีหัวหน้า", count: groups.noleader.length, href: href("/admin/guilds", { q: sp.q, show: "noleader" }) },
          ]}
        />
        <ListSearch q={sp.q} placeholder="ค้นหาชื่อกิลด์หรือตัวย่อ" keep={{ show: show === "all" ? undefined : show }} />
      </div>
      {rows.length === 0 ? (
        <Empty>{guilds.length === 0 ? "ยังไม่มีกิลด์ ผู้เล่นสร้างได้ที่หน้าโปรไฟล์ของฉัน" : "ไม่พบกิลด์"}</Empty>
      ) : (
        <div className="table-wrap admin-table">
          <table>
            <thead>
              <tr><th>กิลด์</th><th>หัวหน้า</th><th className="num">สมาชิก</th><th className="hide-sm">อันดับ 1</th><th /></tr>
            </thead>
            <tbody>
              {rows.slice(offset, offset + LIMIT).map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link href={`/admin/guilds/${g.id}`} className="entity">
                      <Avatar src={g.logoUrl} name={g.tag || g.name} />
                      <strong>{g.name}</strong>
                    </Link>
                  </td>
                  <td>{g.leader ? `👑 ${g.leader.name}` : <span className="pill pill-warn">ไม่มี</span>}</td>
                  <td className="num"><strong>{g.memberCount}</strong> / {g.capacity}</td>
                  <td className="hide-sm">{g.top ? `${g.top.name} (${g.top.mmr})` : <span className="muted">-</span>}</td>
                  <td className="right">
                    <span className="row-actions">
                      <Link className="btn btn-sm" href={`/admin/guilds/${g.id}`}>แก้ไข</Link>
                      <DeleteButton kind="guilds" id={g.id} label={`กิลด์ ${g.name} (สมาชิกจะไม่มีกิลด์ แต่ข้อมูลผู้เล่นยังอยู่)`} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager total={rows.length} limit={LIMIT} offset={offset} params={{ q: sp.q, show: show === "all" ? undefined : show }} path="/admin/guilds" />
    </>
  );
}

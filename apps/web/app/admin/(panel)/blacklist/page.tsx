import Link from "next/link";
import { api } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import type { BlacklistEntry, Player } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { Avatar, Empty } from "@/components/ui";
import { FilterTabs, ListHead, ListSearch, href } from "@/components/admin/ListParts";
import { AddBlacklist, BlacklistActions } from "@/components/admin/BlacklistAdmin";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "จัดการ Blacklist" };

export default async function AdminBlacklist({ searchParams }: { searchParams: Promise<{ q?: string; show?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const show = sp.show === "lifted" || sp.show === "all" ? sp.show : "active";
  const [{ data }, players] = await Promise.all([api<{ data: BlacklistEntry[] }>("/blacklist?status=all&limit=500"), fetchAll<Player>("/players")]);
  const groups = { active: data.filter((e) => !e.liftedAt), lifted: data.filter((e) => e.liftedAt), all: data };
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = groups[show].filter((e) => !q || [e.player.name, e.player.nickname, e.player.uid, e.teamName, e.tournament?.name, e.reason].some((v) => v?.toLowerCase().includes(q)));
  const options = players.map((p) => ({ id: p.id, name: p.name, tag: [p.team?.name, p.uid && `UID ${p.uid}`].filter(Boolean).join(" · ") || null, logoUrl: p.avatarUrl }));
  return (
    <>
      <ListHead
        title="Blacklist"
        sub="ทีมที่แพ้บายเพราะไม่มาเช็คอินทันเวลา ผู้เล่นทุกคนในทีมติด Blacklist และหัก 20 MMR เอง ถ้าผู้จัดเปลี่ยนผลหรือยกเลิกผล รายชื่อจะหายเอง กดยกเลิกโทษเพื่อคืน MMR"
      />
      <div className="list-bar">
        <FilterTabs
          label="กรอง Blacklist"
          active={show}
          tabs={[
            { key: "active", label: "มีผลอยู่", count: groups.active.length, href: href("/admin/blacklist", { q: sp.q }) },
            { key: "lifted", label: "ยกเลิกโทษแล้ว", count: groups.lifted.length, href: href("/admin/blacklist", { q: sp.q, show: "lifted" }) },
            { key: "all", label: "ทั้งหมด", count: groups.all.length, href: href("/admin/blacklist", { q: sp.q, show: "all" }) },
          ]}
        />
        <ListSearch q={sp.q} placeholder="ค้นหาผู้เล่น UID ทีม หรือทัวร์" keep={{ show: show === "active" ? undefined : show }} />
      </div>
      {rows.length === 0 ? (
        <Empty>{data.length === 0 ? "ยังไม่มีใครติด Blacklist" : "ไม่พบรายการ"}</Empty>
      ) : (
        <div className="table-wrap admin-table">
          <table>
            <thead>
              <tr><th>ผู้เล่น</th><th>สาเหตุ</th><th className="num">โทษ</th><th className="hide-sm">เมื่อ</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/admin/players/${e.player.id}`} className="entity">
                      <Avatar src={e.player.avatarUrl} name={e.player.name} />
                      <span>
                        <strong>{e.player.name}</strong>
                        {e.teamName && <><br /><span className="muted small">ทีม {e.teamName}</span></>}
                      </span>
                    </Link>
                  </td>
                  <td className="small">
                    {e.reason}
                    {e.tournament && <span className="muted"><br />{e.tournament.name}{e.matchNumber ? ` · M${e.matchNumber}` : ""}</span>}
                    {e.source === "ADMIN" && <span className="muted"><br />ผู้จัดเพิ่มเอง</span>}
                    {e.liftedAt && <span className="muted"><br />ยกเลิกโทษ {fmtDateTime(e.liftedAt)}{e.liftNote ? `: ${e.liftNote}` : ""}</span>}
                  </td>
                  <td className="num">{e.liftedAt ? <span className="pill">คืนแล้ว</span> : <span className="pill pill-danger">-{e.penalty}</span>}</td>
                  <td className="hide-sm muted small">{fmtDateTime(e.createdAt)}</td>
                  <td className="right"><BlacklistActions entry={e} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt"><AddBlacklist players={options} /></div>
    </>
  );
}

import Link from "next/link";
import { fetchAll } from "@/lib/fetchAll";
import type { Status, Tournament } from "@/lib/types";
import { fmtDate, formatLabel, statusLabel } from "@/lib/format";
import { Empty, StatusBadge } from "@/components/ui";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { FilterTabs, ListHead, ListSearch, href } from "@/components/admin/ListParts";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "จัดการทัวร์นาเมนต์" };

const ORDER: Record<Status, number> = { ONGOING: 0, UPCOMING: 1, COMPLETED: 2 };
const STATUSES: Status[] = ["ONGOING", "UPCOMING", "COMPLETED"];
const BRACKET: Record<string, string> = { DRAFT: "จัดสายแล้ว ยังไม่เริ่ม", LIVE: "สายกำลังแข่ง", DONE: "สายจบแล้ว" };

export default async function AdminTournaments({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; deleted?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const all = (await fetchAll<Tournament>("/tournaments")).sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || b.startDate.localeCompare(a.startDate),
  );
  const status = STATUSES.find((s) => s === sp.status);
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = all.filter((t) => (!status || t.status === status) && (!q || t.name.toLowerCase().includes(q) || t.game?.toLowerCase().includes(q)));
  return (
    <>
      <ListHead title="ทัวร์นาเมนต์" sub={`${all.length} รายการ · จัดสาย เปิดรับสมัคร และบันทึกผลจากที่นี่`} action={{ href: "/admin/tournaments/new", label: "+ สร้างทัวร์นาเมนต์" }} />
      {sp.deleted && <div className="success" style={{ marginBottom: 16 }}>ลบเรียบร้อยแล้ว</div>}
      <div className="list-bar">
        <FilterTabs
          label="สถานะทัวร์นาเมนต์"
          active={status ?? "all"}
          tabs={[
            { key: "all", label: "ทั้งหมด", count: all.length, href: href("/admin/tournaments", { q: sp.q }) },
            ...STATUSES.map((s) => ({ key: s, label: statusLabel[s], count: all.filter((t) => t.status === s).length, href: href("/admin/tournaments", { q: sp.q, status: s }) })),
          ]}
        />
        <ListSearch q={sp.q} placeholder="ค้นหาชื่อรายการหรือเกม" keep={{ status }} />
      </div>
      {rows.length === 0 ? (
        <Empty>{all.length === 0 ? "ยังไม่มีทัวร์นาเมนต์ กด + สร้างทัวร์นาเมนต์ เพื่อเริ่ม" : "ไม่พบรายการ"}</Empty>
      ) : (
        <div className="table-wrap admin-table">
          <table>
            <thead>
              <tr><th>รายการ</th><th>สถานะ</th><th className="hide-sm">รูปแบบ</th><th className="num">ทีม</th><th className="num hide-sm">แมตช์</th><th className="hide-sm">เริ่ม</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/admin/tournaments/${t.id}`}><strong>{t.name}</strong></Link>
                    <div className="muted small">{[t.game, t.location].filter(Boolean).join(" · ") || " "}</div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <StatusBadge status={t.status} />
                      {t.registrationOpen && <span className="pill pill-ok">เปิดรับสมัคร</span>}
                    </div>
                  </td>
                  <td className="hide-sm">
                    {t.format ? formatLabel[t.format] : <span className="muted">บันทึกผลอิสระ</span>}
                    {t.format && BRACKET[t.bracketStatus] && <div className="muted small">{BRACKET[t.bracketStatus]}</div>}
                  </td>
                  <td className="num">{t.teamCount ?? 0}{t.maxTeams ? <span className="muted">/{t.maxTeams}</span> : null}</td>
                  <td className="num hide-sm">{t.matchCount ?? 0}</td>
                  <td className="hide-sm muted nowrap">{fmtDate(t.startDate)}</td>
                  <td className="right">
                    <span className="row-actions">
                      <Link className="btn btn-sm btn-primary" href={`/admin/matches/new?tournamentId=${t.id}`}>บันทึกผล</Link>
                      <Link className="btn btn-sm" href={`/admin/tournaments/${t.id}`}>จัดการ</Link>
                      <DeleteButton kind="tournaments" id={t.id} label={`ทัวร์นาเมนต์ ${t.name} (แมตช์ทั้งหมดในรายการจะถูกลบด้วย)`} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

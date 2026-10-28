import Link from "@/components/LoadingLink";
import { api, PUBLIC, qs } from "@/lib/api";
import type { Overview, Page, Tournament } from "@/lib/types";
import { CommunityTotals } from "@/components/public/CommunityTotals";
import { fmtThaiTime, formatLabel, statusLabel } from "@/lib/format";
import { registrationLabel } from "@/lib/tournamentWorkflow";
import { Empty, Pager, StatusBadge, pageOffset } from "@/components/ui";

export const metadata = { title: "ทัวร์นาเมนต์" };
const LIMIT = 24;

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const sp = await searchParams;
  const status = sp.status && sp.status in statusLabel ? sp.status : undefined;
  const offset = pageOffset(sp.page, LIMIT);
  const [page, overview] = await Promise.all([
    api<Page<Tournament>>(`/tournaments${qs({ search: sp.q, status, category: "normal", limit: LIMIT, offset })}`, PUBLIC),
    api<Overview>("/stats/overview", PUBLIC).catch(() => null),
  ]);
  return (
    <div className="public-page-flow">
      <div className="page-head"><div><h1>ทัวร์นาเมนต์</h1><p className="muted">ค้นหารายการ ดูการรับสมัคร ตารางแข่ง และผลการแข่งขัน</p></div><span className="muted">{page.total} รายการ</span></div>
      <CommunityTotals totals={overview?.totals ?? null} />
      <p className="small">รายการพิเศษและ MMR แยก ดูที่ <Link href="/special">เล่นเก่ง ปากเก่ง</Link></p>
      <form className="filters" role="search">
        <input className="grow" name="q" defaultValue={sp.q} placeholder="ค้นหาชื่อรายการ เกม หรือสถานที่" aria-label="ค้นหาทัวร์นาเมนต์" />
        <select name="status" defaultValue={status ?? ""} aria-label="สถานะ" style={{ width: 200 }}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn btn-primary" type="submit" style={{ minWidth: 0 }}>ค้นหา</button>
      </form>
      {page.data.length === 0 ? (
        <Empty>{sp.q || status ? "ไม่พบรายการที่ตรงกับตัวกรอง" : "ยังไม่มีทัวร์นาเมนต์"}{(sp.q || status) && <p><Link href="/tournaments">ล้างตัวกรองและดูทุกรายการ</Link></p>}</Empty>
      ) : (
        <div className="grid grid-3">
          {page.data.map((t) => (
            <Link key={t.id} href={`/tournaments/${t.id}`} className="card card-link tournament-card">
              <div className="row between"><StatusBadge status={t.status} /><span className="muted small">{registrationLabel(t, t.teamCount ?? 0)}</span></div>
              <h2>{t.name}</h2>
              <span className="muted small">{[t.game, t.location].filter(Boolean).join(" · ") || "ไม่ระบุเกมหรือสถานที่"}</span>
              <span className="small">{fmtThaiTime(t.startDate)} (ไทย)</span>
              <span className="muted small">{t.format ? formatLabel[t.format] : "ไม่ใช้สายการแข่งขัน"} · {t.entryMode === "SOLO" ? "ลงเดี่ยว / สุ่มทีม" : "สมัครเป็นทีม"}</span>
              <span className="tournament-card-bottom">{t.teamCount ?? 0}{t.maxTeams != null ? ` / ${t.maxTeams}` : ""} ทีม · {t.matchCount ?? 0} แมตช์ <span>ดูรายการ</span></span>
            </Link>
          ))}
        </div>
      )}
      <Pager total={page.total} limit={LIMIT} offset={offset} params={sp} path="/tournaments" />
    </div>
  );
}

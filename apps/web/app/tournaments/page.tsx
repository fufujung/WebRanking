import Link from "next/link";
import { api, qs } from "@/lib/api";
import type { Page, Tournament } from "@/lib/types";
import { fmtDate, statusLabel } from "@/lib/format";
import { Empty, Pager, StatusBadge, pageOffset } from "@/components/ui";

export const metadata = { title: "ทัวร์นาเมนต์" };
const LIMIT = 24;

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const sp = await searchParams;
  const status = sp.status && sp.status in statusLabel ? sp.status : undefined;
  const offset = pageOffset(sp.page, LIMIT);
  const page = await api<Page<Tournament>>(`/tournaments${qs({ search: sp.q, status, limit: LIMIT, offset })}`);
  return (
    <>
      <div className="page-head"><h1>ทัวร์นาเมนต์</h1><span className="muted">{page.total} รายการ</span></div>
      <form className="filters" role="search">
        <input className="grow" name="q" defaultValue={sp.q} placeholder="ค้นหาชื่อรายการ เกม หรือสถานที่" aria-label="ค้นหาทัวร์นาเมนต์" />
        <select name="status" defaultValue={status ?? ""} aria-label="สถานะ" style={{ width: 200 }}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn btn-primary" type="submit" style={{ minWidth: 0 }}>ค้นหา</button>
      </form>
      {page.data.length === 0 ? (
        <Empty>ไม่พบทัวร์นาเมนต์</Empty>
      ) : (
        <div className="grid grid-3">
          {page.data.map((t) => (
            <Link key={t.id} href={`/tournaments/${t.id}`} className="card card-link stack" style={{ gap: 8 }}>
              <div className="row between"><StatusBadge status={t.status} /><span className="muted small">{fmtDate(t.startDate)}</span></div>
              <strong style={{ fontSize: 17 }}>{t.name}</strong>
              <span className="muted small">{[t.game, t.location].filter(Boolean).join(" · ") || " "}</span>
              <span className="muted small">{t.teamCount ?? 0} ทีม · {t.matchCount ?? 0} แมตช์</span>
            </Link>
          ))}
        </div>
      )}
      <Pager total={page.total} limit={LIMIT} offset={offset} params={sp} path="/tournaments" />
    </>
  );
}

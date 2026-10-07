import Link from "next/link";
import { api, qs } from "@/lib/api";
import type { Page, Team } from "@/lib/types";
import { Avatar, Empty, Pager, pageOffset } from "@/components/ui";

export const metadata = { title: "ทีม" };
const LIMIT = 24;

export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const offset = pageOffset(sp.page, LIMIT);
  const page = await api<Page<Team>>(`/teams${qs({ search: sp.q, limit: LIMIT, offset })}`);
  return (
    <>
      <div className="page-head"><h1>ทีมทั้งหมด</h1><span className="muted">{page.total} ทีม</span></div>
      <form className="filters" role="search">
        <input className="grow" name="q" defaultValue={sp.q} placeholder="ค้นหาชื่อทีมหรือตัวย่อ" aria-label="ค้นหาทีม" />
        <button className="btn btn-primary" type="submit" style={{ minWidth: 0 }}>ค้นหา</button>
      </form>
      {page.data.length === 0 ? (
        <Empty>ไม่พบทีม{sp.q ? ` “${sp.q}”` : ""}</Empty>
      ) : (
        <div className="grid grid-3">
          {page.data.map((t) => (
            <Link key={t.id} href={`/teams/${t.id}`} className="card card-link row">
              <Avatar src={t.logoUrl} name={t.tag || t.name} size="lg" />
              <span>
                <strong>{t.name}</strong> {t.tag && <span className="muted small">[{t.tag}]</span>}
                <br />
                <span className="muted small">Rating {t.rating} · {t.playerCount ?? 0} ผู้เล่น{t.country ? ` · ${t.country}` : ""}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
      <Pager total={page.total} limit={LIMIT} offset={offset} params={sp} path="/teams" />
    </>
  );
}

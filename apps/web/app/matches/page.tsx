import { api, qs } from "@/lib/api";
import type { Match, Page, Team } from "@/lib/types";
import { Empty, MatchCard, Pager, pageOffset } from "@/components/ui";
import { TeamFilter } from "@/components/TeamFilter";

export const metadata = { title: "ผลการแข่ง" };
const LIMIT = 30;

export default async function MatchesPage({ searchParams }: { searchParams: Promise<{ teamId?: string; page?: string }> }) {
  const sp = await searchParams;
  const offset = pageOffset(sp.page, LIMIT);
  const [page, teams] = await Promise.all([
    api<Page<Match>>(`/matches${qs({ teamId: sp.teamId, limit: LIMIT, offset })}`),
    api<Page<Team>>("/teams?limit=200"),
  ]);
  return (
    <>
      <div className="page-head"><h1>ผลการแข่ง</h1><span className="muted">{page.total} แมตช์</span></div>
      <div className="filters"><div style={{ minWidth: 300 }}><TeamFilter teams={teams.data} placeholder="ทุกทีม (พิมพ์เพื่อหาทีม)" /></div></div>
      {page.data.length === 0 ? <Empty>ยังไม่มีผลการแข่ง</Empty> : (
        <div className="grid grid-2">{page.data.map((m) => <MatchCard key={m.id} match={m} />)}</div>
      )}
      <Pager total={page.total} limit={LIMIT} offset={offset} params={sp} path="/matches" />
    </>
  );
}

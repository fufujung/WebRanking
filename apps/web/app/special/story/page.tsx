import Link from "@/components/LoadingLink";
import { api, qs } from "@/lib/api";
import type { SpecialSeason, Story } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Empty, StatusBadge } from "@/components/ui";
import { StoryList } from "@/components/Stories";
import type { Status } from "@/lib/types";

export const metadata = { title: "ต้นเรื่อง · เล่นเก่งปากเก่ง" };

interface StoryEvent {
  id: string;
  name: string;
  startDate: string;
  status: Status;
  season: { id: string; name: string } | null;
  stories: Story[];
}

/** ต้นเรื่อง: the Facebook posts behind each "เล่นเก่งปากเก่ง" event, for anyone who wants to follow the story. */
export default async function StoryPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const sp = await searchParams;
  const [{ data: seasons }, { data: events, seasons: seasonStories = [] }] = await Promise.all([
    api<{ data: SpecialSeason[] }>("/special/seasons"),
    api<{ data: StoryEvent[]; seasons?: { id: string; name: string; stories: Story[] }[] }>(`/special/stories${qs({ seasonId: sp.season })}`),
  ]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>ต้นเรื่อง</h1>
          <p className="muted">ที่มาของแต่ละรายการ เรียงตามลำดับโพสต์ กดอ่านต่อใน Facebook · <Link href={`/special${qs({ season: sp.season })}`}>กลับหน้าเล่นเก่งปากเก่ง</Link></p>
        </div>
      </div>
      {seasons.length > 0 && (
        <nav className="tabs filter-tabs season-tabs" aria-label="เลือกซีซั่น">
          <Link href="/special/story" className={`tab ${sp.season ? "" : "tab-active"}`}>ทุกซีซั่น</Link>
          {seasons.map((x) => (
            <Link key={x.id} href={`/special/story?season=${x.id}`} className={`tab ${x.id === sp.season ? "tab-active" : ""}`}>{x.name}</Link>
          ))}
        </nav>
      )}
      {seasonStories.map((x) => (
        <section key={x.id} className="mt card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}><Link href={`/special?season=${x.id}`}>{x.name}</Link></h2>
            <span className="muted small">ต้นเรื่องของทั้งซีซั่น</span>
          </div>
          <StoryList stories={x.stories} />
        </section>
      ))}
      {events.length === 0 && seasonStories.length === 0 ? (
        <Empty>ยังไม่มีต้นเรื่อง</Empty>
      ) : (
        events.map((e) => (
          <section key={e.id} className="mt card stack">
            <div className="row between">
              <h2 style={{ margin: 0 }}><Link href={`/tournaments/${e.id}`}>{e.name}</Link></h2>
              <span className="row small"><StatusBadge status={e.status} /><span className="muted">{fmtDate(e.startDate)}{e.season ? ` · ${e.season.name}` : ""}</span></span>
            </div>
            <StoryList stories={e.stories} />
          </section>
        ))
      )}
    </>
  );
}

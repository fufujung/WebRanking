import Link from "next/link";
import { api, qs } from "@/lib/api";
import type { Page, Team, TeamStats } from "@/lib/types";
import { Empty, TeamLink } from "@/components/ui";

export const metadata = { title: "Ranking ทีม" };

type Row = Team & { rank: number; stats: TeamStats };

export default async function TeamRankings({ searchParams }: { searchParams: Promise<{ min?: string; q?: string }> }) {
  const sp = await searchParams;
  const min = sp.min === "1" ? 1 : 0;
  const q = (sp.q ?? "").trim().toLowerCase();
  const page = await api<Page<Row>>(`/rankings/teams${qs({ limit: 200, minMatches: min })}`);
  const rows = q ? page.data.filter((t) => t.name.toLowerCase().includes(q) || t.tag?.toLowerCase().includes(q)) : page.data;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ranking ทีม</h1>
          <p className="muted small" style={{ margin: 0 }}>เรียงตาม Elo rating (เริ่มที่ 1000) คำนวณจากผลการแข่งทุกนัด</p>
        </div>
        <div className="tabs">
          <Link className={`tab ${min === 0 ? "tab-active" : ""}`} href="/rankings">ทุกทีม</Link>
          <Link className={`tab ${min === 1 ? "tab-active" : ""}`} href="/rankings?min=1">เฉพาะทีมที่ลงแข่งแล้ว</Link>
        </div>
      </div>
      <form className="filters" role="search">
        {min === 1 && <input type="hidden" name="min" value="1" />}
        <input className="grow" name="q" defaultValue={sp.q} placeholder="ค้นหาทีมในตาราง" aria-label="ค้นหาทีม" />
        <button className="btn btn-primary" type="submit" style={{ minWidth: 0 }}>ค้นหา</button>
      </form>
      {rows.length === 0 ? (
        <Empty>ไม่พบทีม</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>อันดับ</th><th>ทีม</th><th className="num">Rating</th><th className="num">แข่ง</th>
                <th className="num">ชนะ</th><th className="num">แพ้</th><th className="num">เสมอ</th>
                <th className="num">% ชนะ</th><th className="num">แชมป์</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className={`rank rank-${t.rank}`}>{t.rank}</td>
                  <td><TeamLink team={t} /></td>
                  <td className="num"><strong>{t.rating}</strong></td>
                  <td className="num">{t.stats.matches}</td>
                  <td className="num">{t.stats.wins}</td>
                  <td className="num">{t.stats.losses}</td>
                  <td className="num">{t.stats.draws}</td>
                  <td className="num">{t.stats.winRate}%</td>
                  <td className="num">{t.stats.titles ? `🏆 ${t.stats.titles}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

import Link from "next/link";
import { api, qs } from "@/lib/api";
import type { Movement, Page, Team, TeamStats } from "@/lib/types";
import { signed } from "@/lib/format";
import { Avatar, Empty, TeamLink } from "@/components/ui";
import { Form, RankMove, TierBadge, TierEmblem, TierProgress } from "@/components/Tier";
import { RankingTabs } from "@/components/RankingTabs";

export const metadata = { title: "Ranking ทีม" };

type Row = Team & Movement & { rank: number; stats: TeamStats };

export default async function TeamRankings({ searchParams }: { searchParams: Promise<{ min?: string; q?: string }> }) {
  const sp = await searchParams;
  const min = sp.min === "1" ? 1 : 0;
  const q = (sp.q ?? "").trim().toLowerCase();
  const page = await api<Page<Row>>(`/rankings/teams${qs({ limit: 200, minMatches: min })}`);
  const rows = q ? page.data.filter((t) => t.name.toLowerCase().includes(q) || t.tag?.toLowerCase().includes(q)) : page.data;
  const podium = q ? [] : rows.filter((t) => t.stats.matches > 0).slice(0, 3);
  const rest = rows.filter((t) => !podium.includes(t));
  return (
    <>
      <RankingTabs active="teams" />
      <div className="page-head">
        <div>
          <h1>Ranking ทีม</h1>
          <p className="muted small" style={{ margin: 0 }}>เรียงตาม MMR ทีม (เริ่มที่ 1000) คำนวณใหม่จากผลการแข่งทุกนัด ▲▼ คืออันดับที่ขยับใน 7 วันล่าสุด</p>
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
        <>
          {podium.length > 0 && (
            <div className="podium">
              {[podium[1], podium[0], podium[2]].filter(Boolean).map((t) => (
                <Link key={t.id} href={`/teams/${t.id}`} className={`podium-card podium-${t.rank}`} style={{ ["--tier" as string]: t.tier.color }}>
                  <span className="podium-rank">{t.rank === 1 ? "👑" : `#${t.rank}`}</span>
                  <div className="podium-avatar">
                    <Avatar src={t.logoUrl} name={t.tag || t.name} size="lg" />
                    <span className="podium-emblem"><TierEmblem tier={t.tier} size={t.rank === 1 ? 52 : 44} /></span>
                  </div>
                  <strong className="podium-name">{t.name}</strong>
                  <span className="muted small podium-team">{t.stats.wins}-{t.stats.losses} · ชนะ {t.stats.winRate}%{t.stats.titles ? ` · 🏆 ${t.stats.titles}` : ""}</span>
                  <span className="podium-mmr">{t.rating}<small>MMR</small></span>
                  <span className="podium-tier">{t.tier.name}</span>
                  <div className="row podium-meta">
                    <Form results={t.form} />
                    <RankMove change={t.rankChange} isNew={t.form.length > 0} />
                  </div>
                </Link>
              ))}
            </div>
          )}
          {rest.length > 0 && (
            <div className="table-wrap ladder-table">
              <table>
                <thead>
                  <tr>
                    <th>อันดับ</th><th>ทีม</th><th>แรงค์</th><th className="num">MMR</th><th className="hide-sm">ฟอร์ม</th>
                    <th className="num">แข่ง</th><th className="num">ชนะ-แพ้-เสมอ</th>
                    <th className="num hide-sm">% ชนะ</th><th className="num hide-sm">ล่าสุด</th><th className="num">แชมป์</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((t) => (
                    <tr key={t.id} style={{ ["--tier" as string]: t.tier.color }}>
                      <td>
                        <div className="rank-cell">
                          <span className={`rank rank-${t.rank}`}>{t.rank}</span>
                          <RankMove change={t.rankChange} isNew={t.form.length > 0} />
                        </div>
                      </td>
                      <td><TeamLink team={t} /></td>
                      <td><TierBadge tier={t.tier} /></td>
                      <td className="num">
                        <strong className="mmr-num">{t.rating}</strong>
                        <TierProgress tier={t.tier} progress={t.tierProgress} toNext={t.toNextTier} compact />
                      </td>
                      <td className="hide-sm"><Form results={t.form} /></td>
                      <td className="num">{t.stats.matches}</td>
                      <td className="num">{t.stats.wins}-{t.stats.losses}-{t.stats.draws}</td>
                      <td className="num hide-sm">{t.stats.winRate}%</td>
                      <td className="num hide-sm">{t.lastDelta === null ? "-" : <span className={t.lastDelta >= 0 ? "delta-up" : "delta-down"}>{signed(t.lastDelta)}</span>}</td>
                      <td className="num">{t.stats.titles ? `🏆 ${t.stats.titles}` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

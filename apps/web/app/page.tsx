import Link from "next/link";
import { api } from "@/lib/api";
import type { GuildListItem, Overview, Page } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Avatar, Empty, MatchCard, PlayerLink, StatTile, StatusBadge, TeamLink } from "@/components/ui";
import { RankMove, TierBadge, TierEmblem } from "@/components/Tier";
import { AdCards } from "@/components/ads/Ads";

export default async function Home() {
  const [o, guilds] = await Promise.all([api<Overview>("/stats/overview"), api<Page<GuildListItem>>("/guilds?limit=1")]);
  const topGuild = guilds.data[0]?.rank === 1 ? guilds.data[0] : null;
  return (
    <>
      <section className="hero">
        <h1>สถิติและ Ranking ทัวร์นาเมนต์</h1>
        <p className="muted">ติดตามอันดับทีม ผลการแข่ง และสถิติผู้เล่นทุกรายการในที่เดียว</p>
        <form action="/search" className="row" role="search" style={{ maxWidth: 560 }}>
          <input name="q" placeholder="ค้นหาทีม ผู้เล่น หรือทัวร์นาเมนต์" aria-label="ค้นหา" style={{ flex: 1 }} />
          <button className="btn btn-primary" type="submit">ค้นหา</button>
        </form>
      </section>

      <div className="grid grid-4">
        <StatTile label="ทีม" value={o.totals.teams} />
        <StatTile label="ผู้เล่น" value={o.totals.players} />
        <StatTile label="ทัวร์นาเมนต์" value={o.totals.tournaments} />
        <StatTile label="แมตช์" value={o.totals.matches} />
      </div>

      <TopGuild guild={topGuild} />

      <AdCards />

      <div className="grid grid-2 mt">
        <section>
          <div className="row between">
            <h2>อันดับทีมสูงสุด</h2>
            <Link href="/rankings" className="small muted">ดูทั้งหมด →</Link>
          </div>
          {o.topTeams.length === 0 ? (
            <Empty>ยังไม่มีทีม</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>ทีม</th><th className="num">MMR</th></tr>
                </thead>
                <tbody>
                  {o.topTeams.map((t, i) => (
                    <tr key={t.id}>
                      <td className={`rank rank-${i + 1}`}>{i + 1}</td>
                      <td><TeamLink team={t} /></td>
                      <td className="num"><strong>{t.rating}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row between mt">
            <h2>ผู้เล่น MMR สูงสุด</h2>
            <Link href="/rankings/players" className="small muted">ดูทั้งหมด →</Link>
          </div>
          {o.topPlayers.length === 0 ? (
            <Empty>ยังไม่มีผู้เล่นติดอันดับ</Empty>
          ) : (
            <div className="table-wrap ladder-table">
              <table>
                <thead>
                  <tr><th>#</th><th>ผู้เล่น</th><th>แรงค์</th><th className="num">MMR</th></tr>
                </thead>
                <tbody>
                  {o.topPlayers.map((p) => (
                    <tr key={p.id} style={{ ["--tier" as string]: p.tier.color }}>
                      <td><span className={`rank rank-${p.rank}`}>{p.rank}</span> <RankMove change={p.rankChange} isNew /></td>
                      <td><PlayerLink player={p} /></td>
                      <td><TierBadge tier={p.tier} size={20} /></td>
                      <td className="num"><strong>{p.mmr}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row between mt">
            <h2>ทัวร์นาเมนต์ที่กำลังแข่งและกำลังจะมา</h2>
            <Link href="/tournaments" className="small muted">ดูทั้งหมด →</Link>
          </div>
          <div className="stack">
            {o.upcomingTournaments.length === 0 && <Empty>ยังไม่มีรายการ</Empty>}
            {o.upcomingTournaments.map((t) => (
              <Link key={t.id} href={`/tournaments/${t.id}`} className="card card-link row between">
                <span>
                  <strong>{t.name}</strong>
                  <br />
                  <span className="muted small">{[t.game, t.location, fmtDate(t.startDate)].filter(Boolean).join(" · ")}</span>
                </span>
                <StatusBadge status={t.status} />
              </Link>
            ))}
          </div>
        </section>

        <section>
          <div className="row between">
            <h2>ผลการแข่งล่าสุด</h2>
            <Link href="/matches" className="small muted">ดูทั้งหมด →</Link>
          </div>
          <div className="stack">
            {o.recentMatches.length === 0 && <Empty>ยังไม่มีผลการแข่ง</Empty>}
            {o.recentMatches.map((m) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      </div>
    </>
  );
}

/** The number 1 guild, always on the home page, with the best player inside it. */
function TopGuild({ guild: g }: { guild: GuildListItem | null }) {
  return (
    <section className="mt">
      <div className="row between">
        <h2>🏆 กิลด์อันดับ 1</h2>
        <Link href="/guilds" className="small muted">ดูอันดับกิลด์ทั้งหมด →</Link>
      </div>
      {!g ? (
        <Empty>ยังไม่มีกิลด์ที่สมาชิกลงแข่ง สร้างกิลด์ได้ที่หน้าโปรไฟล์ของฉัน</Empty>
      ) : (
        <div className="home-guild card">
          <Link href={`/guilds/${g.id}`} className="home-guild-main">
            <Avatar src={g.logoUrl} name={g.tag || g.name} size="lg" />
            <span>
              <strong className="home-guild-name">{g.name}</strong> {g.tag && <span className="muted">[{g.tag}]</span>}
              <br />
              <span className="muted small">คะแนนกิลด์ <strong className="home-guild-score">{g.score}</strong> · {g.memberCount} สมาชิก</span>
            </span>
          </Link>
          {g.top && (
            <Link href={`/players/${g.top.id}`} className="home-guild-top" style={{ ["--tier" as string]: g.top.tier.color }}>
              <TierEmblem tier={g.top.tier} size={48} />
              <span>
                <span className="muted small">🥇 อันดับ 1 ของกิลด์</span>
                <br />
                <strong>{g.top.nickname || g.top.name}</strong>
                <br />
                <span className="small">{g.top.mmr} MMR · <span style={{ color: g.top.tier.color }}>{g.top.tier.name}</span></span>
              </span>
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

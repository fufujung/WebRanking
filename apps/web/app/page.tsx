import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import Image from "next/image";
import { api, PUBLIC } from "@/lib/api";
import type {
  Overview,
  Page,
  Team,
  TeamStats,
  SpecialSeason,
} from "@/lib/types";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Avatar, Empty, StatusBadge, TeamLink } from "@/components/ui";
import { HomeFilters } from "@/components/public/HomeFilters";
import { allGames } from "@/lib/games";

type RankedTeam = Team & { rank: number; stats: TeamStats };
const number = (value: number) => value.toLocaleString("en-US");

export default async function Home() {
  const [overviewResult, rankingsResult, games, seasonsResult] =
    await Promise.allSettled([
      api<Overview>("/stats/overview", PUBLIC),
      api<Page<RankedTeam>>("/rankings/teams?limit=5", PUBLIC),
      allGames(),
      api<{ data: SpecialSeason[] }>("/special/seasons", PUBLIC),
    ]);
  const o = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  const teams =
    rankingsResult.status === "fulfilled" ? rankingsResult.value.data : null;
  const seasons =
    seasonsResult.status === "fulfilled" ? seasonsResult.value.data : [];
  return (
    <div className="tr-home">
      <LiveRefresh />
      <section id="home" className="tr-hero" aria-labelledby="home-title">
        <Image
          src="/images/hero-kagami.png"
          alt=""
          fill
          preload
          sizes="(max-width: 760px) 1200px, 1264px"
          className="tr-hero-art"
        />
        <div className="tr-hero-shade" />
        <div className="tr-hero-copy">
          <p className="tr-eyebrow">YOUR GAME. YOUR LEGACY.</p>
          <h1 id="home-title">
            THE GAME.
            <br />
            <span>THE RANKING.</span>
          </h1>
          <p className="tr-hero-description">
            เช็คอันดับ ติดตามทัวร์นาเมนต์ <strong>powered by OVERTIME</strong>
          </p>
          <div className="tr-hero-actions">
            <Link href="/rankings" className="btn btn-primary">
              สำรวจอันดับ <span aria-hidden="true">→</span>
            </Link>
            <Link href="/tournaments" className="btn">
              ดูทัวร์นาเมนต์
            </Link>
          </div>
        </div>
        <span className="tr-hero-caption">
          THE RANKING · OVERTIME COMMUNITY
        </span>
      </section>
      <HomeFilters
        games={games.status === "fulfilled" ? games.value : []}
        seasons={seasons}
      />
      {!o && (
        <div className="notice tr-data-error" role="status">
          ยังโหลดข้อมูลการแข่งขันไม่ได้ กรุณาลองใหม่อีกครั้ง{" "}
          <Link href="/">โหลดใหม่ →</Link>
        </div>
      )}
      <div id="overview" className="tr-metrics">
        {(
          [
            ["ทีมทั้งหมด", o?.totals.teams, "ทีม", "users"],
            ["ผู้เล่นทั้งหมด", o?.totals.players, "คน", "user"],
            ["แมตช์ที่แข่งขัน", o?.totals.matches, "แมตช์", "ball"],
            ["ทัวร์นาเมนต์", o?.totals.tournaments, "รายการ", "trophy"],
          ] as const
        ).map(([label, value, unit, icon]) => (
          <div className="tr-metric" key={label}>
            <span className="tr-metric-icon">
              <img
                src={`/images/icons/${icon}.svg`}
                width="24"
                height="24"
                alt=""
              />
            </span>
            <div>
              <span className="muted">{label}</span>
              <p>
                <strong>{value === undefined ? "—" : number(value)}</strong>
                <span>{unit}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="tr-home-columns">
        <section id="rankings" aria-labelledby="ranking-title">
          <div className="tr-section-head">
            <div>
              <h2 id="ranking-title">อันดับทีม</h2>
              <p>TEAM RANKING</p>
            </div>
            <div className="tr-ranking-tabs">
              <span aria-current="true">ทั้งหมด</span>
              <Link href="/rankings/players">อันดับผู้เล่น</Link>
            </div>
          </div>
          {!teams ? (
            <Empty>ยังโหลดอันดับทีมไม่ได้</Empty>
          ) : teams.length === 0 ? (
            <Empty>ยังไม่มีทีมติดอันดับ</Empty>
          ) : (
            <div className="table-wrap tr-ranking-table">
              <table>
                <caption className="sr-only">อันดับทีมตามคะแนน MMR</caption>
                <thead>
                  <tr>
                    <th>อันดับ</th>
                    <th>ทีม</th>
                    <th className="num">MMR</th>
                    <th className="num tr-hide-phone">ชนะ</th>
                    <th className="num tr-hide-phone">แพ้</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t) => (
                    <tr key={t.id}>
                      <td className="tr-rank-number">
                        {String(t.rank).padStart(2, "0")}
                      </td>
                      <td>
                        <TeamLink team={t} />
                      </td>
                      <td className="num tr-rating">{number(t.rating)}</td>
                      <td className="num tr-hide-phone">{t.stats.wins}</td>
                      <td className="num tr-hide-phone">{t.stats.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Link className="tr-panel-link" href="/rankings">
                ดูอันดับทีมทั้งหมด <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
        </section>
        <section id="results" aria-labelledby="results-title">
          <div className="tr-section-head">
            <div>
              <h2 id="results-title">ผลการแข่งขันล่าสุด</h2>
              <p>LATEST RESULTS</p>
            </div>
            <Link href="/matches">
              ดูทั้งหมด <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="tr-results">
            {!o ? (
              <Empty>ยังโหลดผลการแข่งขันไม่ได้</Empty>
            ) : o.recentMatches.length === 0 ? (
              <Empty>ยังไม่มีผลการแข่งขัน</Empty>
            ) : (
              o.recentMatches.slice(0, 3).map((m) => (
                <Link href={`/matches/${m.id}`} key={m.id} className="tr-match">
                  <div className="tr-match-meta">
                    <span>
                      {m.tournament.name}
                      {m.round ? ` · ${m.round}` : ""}
                    </span>
                    <time dateTime={m.playedAt}>{fmtDateTime(m.playedAt)}</time>
                  </div>
                  <div className="tr-match-score">
                    <span>
                      <Avatar
                        src={m.teamA.logoUrl}
                        name={m.teamA.tag || m.teamA.name}
                      />
                      <span>{m.teamA.name}</span>
                    </span>
                    <strong>
                      {m.scoreA} : {m.scoreB}
                    </strong>
                    <span>
                      <span>{m.teamB.name}</span>
                      <Avatar
                        src={m.teamB.logoUrl}
                        name={m.teamB.tag || m.teamB.name}
                      />
                    </span>
                  </div>
                  <span className="tr-completed">จบการแข่งขัน</span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
      <section
        id="tournaments"
        className="tr-tournaments"
        aria-labelledby="tournaments-title"
      >
        <div className="tr-section-head">
          <div>
            <h2 id="tournaments-title">ลงสนามครั้งต่อไป</h2>
            <p className="tr-section-description">
              ทัวร์ที่กำลังแข่งขันและเปิดรับสมัคร
            </p>
          </div>
          <Link href="/tournaments">
            ดูทัวร์นาเมนต์ทั้งหมด <span aria-hidden="true">→</span>
          </Link>
        </div>
        {!o ? (
          <Empty>ยังโหลดทัวร์นาเมนต์ไม่ได้</Empty>
        ) : o.upcomingTournaments.length === 0 ? (
          <Empty>
            ยังไม่มีรายการที่กำลังจะมาถึง{" "}
            <Link href="/tournaments">ดูรายการทั้งหมด →</Link>
          </Empty>
        ) : (
          <div className="tr-tournament-grid">
            {o.upcomingTournaments.slice(0, 2).map((t, i) => (
              <Link
                href={`/tournaments/${t.id}`}
                className="tr-tournament"
                key={t.id}
              >
                <div className="tr-tournament-cover">
                  <img
                    src="/images/icons/trophy.svg"
                    width="56"
                    height="56"
                    alt=""
                  />
                  <strong>{String(i + 1).padStart(2, "0")}</strong>
                </div>
                <div className="tr-tournament-info">
                  <StatusBadge status={t.status} />
                  <h3>{t.name}</h3>
                  <p>
                    {[t.season?.name, t.game].filter(Boolean).join(" · ") ||
                      "การแข่งขันของชุมชน"}
                  </p>
                  <time dateTime={t.startDate}>
                    {fmtDate(t.startDate)}
                    {t.endDate ? ` – ${fmtDate(t.endDate)}` : ""}
                  </time>
                  <p>
                    {t.registrationOpen
                      ? "เปิดรับสมัคร"
                      : "ดูรายละเอียดการแข่งขัน"}
                    {t.maxTeams ? ` · สูงสุด ${t.maxTeams} ทีม` : ""}
                  </p>
                </div>
                <span className="tr-tournament-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

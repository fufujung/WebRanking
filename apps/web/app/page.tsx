import Link from "@/components/LoadingLink";
import Image from "next/image";
import { LiveRefresh } from "@/components/LiveRefresh";
import { api, PUBLIC, qs } from "@/lib/api";
import type { Overview, SpecialSeason } from "@/lib/types";
import { Avatar, Empty } from "@/components/ui";
import { AdCards } from "@/components/ads/Ads";
import { HomeFilters } from "@/components/public/HomeFilters";
import { allGames } from "@/lib/games";
import { HomeCarousel } from "@/components/public/HomeCarousel";
import { HomeTournaments } from "@/components/public/HomeTournaments";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ game?: string | string[] }>;
}) {
  const params = await searchParams;
  const gameId =
    typeof params.game === "string" ? params.game.trim().slice(0, 40) : "";
  const [overviewResult, games, seasonsResult] = await Promise.allSettled([
    api<Overview>(`/stats/overview${qs({ gameId, home: "1" })}`, PUBLIC),
    allGames(),
    api<{ data: SpecialSeason[] }>("/special/seasons", PUBLIC),
  ]);
  const o = overviewResult.status === "fulfilled" ? overviewResult.value : null;
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
              สำรวจอันดับ
            </Link>
            <Link href="/tournaments" className="btn">
              ดูทัวร์นาเมนต์
            </Link>
            <Link href="/predict" className="btn">
              ทำนายผล
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
        gameId={gameId}
      />
      <div className="home-figma">
        {!o && (
          <div className="notice" role="status">
            ยังโหลดข้อมูลการแข่งขันไม่ได้ กรุณาลองใหม่อีกครั้ง{" "}
            <Link href={`/${qs({ game: gameId })}`}>โหลดใหม่</Link>
          </div>
        )}
        <HomeTournaments special tournaments={o?.specialTournaments ?? null} />
        <HomeTournaments tournaments={o?.normalTournaments ?? null} />
        <section
          id="results"
          className="home-section"
          aria-labelledby="results-title"
        >
          <div className="home-section-heading">
            <div>
              <p>MATCH RESULTS</p>
              <h2 id="results-title">ผลการแข่งขันล่าสุด</h2>
            </div>
            <Link href="/matches">ผลทั้งหมด</Link>
          </div>
          {!o ? (
            <Empty>ยังโหลดผลการแข่งขันไม่ได้</Empty>
          ) : o.recentMatches.length === 0 ? (
            <Empty>ยังไม่มีผลการแข่งขัน</Empty>
          ) : (
            <HomeCarousel label="ผลการแข่งขันล่าสุด">
              {o.recentMatches.map((match) => (
                <Link
                  href={`/matches/${match.id}`}
                  key={match.id}
                  className="home-match-card"
                >
                  <div className="home-match-meta">
                    <span>
                      {match.tournament.special && (
                        <span className="badge">เล่นเก่ง ปากเก่ง</span>
                      )}{" "}
                      {match.tournament.name}
                      {match.round ? ` · ${match.round}` : ""}
                    </span>
                    <span className="home-status home-status-neutral">
                      จบแล้ว
                    </span>
                  </div>
                  <div className="home-match-teams">
                    <div className="home-match-team">
                      <Avatar
                        src={match.teamA.logoUrl}
                        name={match.teamA.tag || match.teamA.name}
                      />
                      <strong>{match.teamA.name}</strong>
                    </div>
                    <strong className="home-match-score">
                      {match.scoreA} : {match.scoreB}
                    </strong>
                    <div className="home-match-team">
                      <Avatar
                        src={match.teamB.logoUrl}
                        name={match.teamB.tag || match.teamB.name}
                      />
                      <strong>{match.teamB.name}</strong>
                    </div>
                  </div>
                  <span className="home-card-action">ดูสกอร์บอร์ดและสถิติ</span>
                </Link>
              ))}
            </HomeCarousel>
          )}
        </section>
      </div>
      <AdCards />
    </div>
  );
}

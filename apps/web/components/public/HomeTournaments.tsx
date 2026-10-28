import Link from "@/components/LoadingLink";
import { HomeCarousel } from "./HomeCarousel";
import { Empty } from "@/components/ui";
import { fmtDate, formatLabel, statusLabel } from "@/lib/format";
import { registrationLabel } from "@/lib/tournamentWorkflow";
import type { Tournament } from "@/lib/types";

export function HomeTournaments({
  tournaments,
  special = false,
}: {
  tournaments: Tournament[] | null;
  special?: boolean;
}) {
  const id = special ? "special" : "tournaments";
  return (
    <section id={id} className="home-section" aria-labelledby={`${id}-title`}>
      <div className="home-section-heading">
        <div>
          <h2 id={`${id}-title`}>
            {special ? "เล่นเก่ง ปากเก่ง" : "ทัวร์นาเมนต์"}
          </h2>
        </div>
        <Link href={special ? "/special" : "/tournaments"}>ดูทุกรายการ</Link>
      </div>
      {!tournaments ? (
        <Empty>ยังโหลดรายการไม่ได้</Empty>
      ) : !tournaments.length ? (
        special ? (
          <div className="card empty home-special-empty">
            ยังไม่มีรายการแข่ง
          </div>
        ) : (
          <Empty>
            ยังไม่มีรายการแข่ง <Link href="/tournaments">ดูรายการทั้งหมด</Link>
          </Empty>
        )
      ) : (
        <HomeCarousel label={special ? "เล่นเก่ง ปากเก่ง" : "ทัวร์นาเมนต์"}>
          {tournaments.map((t) => <HomeTournamentCard key={t.id} tournament={t} />)}
        </HomeCarousel>
      )}
    </section>
  );
}

export function HomeTournamentCard({ tournament: t }: { tournament: Tournament }) {
  const registration = registrationLabel(t, t.teamCount ?? 0);
  const open = registration === "เปิดรับสมัคร";
  return (
              <Link
                href={`/tournaments/${t.id}`}
                className="home-tournament-card"
              >
                <div className="home-tournament-graphic">
                  <strong>{t.name}</strong>
                </div>
                <div className="home-tournament-info">
                  <div className="home-tournament-meta">
                    <span
                      className={`home-status home-status-${t.status === "ONGOING" ? "live" : open ? "open" : "neutral"}`}
                    >
                      {open ? registration : statusLabel[t.status]}
                    </span>
                    <time dateTime={t.startDate}>{fmtDate(t.startDate)}</time>
                  </div>
                  <h3>{t.name}</h3>
                  <p>
                    {[
                      t.game,
                      t.entryMode === "SOLO"
                        ? "ลงเดี่ยว / สุ่มทีม"
                        : t.format
                          ? formatLabel[t.format]
                          : "สมัครเป็นทีม",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="home-tournament-footer">
                    <span>
                      {t.teamCount ?? 0}
                      {t.maxTeams ? ` / ${t.maxTeams}` : ""} ทีม
                      {t.format ? ` · BO${t.bestOf}` : ""}
                    </span>
                    <span>ดูรายการ</span>
                  </div>
                </div>
              </Link>
            );
}

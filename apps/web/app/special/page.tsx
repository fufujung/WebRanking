import Link from "next/link";
import { api, qs } from "@/lib/api";
import type { SpecialBoard } from "@/lib/types";
import { fmtDate, fmtRating, signed } from "@/lib/format";
import { POSITIONS, positionLabel } from "@/lib/solo";
import { currentGame } from "@/lib/games";
import { getMember } from "@/lib/member";
import { discordEnabled } from "@/lib/discord";
import { Avatar, Empty, PlayerLink, StatusBadge } from "@/components/ui";
import { Form, RankMove, TierBadge, TierProgress } from "@/components/Tier";
import { GameTabs } from "@/components/GameTabs";
import { RankBadge } from "@/components/RankBadge";

export const metadata = { title: "เล่นเก่งปากเก่ง · ตัวสำรองและอันดับ MMR แยก" };

const winRate = (p: { wins: number; series: number }) => (p.series ? Math.round((p.wins / p.series) * 100) : 0);

/** The special "เล่นเก่งปากเก่ง" events: their own MMR ladder and stats, and the always-open substitutes list. */
export default async function SpecialPage({ searchParams }: { searchParams: Promise<{ game?: string }> }) {
  const sp = await searchParams;
  const { games, game } = await currentGame(sp.game);
  const [board, me] = await Promise.all([api<SpecialBoard>(`/special${qs({ gameId: game?.id })}`), getMember()]);
  const byPosition = POSITIONS.map((p) => ({ p, players: board.reserve.filter((r) => r.position === p) }));
  const noPosition = board.reserve.filter((r) => !r.position);

  return (
    <>
      <GameTabs games={games} active={game?.id ?? null} />
      <section className="ladder-hero special-hero">
        <div>
          <span className="eyebrow">⭐ รายการพิเศษ</span>
          <h1>เล่นเก่งปากเก่ง</h1>
          <p className="muted">
            สถิติและ MMR ของรายการนี้แยกจาก <Link href="/rankings/players">Ranking หลัก</Link> ทุกคนเริ่มที่ {board.rules.start} MMR
            {" "}ผลการแข่งรายการนี้ไม่ไปเพิ่มหรือลด MMR ของรายการหลัก
          </p>
          <div className="row special-cta">
            {me ? (
              <Link href="/me#reserve" className="btn btn-primary">📝 ลงชื่อตัวสำรอง / แก้ข้อมูล</Link>
            ) : discordEnabled() ? (
              <a href="/api/auth/discord?next=/me" className="btn btn-primary">📝 ลงชื่อตัวสำรอง</a>
            ) : null}
            <span className="muted small">{me ? "" : "เข้าสู่ระบบด้วย Discord แล้วกรอกฟอร์มได้เลย · "}หรือกดปุ่ม 📝 ในห้องลงชื่อของ Discord · เปิดรับตลอด ใช้ได้ทุกงาน</span>
          </div>
        </div>
        <div className="ladder-hero-stats">
          <div><strong>{board.reserve.length}</strong><span>ตัวสำรอง</span></div>
          <div><strong>{board.ranked.length}</strong><span>ผู้เล่นติดอันดับ</span></div>
          <div><strong>{board.events.length}</strong><span>งานที่จัด</span></div>
        </div>
      </section>

      <nav className="row small special-jump" aria-label="ไปที่หัวข้อ">
        <a href="#ladder" className="badge">อันดับ MMR</a>
        <a href="#stats" className="badge">สถิติผู้เล่น</a>
        <a href="#reserve" className="badge">ตัวสำรอง</a>
        <a href="#events" className="badge">งานที่จัด</a>
      </nav>

      <section id="ladder" className="mt">
        <h2>อันดับ MMR เล่นเก่งปากเก่ง</h2>
        {board.ranked.length === 0 ? (
          <Empty>ยังไม่มีผู้เล่นติดอันดับ ต้องลงแข่งรายการพิเศษอย่างน้อย {board.rules.placementSeries} แมตช์ถึงจะขึ้นตาราง</Empty>
        ) : (
          <div className="table-wrap ladder-table">
            <table>
              <thead>
                <tr>
                  <th>อันดับ</th>
                  <th>ผู้เล่น</th>
                  <th>แรงค์</th>
                  <th className="num">MMR</th>
                  <th className="hide-sm">ฟอร์ม</th>
                  <th className="num hide-sm">ชนะ-แพ้</th>
                  <th className="num hide-sm">ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {board.ranked.map((p) => (
                  <tr key={p.id} style={{ ["--tier" as string]: p.tier.color }}>
                    <td>
                      <div className="rank-cell">
                        <span className={`rank rank-${p.rank}`}>{p.rank}</span>
                        <RankMove change={p.rankChange} isNew={p.series > 0} />
                      </div>
                    </td>
                    <td><PlayerLink player={p} /></td>
                    <td><TierBadge tier={p.tier} /></td>
                    <td className="num">
                      <strong className="mmr-num">{p.mmr}</strong>
                      <TierProgress tier={p.tier} progress={p.tierProgress} toNext={p.toNextTier} compact />
                    </td>
                    <td className="hide-sm"><Form results={p.form} /></td>
                    <td className="num hide-sm">{p.wins}-{p.losses} <span className="muted small">({winRate(p)}%)</span></td>
                    <td className="num hide-sm">{p.lastDelta === null ? "-" : <span className={p.lastDelta >= 0 ? "delta-up" : "delta-down"}>{signed(p.lastDelta)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {board.placing.length > 0 && (
          <p className="muted small">
            กำลังจัดอันดับ: {board.placing.map((p) => `${p.nickname || p.name} (อีก ${p.seriesToPlace} แมตช์)`).join(", ")}
          </p>
        )}
      </section>

      <section id="stats" className="mt">
        <h2>สถิติผู้เล่น เล่นเก่งปากเก่ง</h2>
        {board.stats.length === 0 ? (
          <Empty>ยังไม่มีผลการแข่งรายการพิเศษ</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>ผู้เล่น</th>
                  <th className="num">แต้มรวม</th>
                  <th className="num">เฉลี่ย/เกม</th>
                  <th className="num hide-sm">เกม</th>
                  <th className="num hide-sm">ชนะ-แพ้</th>
                  <th className="num hide-sm">รีบาวด์</th>
                  <th className="num hide-sm">แอสซิสต์</th>
                  <th className="num hide-sm">เรตติ้ง</th>
                  <th className="num">MVP</th>
                </tr>
              </thead>
              <tbody>
                {board.stats.map((p) => (
                  <tr key={p.id}>
                    <td>{p.rank}</td>
                    <td><PlayerLink player={p} /></td>
                    <td className="num"><strong>{p.stats.pts}</strong></td>
                    <td className="num">{p.stats.ppg}</td>
                    <td className="num hide-sm">{p.stats.games}</td>
                    <td className="num hide-sm">{p.stats.wins}-{p.stats.losses}</td>
                    <td className="num hide-sm">{p.stats.reb}</td>
                    <td className="num hide-sm">{p.stats.ast}</td>
                    <td className="num hide-sm">{fmtRating(p.stats.avgRating)}</td>
                    <td className="num">{p.stats.mvp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="reserve" className="mt">
        <h2>ตัวสำรอง ({board.reserve.length} คน)</h2>
        {board.reserve.length === 0 ? (
          <Empty>ยังไม่มีใครลงชื่อ</Empty>
        ) : (
          <div className="grid grid-2 reserve-grid">
            {[...byPosition, ...(noPosition.length ? [{ p: null, players: noPosition }] : [])].map(({ p, players }) => (
              <div key={p ?? "none"} className="card">
                <h3 style={{ marginTop: 0 }}>{p ? positionLabel[p] : "ยังไม่ระบุตำแหน่ง"} <span className="muted small">{players.length} คน</span></h3>
                {players.length === 0 ? (
                  <p className="muted small" style={{ margin: 0 }}>ยังไม่มี</p>
                ) : (
                  <ul className="reserve-list">
                    {players.map((r) => (
                      <li key={r.id}>
                        <Link href={`/players/${r.player.id}`} className="entity">
                          <Avatar src={r.player.avatarUrl} name={r.player.name} />
                          <span>
                            <strong>{r.player.nickname || r.player.name}</strong>
                            <span className="muted small"> · UID {r.player.uid ?? "-"}</span>
                          </span>
                        </Link>
                        <span className="reserve-meta">
                          {r.rank ? <RankBadge rank={r.rank} ranks={board.ranks} /> : <span className="muted small">ยังไม่เลือกแรงค์</span>}
                          <span className="muted small">{r.player.specialMmr} MMR</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="events" className="mt">
        <h2>งานที่จัดแล้ว</h2>
        {board.events.length === 0 ? (
          <Empty>ยังไม่มีรายการพิเศษ ผู้จัดติ๊ก &quot;รายการพิเศษ เล่นเก่งปากเก่ง&quot; ตอนสร้างทัวร์ (หรือ /tour create special:True)</Empty>
        ) : (
          <div className="stack">
            {board.events.map((e) => (
              <Link key={e.id} href={`/tournaments/${e.id}`} className="card row between">
                <span>
                  <strong>{e.name}</strong>
                  <span className="muted small"> · {fmtDate(e.startDate)} · {e.matches} แมตช์</span>
                </span>
                <StatusBadge status={e.status} />
              </Link>
            ))}
          </div>
        )}
      </section>

    </>
  );
}

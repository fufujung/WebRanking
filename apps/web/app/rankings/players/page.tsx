import Link from "next/link";
import { redirect } from "next/navigation";
import { api, qs } from "@/lib/api";
import type { LadderPlayer, MmrLadder, Page, Team } from "@/lib/types";
import { signed } from "@/lib/format";
import { Avatar, Empty, PlayerLink } from "@/components/ui";
import { Form, RankMove, TierBadge, TierEmblem, TierProgress } from "@/components/Tier";
import { TeamFilter } from "@/components/TeamFilter";
import { RankingTabs } from "@/components/RankingTabs";

export const metadata = { title: "Ranking ผู้เล่น (MMR)" };

const winRate = (p: { wins: number; series: number }) => (p.series ? Math.round((p.wins / p.series) * 100) : 0);

export default async function MmrRanking({ searchParams }: { searchParams: Promise<{ sort?: string; teamId?: string; q?: string }> }) {
  const sp = await searchParams;
  // This page used to be the stat leaderboard: old links with ?sort= go there.
  if (sp.sort && sp.sort !== "mmr") redirect(`/rankings/stats${qs({ sort: sp.sort, teamId: sp.teamId })}`);
  const [ladder, teams] = await Promise.all([
    api<MmrLadder>(`/rankings/mmr${qs({ teamId: sp.teamId, limit: 200 })}`),
    api<Page<Team>>("/teams?limit=200"),
  ]);
  const q = (sp.q ?? "").trim().toLowerCase();
  const matches = (p: { name: string; nickname: string | null; uid?: string | null }) =>
    !q || p.name.toLowerCase().includes(q) || Boolean(p.nickname?.toLowerCase().includes(q)) || Boolean(p.uid?.toLowerCase().includes(q));
  const rows = ladder.data.filter(matches);
  const filtered = Boolean(q);
  const podium = filtered ? [] : rows.slice(0, 3);
  const rest = filtered ? rows : rows.slice(3);
  const topTier = [...ladder.tiers].reverse().find((t) => t.players > 0);
  const rankedCount = ladder.tiers.reduce((n, t) => n + t.players, 0);

  return (
    <>
      <RankingTabs active="players" />
      <section className="ladder-hero">
        <div>
          <span className="eyebrow">Season Ladder</span>
          <h1>Ranking ผู้เล่น · MMR</h1>
          <p className="muted">
            ทุกคนเริ่มที่ {ladder.rules.start} MMR ชนะแล้วขึ้น แพ้แล้วลง ชนะทีมที่เก่งกว่าได้มากกว่า แรงค์ของคุณดูได้จากตราด้านข้างชื่อ
          </p>
        </div>
        <div className="ladder-hero-stats">
          <div><strong>{rankedCount}</strong><span>ผู้เล่นติดอันดับ</span></div>
          <div><strong>{ladder.data[0]?.mmr ?? "-"}</strong><span>MMR สูงสุด</span></div>
          <div>{topTier ? <TierEmblem tier={topTier} size={40} /> : <strong>-</strong>}<span>แรงค์สูงสุดตอนนี้</span></div>
        </div>
      </section>

      <form className="filters" role="search">
        {sp.teamId && <input type="hidden" name="teamId" value={sp.teamId} />}
        <input className="grow" name="q" defaultValue={sp.q} placeholder="ค้นหาชื่อผู้เล่นหรือ UID" aria-label="ค้นหาผู้เล่น" />
        <button className="btn btn-primary" type="submit" style={{ minWidth: 0 }}>ค้นหา</button>
        <div style={{ minWidth: 240 }}><TeamFilter teams={teams.data} /></div>
      </form>

      {rows.length === 0 ? (
        <Empty>
          {ladder.total === 0
            ? `ยังไม่มีผู้เล่นติดอันดับ ผู้เล่นต้องลงแข่งอย่างน้อย ${ladder.rules.placementSeries} แมตช์ถึงจะขึ้นตาราง`
            : "ไม่พบผู้เล่นที่ค้นหา"}
        </Empty>
      ) : (
        <>
          {podium.length > 0 && <Podium players={podium} />}
          {rest.length > 0 && (
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
                  {rest.map((p) => (
                    <tr key={p.id} style={{ ["--tier" as string]: p.tier.color }}>
                      <td>
                        <div className="rank-cell">
                          <span className={`rank rank-${p.rank}`}>{p.rank}</span>
                          <RankMove change={p.rankChange} isNew={p.series > 0} />
                        </div>
                      </td>
                      <td>
                        <PlayerLink player={p} />
                        {p.team && <div className="muted small ladder-team">{p.team.name}</div>}
                      </td>
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
        </>
      )}

      {ladder.placing.length > 0 && !filtered && (
        <section className="mt">
          <h2>กำลังจัดอันดับ</h2>
          <p className="muted small">ลงแข่งให้ครบ {ladder.rules.placementSeries} แมตช์ก่อนถึงจะได้แรงค์และขึ้นตาราง</p>
          <div className="placing-grid">
            {ladder.placing.map((p) => (
              <div key={p.id} className="card placing-card">
                <PlayerLink player={p} />
                <div className="row between small">
                  <span className="muted">{p.mmr} MMR</span>
                  <span>อีก {p.seriesToPlace} แมตช์</span>
                </div>
                <div className="placing-steps" aria-label={`ลงแล้ว ${p.series} จาก ${ladder.rules.placementSeries} แมตช์`}>
                  {Array.from({ length: ladder.rules.placementSeries }, (_, i) => <span key={i} className={i < p.series ? "done" : ""} />)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt grid grid-2 tier-info">
        <div className="card">
          <h2>แรงค์ทั้งหมด</h2>
          <div className="tier-list">
            {[...ladder.tiers].reverse().map((t) => (
              <div key={t.key} className="tier-row" style={{ ["--tier" as string]: t.color }}>
                <TierEmblem tier={t} size={36} />
                <div className="grow">
                  <strong>{t.name}</strong> <span className="muted small">{t.nameTh}</span>
                  <div className="muted small">{t.next === null ? `${t.min} ขึ้นไป` : `${t.min} – ${t.next - 1}`} MMR</div>
                </div>
                <div className="tier-count">
                  <div className="tier-count-bar"><span style={{ width: `${rankedCount ? (t.players / rankedCount) * 100 : 0}%` }} /></div>
                  <span className="small">{t.players} คน</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card mmr-rules">
          <h2>MMR คิดยังไง</h2>
          <ul>
            <li>ทุกคนเริ่มที่ <strong>{ladder.rules.start} MMR</strong> แข่งจบแต่ละแมตช์ (ซีรีส์) MMR จะขึ้นหรือลงทันที</li>
            <li><strong>ชนะได้ แพ้เสีย</strong> ปกติแมตช์ละประมาณ {ladder.rules.k / 2} ชนะทีมที่ MMR สูงกว่าได้มากกว่า แพ้ทีมที่อ่อนกว่าเสียมากกว่า</li>
            <li>ความเก่งของแต่ละฝั่งคิดจาก <strong>MMR เฉลี่ยของผู้เล่นที่ลงจริง</strong> ในแมตช์นั้น</li>
            <li>โบนัสฟอร์มดี: <strong>MVP +{ladder.rules.mvpBonus}</strong> และ <strong>SVP +{ladder.rules.svpBonus}</strong> ต่อเกม</li>
            <li>{ladder.rules.placementSeries} แมตช์แรกเป็น <strong>แมตช์จัดอันดับ</strong> MMR ขยับแรงกว่าปกติ เพื่อให้เจอระดับจริงเร็ว</li>
            <li>▲▼ ข้างอันดับคือ <strong>อันดับที่ขยับใน {ladder.rules.movementDays} วันล่าสุด</strong></li>
            <li>เปลี่ยนชื่อในเกมได้ ถ้า UID เดิม MMR และสถิติยังเป็นของคนเดิม</li>
          </ul>
        </div>
      </section>
    </>
  );
}

function Podium({ players }: { players: LadderPlayer[] }) {
  // 2nd, 1st, 3rd from left to right, like a real podium.
  const order = [players[1], players[0], players[2]].filter(Boolean);
  return (
    <div className="podium">
      {order.map((p) => (
        <Link key={p.id} href={`/players/${p.id}`} className={`podium-card podium-${p.rank}`} style={{ ["--tier" as string]: p.tier.color }}>
          <span className="podium-rank">{p.rank === 1 ? "👑" : `#${p.rank}`}</span>
          <div className="podium-avatar">
            <Avatar src={p.avatarUrl} name={p.name} size="lg" round />
            <span className="podium-emblem"><TierEmblem tier={p.tier} size={p.rank === 1 ? 52 : 44} /></span>
          </div>
          <strong className="podium-name">{p.name}</strong>
          <span className="muted small podium-team">{p.team?.name ?? "ไม่มีสังกัด"}</span>
          <span className="podium-mmr">{p.mmr}<small>MMR</small></span>
          <span className="podium-tier">{p.tier.name}</span>
          <div className="row podium-meta">
            <Form results={p.form} />
            <RankMove change={p.rankChange} isNew={p.series > 0} />
          </div>
        </Link>
      ))}
    </div>
  );
}


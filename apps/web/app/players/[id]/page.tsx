import Link from "next/link";
import { notFound } from "next/navigation";
import { api, apiOrNull } from "@/lib/api";
import { STAT_KEYS, type PlayerDetail, type Tier } from "@/lib/types";
import { fmtDate, fmtRating, signed, statLabels } from "@/lib/format";
import { AwardBadge, Avatar, Empty, StatTile, TeamLink } from "@/components/ui";
import { Form, MmrChart, RankMove, TierEmblem, TierProgress } from "@/components/Tier";
import { positionText } from "@/lib/solo";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const [p, tiers] = await Promise.all([
    apiOrNull<PlayerDetail>(`/players/${encodeURIComponent((await params).id)}`),
    api<{ data: Tier[] }>("/rankings/tiers"),
  ]);
  if (!p) notFound();
  const s = p.stats;
  const history = p.mmrHistory.slice(-30);
  const form = [...p.mmrHistory].reverse().slice(0, 5).map((h) => h.result);
  return (
    <>
      <div className="page-head">
        <div className="row">
          <Avatar src={p.avatarUrl} name={p.name} size="lg" round />
          <div>
            <h1>{p.name}</h1>
            <span className="muted">{[p.nickname && `“${p.nickname}”`, positionText(p.role), p.country].filter(Boolean).join(" · ") || " "}</span>
            {(p.game || p.uid || p.discordId || p.names.length > 0) && (
              <div className="row small" style={{ gap: 8, marginTop: 6 }}>
                {p.game && <span className="chip game-chip" title="เกม">{p.game.name}</span>}
                {p.uid && <span className="chip uid-chip" title="UID ในเกม">UID {p.uid}{p.server ? ` · ${p.server}` : ""}</span>}
                {p.discordId && <span className="chip verified-chip" title="เจ้าของโปรไฟล์ยืนยันตัวตนด้วย Discord แล้ว">✓ ยืนยันผ่าน Discord</span>}
                {p.names.length > 0 && (
                  <span className="muted" title={p.names.map((n) => `${n.name} (ใช้ถึง ${fmtDate(n.lastSeen)})`).join("\n")}>
                    เคยใช้ชื่อ: {p.names.map((n) => n.name).join(", ")}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
          {p.team ? <TeamLink team={p.team} /> : <span className="muted">ไม่มีทีม</span>}
          {p.guild && (
            <Link href={`/guilds/${p.guild.id}`} className="chip guild-chip" title="กิลด์">🛡 {p.guild.name}{p.guild.tag ? ` [${p.guild.tag}]` : ""}</Link>
          )}
          {p.blacklist?.active && <Link href="/blacklist" className="blacklist-chip" title="ดูรายชื่อ Blacklist">⛔ ติด Blacklist</Link>}
        </div>
      </div>

      {p.blacklist?.active && (
        <div className="blacklist-banner" role="note">
          <strong>⛔ ผู้เล่นนี้ติด Blacklist ถูกหักรวม {p.blacklist.penalty} MMR</strong>
          <ul className="small">
            {p.blacklist.entries
              .filter((e) => !e.liftedAt)
              .map((e) => (
                <li key={e.id}>
                  {e.reason}
                  {e.tournament && <> · <Link href={`/tournaments/${e.tournament.id}`}>{e.tournament.name}</Link>{e.matchNumber ? ` (M${e.matchNumber})` : ""}</>}
                  {" "}· {fmtDate(e.createdAt)} · <strong>-{e.penalty} MMR</strong>
                </li>
              ))}
          </ul>
        </div>
      )}

      <section className="mmr-card" style={{ ["--tier" as string]: p.tier.color }}>
        <div className="mmr-card-emblem">
          <TierEmblem tier={p.tier} size={112} />
          <strong>{p.placed ? p.tier.name : "กำลังจัดอันดับ"}</strong>
          <span className="muted small">{p.placed ? p.tier.nameTh : `อีก ${p.seriesToPlace} แมตช์`}</span>
        </div>
        <div className="mmr-card-main">
          <div className="row" style={{ alignItems: "baseline", gap: 14 }}>
            <span className="mmr-big">{p.mmr}<small>MMR</small></span>
            {p.mmrHistory.length > 0 && (
              <span className={p.mmrHistory.at(-1)!.delta >= 0 ? "delta-up" : "delta-down"} title="จากแมตช์ล่าสุด">
                <strong>{signed(p.mmrHistory.at(-1)!.delta)}</strong> <span className="small">แมตช์ล่าสุด</span>
              </span>
            )}
          </div>
          <TierProgress tier={p.tier} progress={p.tierProgress} toNext={p.toNextTier} />
          <div className="mmr-facts">
            <div>
              <strong>{p.mmrRank ? <>#{p.mmrRank} <RankMove change={p.rankChange} isNew /></> : "-"}</strong>
              <span>{p.mmrRank ? `อันดับจาก ${p.rankedPlayers} คน${p.game ? ` ใน ${p.game.name}` : ""}` : `ลงอีก ${p.seriesToPlace} แมตช์เพื่อติดอันดับ`}</span>
            </div>
            <div><strong>{p.peakMmr}</strong><span>MMR สูงสุดที่เคยทำได้</span></div>
            <div><strong>{p.series}</strong><span>แมตช์ที่นับ MMR</span></div>
            <div><Form results={form} /><span>ฟอร์ม 5 แมตช์ล่าสุด</span></div>
          </div>
        </div>
      </section>

      {history.length >= 2 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="row between">
            <h2 style={{ margin: 0 }}>MMR ตามเวลา</h2>
            <Link href="/rankings/players" className="small muted">ดู Ranking ทั้งหมด →</Link>
          </div>
          <MmrChart
            tiers={tiers.data}
            points={history.map((h) => ({ after: h.after, result: h.result, label: `${fmtDate(h.match.playedAt)} ${h.match.teamA.name} ${h.match.scoreA}-${h.match.scoreB} ${h.match.teamB.name}` }))}
          />
        </section>
      )}

      <div className="grid grid-4">
        <StatTile label="เกม (ซีรีส์)" value={`${s.games} (${s.matches})`} />
        <StatTile label="ชนะ / แพ้ (เกม)" value={`${s.wins} / ${s.losses} · ${s.winRate}%`} />
        <StatTile label="เรตติ้งเฉลี่ย" value={fmtRating(s.avgRating)} />
        <StatTile label="MVP / SVP" value={`${s.mvp} / ${s.svp}`} />
        <StatTile label="แต้มรวม (เฉลี่ย/เกม)" value={`${s.pts} (${s.ppg})`} />
        <StatTile label="รีบาวด์ (เฉลี่ย/เกม)" value={`${s.reb} (${s.rpg})`} />
        <StatTile label="แอสซิสต์ (เฉลี่ย/เกม)" value={`${s.ast} (${s.apg})`} />
        <StatTile label="BLK / STL / LBR" value={`${s.blk} / ${s.stl} / ${s.lbr}`} />
      </div>

      <h2 className="mt">สถิติรายเกม</h2>
      {p.recentGames.length === 0 ? (
        <Empty>ยังไม่มีสถิติ</Empty>
      ) : (
        <div className="table-wrap">
          <table className="score-table">
            <thead>
              <tr>
                <th>วันที่</th><th>เกม</th><th>ผล</th><th>คู่แข่ง</th><th className="num">สกอร์</th><th className="num">เรตติ้ง</th>
                {STAT_KEYS.map((k) => <th key={k} className="num" title={statLabels[k].th}>{statLabels[k].short}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {p.recentGames.map((r) => {
                const m = r.match;
                const onA = m.teamAId === r.team.id;
                const opp = onA ? m.teamB : m.teamA;
                const own = onA ? r.game.scoreA : r.game.scoreB;
                const other = onA ? r.game.scoreB : r.game.scoreA;
                return (
                  <tr key={`${m.id}-${r.game.number}`}>
                    <td className="muted"><Link href={`/matches/${m.id}`}>{fmtDate(m.playedAt)}</Link></td>
                    <td className="muted">{r.game.number}</td>
                    <td>{own === other ? <span className="result-D">เสมอ</span> : own > other ? <span className="result-W">ชนะ</span> : <span className="result-L">แพ้</span>}</td>
                    <td><TeamLink team={opp} /></td>
                    <td className="num">{own} : {other}</td>
                    <td className="num">{fmtRating(r.rating)}</td>
                    {STAT_KEYS.map((k) => <td key={k} className="num">{k === "pts" ? <strong>{r[k]}</strong> : r[k]}</td>)}
                    <td>{r.award && <AwardBadge award={r.award} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

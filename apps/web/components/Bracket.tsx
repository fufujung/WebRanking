import Link from "next/link";
import type { Bracket, BracketSlot, Entry } from "@/lib/types";
import { fmtThaiTime } from "@/lib/format";

const STAGE_TITLE: Record<BracketSlot["stage"], string> = {
  W: "สายบน",
  L: "สายล่าง",
  GF: "รอบชิงชนะเลิศ",
  P3: "ชิงอันดับ 3",
  RR: "ตารางแข่ง",
};

function TeamLine({ slot, side }: { slot: BracketSlot; side: "A" | "B" }) {
  const team = side === "A" ? slot.teamA : slot.teamB;
  const bye = side === "A" ? slot.byeA : slot.byeB;
  const source = side === "A" ? slot.sourceA : slot.sourceB;
  const score = side === "A" ? slot.scoreA : slot.scoreB;
  const won = Boolean(team && slot.winnerId === team.id);
  const lost = Boolean(team && slot.status === "DONE" && slot.winnerId && slot.winnerId !== team.id);
  return (
    <div className={`bm-team${won ? " bm-win" : ""}${lost ? " bm-lose" : ""}`}>
      <span className="bm-name">
        {team ? (
          <>
            {team.seed !== null && <span className="bm-seed">{team.seed}</span>}
            {team.name}
          </>
        ) : (
          <span className="muted">{bye ? "บาย" : (source ?? "รอทีม")}</span>
        )}
      </span>
      <span className="bm-score">{slot.status === "DONE" && slot.outcome !== "BYE" ? (slot.outcome === "WALKOVER" ? (won ? "W" : "-") : (score ?? "")) : ""}</span>
    </div>
  );
}

/** One match box. Links to the recorded series, or calls onSelect (admin). */
export function MatchBox({ slot, onSelect, selected }: { slot: BracketSlot; onSelect?: (slot: BracketSlot) => void; selected?: boolean }) {
  const head = (
    <div className="bm-head">
      <span>M{slot.number}</span>
      <span>
        {slot.disputed && <span title="มีการแย้งผล">⚠️ </span>}
        {slot.outcome === "WALKOVER" ? "ชนะบาย" : slot.status === "READY" && slot.scheduledAt ? fmtThaiTime(slot.scheduledAt) : ""}
      </span>
    </div>
  );
  const body = (
    <>
      {head}
      <TeamLine slot={slot} side="A" />
      <TeamLine slot={slot} side="B" />
    </>
  );
  const cls = `bm bm-${slot.status}${selected ? " bm-selected" : ""}`;
  if (onSelect) {
    return <button type="button" className={cls} onClick={() => onSelect(slot)}>{body}</button>;
  }
  if (slot.matchId) return <Link className={`${cls} bm-link`} href={`/matches/${slot.matchId}`}>{body}</Link>;
  return <div className={cls}>{body}</div>;
}

/** Elimination rounds as columns, per stage (upper, lower, finals). */
function Stage({ slots, onSelect, selectedId }: { slots: BracketSlot[]; onSelect?: (slot: BracketSlot) => void; selectedId?: string }) {
  const rounds = [...new Set(slots.map((s) => s.round))].sort((a, b) => a - b);
  return (
    <div className="bracket">
      {rounds.map((r) => {
        const inRound = slots.filter((s) => s.round === r).sort((a, b) => a.position - b.position);
        return (
          <div key={r} className="bracket-col">
            <div className="bracket-round">{inRound[0].label}</div>
            <div className="bracket-matches">
              {inRound.map((s) => <MatchBox key={s.id} slot={s} onSelect={onSelect} selected={s.id === selectedId} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BracketView({ bracket, onSelect, selectedId }: { bracket: Bracket; onSelect?: (slot: BracketSlot) => void; selectedId?: string }) {
  // A grand final reset that wasn't needed is not shown.
  const shown = bracket.matches.filter((m) => m.status !== "SKIPPED");
  if (bracket.format === "ROUND_ROBIN") {
    const rounds = [...new Set(shown.map((s) => s.round))].sort((a, b) => a - b);
    return (
      <div className="stack">
        {bracket.standings && <RoundRobinTable standings={bracket.standings} />}
        {rounds.map((r) => (
          <div key={r}>
            <h3 className="bracket-round">รอบที่ {r}</h3>
            <div className="bm-grid">
              {shown.filter((s) => s.round === r).map((s) => <MatchBox key={s.id} slot={s} onSelect={onSelect} selected={s.id === selectedId} />)}
            </div>
          </div>
        ))}
      </div>
    );
  }
  const stages = (["W", "L", "GF", "P3"] as const).filter((st) => shown.some((s) => s.stage === st));
  const single = bracket.format === "SINGLE_ELIMINATION";
  return (
    <div className="stack">
      {stages.map((st) => (
        <div key={st}>
          {!(single && st === "W") && <h3 style={{ margin: "0 0 8px" }}>{STAGE_TITLE[st]}</h3>}
          <Stage slots={shown.filter((s) => s.stage === st)} onSelect={onSelect} selectedId={selectedId} />
        </div>
      ))}
    </div>
  );
}

export function RoundRobinTable({ standings }: { standings: NonNullable<Bracket["standings"]> }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>#</th><th>ทีม</th><th className="num">แข่ง</th><th className="num">ชนะ</th><th className="num">เสมอ</th><th className="num">แพ้</th><th className="num">ได้</th><th className="num">เสีย</th><th className="num">+/-</th><th className="num">แต้ม</th></tr>
        </thead>
        <tbody>
          {standings.map((s) => (
            <tr key={s.teamId}>
              <td className={`rank rank-${s.position}`}>{s.position}</td>
              <td>{s.team?.name ?? "-"}</td>
              <td className="num">{s.played}</td>
              <td className="num">{s.wins}</td>
              <td className="num">{s.draws}</td>
              <td className="num">{s.losses}</td>
              <td className="num">{s.gamesFor}</td>
              <td className="num">{s.gamesAgainst}</td>
              <td className="num">{s.diff > 0 ? `+${s.diff}` : s.diff}</td>
              <td className="num"><strong>{s.points}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The registered players of each team (names only; Discord accounts stay private). */
export function Rosters({ teams }: { teams: Entry[] }) {
  return (
    <div className="grid grid-3">
      {teams.map((t) => (
        <div key={t.id} className="card">
          <div className="row between">
            <Link href={`/teams/${t.id}`}><strong>{t.name}</strong></Link>
            {t.seed !== null && <span className="badge">ซีด {t.seed}</span>}
          </div>
          {t.roster.length ? (
            <ol className="roster-list">{t.roster.map((p) => <li key={p.playerId}><Link href={`/players/${p.playerId}`}>{p.name}</Link></li>)}</ol>
          ) : (
            <p className="muted small" style={{ margin: "8px 0 0" }}>ยังไม่ได้ส่งรายชื่อ</p>
          )}
        </div>
      ))}
    </div>
  );
}

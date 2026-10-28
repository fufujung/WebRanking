"use client";

import Link from "@/components/LoadingLink";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { Bracket, BracketSlot, Entry } from "@/lib/types";
import { fmtThaiTime } from "@/lib/format";
import { Avatar } from "./ui";
import { LogoMark } from "./public/LogoMark";

const STAGE_TITLE: Record<BracketSlot["stage"], string> = {
  W: "สายบน",
  L: "สายล่าง",
  GF: "รอบชิงชนะเลิศ",
  P3: "ชิงอันดับ 3",
  RR: "ตารางแข่ง",
};

// Layout of the drawn bracket, in pixels.
const BOX_W = 232;
const BOX_H = 88;
const GAP_X = 56;
const GAP_Y = 18;
const HEAD = 34;
const CHAMP_W = 200;

type Hover = { teamId: string | null; set: (id: string | null) => void };

/** The time now, set after the page loads so the server and browser render the same thing first. */
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function TeamLine({ slot, side, hover }: { slot: BracketSlot; side: "A" | "B"; hover?: Hover }) {
  const team = side === "A" ? slot.teamA : slot.teamB;
  const bye = side === "A" ? slot.byeA : slot.byeB;
  const source = side === "A" ? slot.sourceA : slot.sourceB;
  const score = side === "A" ? slot.scoreA : slot.scoreB;
  const done = slot.status === "DONE" && slot.outcome !== "BYE";
  const won = Boolean(team && slot.winnerId === team.id);
  const lost = Boolean(team && done && slot.winnerId && slot.winnerId !== team.id);
  const shown = done ? (slot.outcome === "WALKOVER" ? (won ? "W" : "–") : (score ?? "")) : "";
  const cls = `bm-team${won ? " bm-win" : ""}${lost ? " bm-lose" : ""}${team && hover?.teamId === team.id ? " bm-hot" : ""}`;
  return (
    <div className={cls} onMouseEnter={team && hover ? () => hover.set(team.id) : undefined} onMouseLeave={team && hover ? () => hover.set(null) : undefined}>
      <span className="bm-name">
        {team ? (
          <>
            <Avatar src={team.logoUrl} name={team.tag || team.name} />
            {team.seed !== null && <span className="bm-seed">{team.seed}</span>}
            <span className="bm-label">{team.name}</span>
          </>
        ) : (
          <span className="muted bm-label">{bye ? "บาย" : (source ?? "รอทีม")}</span>
        )}
      </span>
      <span className={`bm-score${shown === "" ? " bm-score-empty" : ""}`}>{shown}</span>
    </div>
  );
}

/** One match box. Links to the recorded series, or calls onSelect (admin). */
export function MatchBox({ slot, onSelect, selected, hover, now }: { slot: BracketSlot; onSelect?: (slot: BracketSlot) => void; selected?: boolean; hover?: Hover; now?: number | null }) {
  const live = slot.status === "READY" && slot.scheduledAt && now != null && now >= new Date(slot.scheduledAt).getTime();
  const right = slot.disputed ? (
    <span className="bm-flag" title="มีการแย้งผล"> แย้งผล</span>
  ) : slot.outcome === "WALKOVER" ? (
    <span>ชนะบาย</span>
  ) : slot.outcome === "BYE" ? (
    <span>ได้บาย</span>
  ) : live ? (
    <span className="bm-live">LIVE</span>
  ) : slot.status === "READY" && slot.scheduledAt ? (
    <span>{fmtThaiTime(slot.scheduledAt)}</span>
  ) : slot.status === "DONE" ? (
    <span>จบแล้ว</span>
  ) : null;
  const involved = hover?.teamId && (slot.teamA?.id === hover.teamId || slot.teamB?.id === hover.teamId);
  const body = (
    <>
      <div className="bm-head">
        <span>M{slot.number}{slot.bestOf ? ` · BO${slot.bestOf}` : ""}</span>
        {right}
      </div>
      <TeamLine slot={slot} side="A" hover={hover} />
      <TeamLine slot={slot} side="B" hover={hover} />
    </>
  );
  const cls = `bm bm-${slot.status}${live ? " bm-is-live" : ""}${selected ? " bm-selected" : ""}${hover?.teamId ? (involved ? " bm-path" : " bm-dim") : ""}`;
  if (onSelect) {
    return <button type="button" className={cls} onClick={() => onSelect(slot)}>{body}</button>;
  }
  if (slot.matchId) return <Link className={`${cls} bm-link`} href={`/matches/${slot.matchId}`}>{body}</Link>;
  return <div className={cls}>{body}</div>;
}

interface Placed {
  slot: BracketSlot;
  col: number;
  y: number;
}

// Where each team's row sits inside a match box (its vertical centre).
const ROW_Y = { A: 37, B: 67 };

/** Which row of `target` the winner of `feeder` goes to. */
function sideOf(target: BracketSlot, feeder: BracketSlot): "A" | "B" {
  if (feeder.winnerId && target.teamA?.id === feeder.winnerId) return "A";
  if (feeder.winnerId && target.teamB?.id === feeder.winnerId) return "B";
  const from = new RegExp(`M${feeder.number}(?!\\d)`);
  if (target.sourceA && from.test(target.sourceA)) return "A";
  return "B";
}

/** Puts boxes at the wanted heights, in order, without overlapping. */
function stack(items: { slot: BracketSlot; want: number | null }[], col: number) {
  let bottom = -GAP_Y;
  return items.map(({ slot, want }) => {
    const y = Math.max(want ?? bottom + GAP_Y, bottom + GAP_Y);
    bottom = y + BOX_H;
    return { slot, col, y };
  });
}

/**
 * Places a stage's matches in columns by round. The busiest round is spread evenly; later matches
 * sit level with the matches that feed them, and earlier ones (play-ins) beside the row they feed,
 * so the lines between rounds run straight. Byes are left out once play starts, as they were never played
 * (the draft keeps them so organizers see who got one).
 */
function layout(slots: BracketSlot[], byes: boolean) {
  const shown = byes ? slots : slots.filter((s) => s.outcome !== "BYE");
  const rounds = [...new Set(shown.map((s) => s.round))].sort((a, b) => a - b);
  const cols = rounds.map((r) => shown.filter((s) => s.round === r).sort((a, b) => a.position - b.position));
  const byCode = new Map<string, Placed>();
  const put = (list: Placed[]) => list.forEach((p) => byCode.set(p.slot.code, p));
  const anchor = cols.reduce((best, c, i) => (c.length > cols[best].length ? i : best), 0);
  put(stack(cols[anchor].map((slot) => ({ slot, want: null })), anchor));
  for (let i = anchor - 1; i >= 0; i--) {
    const items = cols[i].map((slot) => {
      const to = slot.winnerTo ? byCode.get(slot.winnerTo) : undefined;
      return { slot, want: to ? to.y + ROW_Y[sideOf(to.slot, slot)] - BOX_H / 2 : null };
    });
    put(stack(items.sort((a, b) => (a.want ?? Infinity) - (b.want ?? Infinity)), i));
  }
  for (let i = anchor + 1; i < cols.length; i++) {
    const items = cols[i].map((slot) => {
      const feeders = shown.filter((f) => f.winnerTo === slot.code).map((f) => byCode.get(f.code)).filter((p): p is Placed => Boolean(p));
      return { slot, want: feeders.length ? feeders.reduce((n, f) => n + f.y, 0) / feeders.length : null };
    });
    put(stack(items, i));
  }
  const placed = [...byCode.values()];
  const top = Math.min(...placed.map((p) => p.y));
  for (const p of placed) p.y -= top;
  const height = placed.reduce((n, p) => Math.max(n, p.y + BOX_H), 0);
  return { placed, byCode, cols: cols.length, height };
}

const colX = (col: number) => col * (BOX_W + GAP_X);

/** A stage drawn as a bracket: rounds as columns joined by lines, and the champion at the end when it is over. */
function Stage({ slots, byes, champion, onSelect, selectedId, hover, now }: { slots: BracketSlot[]; byes: boolean; champion?: Entry | null; onSelect?: (slot: BracketSlot) => void; selectedId?: string; hover: Hover; now: number | null }) {
  const { placed, byCode, cols, height } = useMemo(() => layout(slots, byes), [slots, byes]);
  if (!placed.length) return null;
  const last = placed.filter((p) => p.col === cols - 1);
  const final = last.length === 1 ? last[0] : null;
  const showChamp = Boolean(champion && final);
  const width = colX(cols - 1) + BOX_W + (showChamp ? GAP_X + CHAMP_W : 0);
  const lines = placed.flatMap((p) => {
    const to = p.slot.winnerTo ? byCode.get(p.slot.winnerTo) : undefined;
    if (!to) return [];
    const x1 = colX(p.col) + BOX_W;
    const won = p.slot.winnerId ? (p.slot.teamA?.id === p.slot.winnerId ? "A" : "B") : null;
    const y1 = HEAD + p.y + (won ? ROW_Y[won] : BOX_H / 2);
    const x2 = colX(to.col);
    const y2 = HEAD + to.y + ROW_Y[sideOf(to.slot, p.slot)];
    const mid = x1 + (x2 - x1) / 2;
    const done = p.slot.status === "DONE" && Boolean(p.slot.winnerId);
    const hot = done && hover.teamId !== null && p.slot.winnerId === hover.teamId;
    return [{ key: p.slot.code, d: `M${x1} ${y1} H${mid} V${y2} H${x2}`, cls: `bk-line${done ? " bk-line-done" : ""}${hot ? " bk-line-hot" : ""}` }];
  });
  if (showChamp && final) {
    const x1 = colX(final.col) + BOX_W;
    const y = HEAD + final.y + BOX_H / 2;
    lines.push({ key: "champ", d: `M${x1} ${y} H${x1 + GAP_X}`, cls: `bk-line bk-line-done${hover.teamId === champion!.id ? " bk-line-hot" : ""}` });
  }
  const labels = [...new Set(placed.map((p) => p.col))].map((col) => {
    const s = placed.find((p) => p.col === col)!.slot;
    return { col, label: s.label };
  });
  return (
    <div className="bk-scroll">
      <div className="bk-canvas" style={{ width, height: HEAD + height }}>
        <svg className="bk-lines" width={width} height={HEAD + height} aria-hidden="true">
          {lines.map((l) => <path key={l.key} d={l.d} className={l.cls} />)}
        </svg>
        {labels.map(({ col, label }) => (
          <Fragment key={col}>
            <div className="bk-round" style={{ left: colX(col), width: BOX_W }}>{label}</div>
            <div className="bk-snap" style={{ left: colX(col) }} />
          </Fragment>
        ))}
        {placed.map((p) => (
          <div key={p.slot.id} className="bk-slot" style={{ left: colX(p.col), top: HEAD + p.y, width: BOX_W, height: BOX_H }}>
            <MatchBox slot={p.slot} onSelect={onSelect} selected={p.slot.id === selectedId} hover={hover} now={now} />
          </div>
        ))}
        {showChamp && final && champion && (
          <div
            className={`bk-champ${hover.teamId === champion.id ? " bm-path" : ""}`}
            style={{ left: colX(final.col) + BOX_W + GAP_X, top: HEAD + final.y + BOX_H / 2 - 62, width: CHAMP_W }}
            onMouseEnter={() => hover.set(champion.id)}
            onMouseLeave={() => hover.set(null)}
          >
            <div className="bk-champ-cup"><LogoMark size={40} /></div>
            <div className="bk-champ-label">แชมป์</div>
            <Link href={`/teams/${champion.id}`} className="bk-champ-name">{champion.name}</Link>
          </div>
        )}
      </div>
    </div>
  );
}

export function BracketView({ bracket, onSelect, selectedId }: { bracket: Bracket; onSelect?: (slot: BracketSlot) => void; selectedId?: string }) {
  const [teamId, set] = useState<string | null>(null);
  const hover: Hover = { teamId, set };
  const now = useNow();
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
              {shown.filter((s) => s.round === r).map((s) => <MatchBox key={s.id} slot={s} onSelect={onSelect} selected={s.id === selectedId} hover={hover} now={now} />)}
            </div>
          </div>
        ))}
      </div>
    );
  }
  const stages = (["W", "L", "GF", "P3"] as const).filter((st) => shown.some((s) => s.stage === st));
  const single = bracket.format === "SINGLE_ELIMINATION";
  const champion = bracket.status === "DONE" ? (bracket.placements.find((p) => p.placement === 1)?.team ?? null) : null;
  // The champion card closes the stage that decides the title.
  const titleStage = single ? "W" : "GF";
  return (
    <div className="stack bk">
      {stages.map((st) => (
        <div key={st} className="bk-stage">
          {!(single && st === "W") && <h3 className="bk-stage-title">{STAGE_TITLE[st]}</h3>}
          <Stage slots={shown.filter((s) => s.stage === st)} byes={bracket.status === "DRAFT"} champion={st === titleStage ? champion : null} onSelect={onSelect} selectedId={selectedId} hover={hover} now={now} />
        </div>
      ))}
      <p className="muted small bk-hint">ชี้ที่ชื่อทีมเพื่อดูเส้นทางของทีมนั้น</p>
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
            <ol className="roster-list">{t.roster.map((p) => <li key={p.playerId}>
                <Link href={`/players/${p.playerId}`}>{p.name}</Link>
                {(p.uid || p.server) && <span className="muted small"> · {[p.uid && `UID ${p.uid}`, p.server].filter(Boolean).join(" · ")}</span>}
              </li>)}</ol>
          ) : (
            <p className="muted small" style={{ margin: "8px 0 0" }}>ยังไม่ได้ส่งรายชื่อ</p>
          )}
        </div>
      ))}
    </div>
  );
}

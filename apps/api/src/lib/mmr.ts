/**
 * Player MMR: every player has a personal rating that moves after each series they play in.
 *
 * How a series changes it (the same Elo idea as team ratings, so it is easy to explain):
 * - Each side's strength is the average MMR of the players who appeared for it in the series
 *   (a side without a scoreboard falls back to its team rating at that time).
 * - Win = 1, draw = 0.5, loss = 0. Change = K × (result − expected), K = 32,
 *   or 48 during a player's first PLACEMENT_SERIES series so new players find their level faster.
 * - Bonus for standing out: +2 per MVP and +1 per SVP the player earned in the series.
 */
import type { Prisma } from "@prisma/client";

export const START_MMR = 1000;
export const MMR_K = 32;
export const PLACEMENT_K = 48;
/** Series a player needs before they get a tier and a place in the MMR ranking. */
export const PLACEMENT_SERIES = 3;
export const MVP_BONUS = 2;
export const SVP_BONUS = 1;

export interface Tier {
  key: string;
  name: string;
  nameTh: string;
  color: string;
  /** Lowest MMR in this tier. */
  min: number;
  /** Lowest MMR of the next tier, null for the top tier. */
  next: number | null;
}

/** Lowest tier first. */
export const TIERS: Tier[] = (
  [
    ["bronze", "Bronze", "บรอนซ์", "#cd7f32", 0],
    ["silver", "Silver", "ซิลเวอร์", "#b8c2cc", 900],
    ["gold", "Gold", "โกลด์", "#f5b400", 975],
    ["platinum", "Platinum", "แพลทินัม", "#35d0c0", 1050],
    ["diamond", "Diamond", "ไดมอนด์", "#4da3ff", 1125],
    ["master", "Master", "มาสเตอร์", "#b26bff", 1200],
    ["legend", "Legend", "เลเจนด์", "#ff2d3d", 1300],
  ] as const
).map(([key, name, nameTh, color, min], i, all) => ({ key, name, nameTh, color, min, next: all[i + 1]?.[4] ?? null }));

export function tierOf(mmr: number): Tier {
  let tier = TIERS[0];
  for (const t of TIERS) if (mmr >= t.min) tier = t;
  return tier;
}

/** Where a rating sits in its tier: 0-100 % of the way to the next tier (100 in the top tier). */
export function tierProgress(mmr: number) {
  const t = tierOf(mmr);
  if (t.next === null) return { tier: t, progress: 100, toNext: 0 };
  const floor = t.key === "bronze" ? Math.min(mmr, t.next - 100) : t.min;
  const progress = Math.round(((mmr - floor) / (t.next - floor)) * 100);
  return { tier: t, progress: Math.max(0, Math.min(100, progress)), toNext: t.next - mmr };
}

export type SeriesResult = "W" | "L" | "D";

export interface SeriesPlayer {
  playerId: string;
  side: "A" | "B";
  mvp: number;
  svp: number;
}

/** One series' MMR changes. ratings holds every player's current MMR and series count and is updated in place. */
export function scoreSeries(
  players: SeriesPlayer[],
  winner: "A" | "B" | null,
  ratings: Map<string, { mmr: number; series: number }>,
  fallback: { A: number; B: number },
) {
  const get = (id: string) => ratings.get(id) ?? { mmr: START_MMR, series: 0 };
  const avg = (side: "A" | "B") => {
    const own = players.filter((p) => p.side === side);
    return own.length ? own.reduce((n, p) => n + get(p.playerId).mmr, 0) / own.length : fallback[side];
  };
  const strength = { A: avg("A"), B: avg("B") };
  const out: { playerId: string; before: number; delta: number; result: SeriesResult }[] = [];
  for (const p of players) {
    const other = p.side === "A" ? "B" : "A";
    const expected = 1 / (1 + 10 ** ((strength[other] - strength[p.side]) / 400));
    const result: SeriesResult = winner === null ? "D" : winner === p.side ? "W" : "L";
    const score = result === "W" ? 1 : result === "D" ? 0.5 : 0;
    const now = get(p.playerId);
    const k = now.series < PLACEMENT_SERIES ? PLACEMENT_K : MMR_K;
    const delta = Math.round(k * (score - expected)) + p.mvp * MVP_BONUS + p.svp * SVP_BONUS;
    out.push({ playerId: p.playerId, before: now.mmr, delta, result });
  }
  // Apply after computing everyone, so the order of players never matters.
  for (const o of out) ratings.set(o.playerId, { mmr: o.before + o.delta, series: get(o.playerId).series + 1 });
  return out;
}

type MatchForMmr = Prisma.MatchGetPayload<{ select: { id: true; teamAId: true; teamBId: true; winnerId: true; playerStats: { select: { playerId: true; teamId: true; award: true } } } }>;

/** Players of a series with their side and awards. A player listed for both sides counts for the first one seen. */
export function seriesPlayers(m: MatchForMmr): SeriesPlayer[] {
  const byId = new Map<string, SeriesPlayer>();
  for (const s of m.playerStats) {
    const side = s.teamId === m.teamAId ? "A" : s.teamId === m.teamBId ? "B" : null;
    if (!side) continue;
    let p = byId.get(s.playerId);
    if (!p) byId.set(s.playerId, (p = { playerId: s.playerId, side, mvp: 0, svp: 0 }));
    if (p.side !== side) continue;
    if (s.award === "MVP") p.mvp++;
    if (s.award === "SVP") p.svp++;
  }
  return [...byId.values()];
}

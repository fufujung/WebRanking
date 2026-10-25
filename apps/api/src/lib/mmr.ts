/**
 * Player MMR scoring of one series. The rules (K, placement, MVP/SVP bonus) and the tiers live in the
 * rankings module (modules/rankings/domain); they are re-exported here for the code that imports them from lib.
 */
import type { Prisma } from "@prisma/client";
import { MMR_K, MVP_BONUS, PLACEMENT_K, PLACEMENT_SERIES, START_MMR, SVP_BONUS, type SeriesResult } from "../modules/rankings/index.js";

export { MMR_K, MVP_BONUS, PLACEMENT_K, PLACEMENT_SERIES, START_MMR, SVP_BONUS, TIERS, tierOf, tierProgress, type SeriesResult, type Tier } from "../modules/rankings/index.js";

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

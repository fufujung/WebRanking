import { buildLadder, MOVEMENT_DAYS } from "../../domain/ladder.js";
import { MMR_K, MVP_BONUS, PLACEMENT_K, PLACEMENT_SERIES, START_MMR, SVP_BONUS } from "../../domain/rules.js";
import { tierCounts } from "../../domain/tiers.js";
import type { LadderSource } from "../ports/ladderSource.js";

export interface LadderDeps {
  source: LadderSource;
  clock: () => Date;
}

/**
 * Every player of a game (or all games) on one board, ranked and placing.
 * The special board ranks the special events' separate rating; everything else about it works the same.
 */
export function makePlayerLadder({ source, clock }: LadderDeps) {
  return async function playerLadder(gameId?: string | null, now = clock(), special = false) {
    const loaded = await source.load({ gameId, board: special ? "special" : "main" });
    const players = special ? loaded.players.map((p) => ({ ...p, mmr: p.specialMmr, peakMmr: p.specialPeakMmr })) : loaded.players;
    return buildLadder({ players, changes: loaded.changes, blacklisted: loaded.blacklistedPlayerIds, now });
  };
}

export type PlayerLadder = ReturnType<typeof makePlayerLadder>;

export interface MmrLadderQuery {
  gameId?: string;
  teamId?: string;
  offset: number;
  limit: number;
}

/**
 * GET /rankings/mmr: one page of ranked players (optionally one team's), the players still placing,
 * how many ranked players are in each tier, and the rating rules.
 */
export function makeMmrLadder(deps: { playerLadder: PlayerLadder }) {
  return async function mmrLadder(q: MmrLadderQuery) {
    const board = await deps.playerLadder(q.gameId);
    const ranked = q.teamId ? board.ranked.filter((p) => p.teamId === q.teamId) : board.ranked;
    const placing = q.teamId ? board.placing.filter((p) => p.teamId === q.teamId) : board.placing;
    return {
      data: ranked.slice(q.offset, q.offset + q.limit),
      total: ranked.length,
      limit: q.limit,
      offset: q.offset,
      placing,
      tiers: tierCounts(ranked),
      rules: { start: START_MMR, k: MMR_K, placementK: PLACEMENT_K, placementSeries: PLACEMENT_SERIES, mvpBonus: MVP_BONUS, svpBonus: SVP_BONUS, movementDays: MOVEMENT_DAYS },
    };
  };
}

export type MmrLadder = ReturnType<typeof makeMmrLadder>;

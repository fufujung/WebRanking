/**
 * Rankings module: player MMR ladders and the tier list.
 * Other code uses only what this file exports; the folders inside are the module's own.
 */
import type { PrismaClient } from "@prisma/client";
import { mmrLadderRoute } from "./adapters/inbound/http/mmrLadderRoute.js";
import { prismaLadderSource } from "./adapters/outbound/prisma/prismaLadderSource.js";
import type { LadderSource } from "./application/ports/ladderSource.js";
import { makeMmrLadder, makePlayerLadder } from "./application/use-cases/playerLadder.js";

export { FORM_LENGTH, MOVEMENT_DAYS, rankMap, withRanks } from "./domain/ladder.js";
export { MMR_K, MVP_BONUS, PLACEMENT_K, PLACEMENT_SERIES, START_MMR, SVP_BONUS, type SeriesResult } from "./domain/rules.js";
export { TIERS, tierCounts, tierInfo, tierOf, tierProgress, type Tier } from "./domain/tiers.js";
export type { LadderSource } from "./application/ports/ladderSource.js";

/** Builds the module. Pass `source` to read from somewhere other than Prisma (tests). */
export function createRankingsModule(deps: { prisma: PrismaClient; clock?: () => Date; source?: LadderSource }) {
  const playerLadder = makePlayerLadder({ source: deps.source ?? prismaLadderSource(deps.prisma), clock: deps.clock ?? (() => new Date()) });
  const mmrLadder = makeMmrLadder({ playerLadder });
  return {
    playerLadder,
    mmrLadder,
    http: { mmrLadder: mmrLadderRoute(mmrLadder) },
  };
}

export type RankingsModule = ReturnType<typeof createRankingsModule>;

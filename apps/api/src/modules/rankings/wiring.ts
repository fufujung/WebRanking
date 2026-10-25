/**
 * Builds the rankings module with its real adapters (Prisma in, Express out).
 * Only the composition root (bootstrap/) imports this file; everything else uses index.ts.
 */
import type { PrismaClient } from "@prisma/client";
import { mmrLadderRoute } from "./adapters/inbound/http/mmrLadderRoute.js";
import { prismaLadderSource } from "./adapters/outbound/prisma/prismaLadderSource.js";
import type { LadderSource } from "./application/ports/ladderSource.js";
import { makeMmrLadder, makePlayerLadder } from "./application/use-cases/playerLadder.js";

/** `source` replaces the Prisma adapter (tests); then no Prisma client is needed. */
export function createRankingsModule(deps: { prisma: PrismaClient; clock?: () => Date } | { source: LadderSource; clock?: () => Date }) {
  const source = "source" in deps ? deps.source : prismaLadderSource(deps.prisma);
  const playerLadder = makePlayerLadder({ source, clock: deps.clock ?? (() => new Date()) });
  const mmrLadder = makeMmrLadder({ playerLadder });
  return {
    playerLadder,
    mmrLadder,
    http: { mmrLadder: mmrLadderRoute(mmrLadder) },
  };
}

export type RankingsModule = ReturnType<typeof createRankingsModule>;

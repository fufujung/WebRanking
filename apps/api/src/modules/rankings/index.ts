/**
 * Rankings module: player MMR ladders and the tier list.
 * This file is the module's public API: rules, use cases and the port they need, with no database or
 * HTTP code, so anything can use it without pulling in Prisma or Express. Building the module with
 * its real adapters is in wiring.ts, which only the composition root (bootstrap/) imports.
 */
export { FORM_LENGTH, MOVEMENT_DAYS, rankMap, withRanks } from "./domain/ladder.js";
export { MMR_K, MVP_BONUS, PLACEMENT_K, PLACEMENT_SERIES, START_MMR, SVP_BONUS, type SeriesResult } from "./domain/rules.js";
export { TIERS, tierCounts, tierInfo, tierOf, tierProgress, type Tier } from "./domain/tiers.js";
export type { LadderSource } from "./application/ports/ladderSource.js";
export { makeMmrLadder, makePlayerLadder, type MmrLadder, type PlayerLadder } from "./application/use-cases/playerLadder.js";

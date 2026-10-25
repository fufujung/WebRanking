/** MMR boards for players and teams: tier, recent form and how far each moved in the last week. */
import { rankingsModule } from "../bootstrap/container.js";
import { FORM_LENGTH, MOVEMENT_DAYS, rankMap, tierInfo, type SeriesResult } from "../modules/rankings/index.js";
import { prisma } from "./db.js";

export { MOVEMENT_DAYS, tierCounts, tierInfo, withRanks } from "../modules/rankings/index.js";

/**
 * Every player with their MMR, tier, series played, last five results (newest first),
 * the change from their latest series, and rank movement over the last week.
 * Players need PLACEMENT_SERIES series to be ranked; the rest are still placing.
 * special = true gives the same board for the special events' separate rating.
 * Built by the rankings module; kept here for the callers that have not moved to it yet.
 */
export function playerBoard(gameId?: string | null, now = new Date(), special = false) {
  return rankingsModule.playerLadder(gameId, now, special);
}

/** Rank movement, form and tier for every team, keyed by team id. */
export async function teamMovement(gameId?: string | null, now = new Date()) {
  const since = new Date(now.getTime() - MOVEMENT_DAYS * 86400_000);
  const [teams, matches] = await Promise.all([
    prisma.team.findMany({ where: gameId ? { gameId } : {}, select: { id: true, rating: true } }),
    prisma.match.findMany({
      where: { tournament: { special: false } },
      select: { teamAId: true, teamBId: true, winnerId: true, ratingDeltaA: true, ratingDeltaB: true, playedAt: true },
      orderBy: [{ playedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const info = new Map(teams.map((t) => [t.id, { recentDelta: 0, before: 0, form: [] as SeriesResult[], lastDelta: null as number | null }]));
  for (const m of matches) {
    for (const [id, delta] of [[m.teamAId, m.ratingDeltaA], [m.teamBId, m.ratingDeltaB]] as const) {
      const i = info.get(id);
      if (!i) continue;
      if (i.lastDelta === null) i.lastDelta = delta;
      if (i.form.length < FORM_LENGTH) i.form.push(m.winnerId === null ? "D" : m.winnerId === id ? "W" : "L");
      if (m.playedAt >= since) i.recentDelta += delta;
      else i.before++;
    }
  }
  const nowRanks = rankMap(teams, (t) => t.rating);
  const then = teams.filter((t) => info.get(t.id)!.before > 0).map((t) => ({ id: t.id, rating: t.rating - info.get(t.id)!.recentDelta }));
  const thenRanks = rankMap(then, (t) => t.rating);
  return new Map(
    teams.map((t) => {
      const i = info.get(t.id)!;
      const before = thenRanks.get(t.id);
      return [t.id, { ...tierInfo(t.rating), form: i.form, lastDelta: i.lastDelta, rankChange: before === undefined ? null : before - nowRanks.get(t.id)! }];
    }),
  );
}


import { prisma } from "./db.js";

export const START_RATING = 1000;
export const K_FACTOR = 32;

/** Score for team A: 1 = win, 0.5 = draw, 0 = loss. */
export function eloDelta(ratingA: number, ratingB: number, scoreA: number): [number, number] {
  const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  const deltaA = Math.round(K_FACTOR * (scoreA - expectedA));
  return [deltaA, -deltaA];
}

export function winnerOf(teamAId: string, teamBId: string, scoreA: number, scoreB: number) {
  if (scoreA > scoreB) return teamAId;
  if (scoreB > scoreA) return teamBId;
  return null;
}

/**
 * Replays every match in chronological order and rewrites all ratings.
 * Recomputing from scratch keeps ratings correct after edits, deletions or
 * matches recorded out of order.
 */
let queue: Promise<void> = Promise.resolve();

/** Serialises recomputations so concurrent writes can't interleave rating updates. */
export function recomputeRatings(): Promise<void> {
  const run = queue.then(replayAllMatches);
  queue = run.catch(() => {});
  return run;
}

async function replayAllMatches() {
  const [teams, matches] = await Promise.all([
    prisma.team.findMany({ select: { id: true } }),
    prisma.match.findMany({ orderBy: [{ playedAt: "asc" }, { createdAt: "asc" }] }),
  ]);
  const ratings = new Map(teams.map((t) => [t.id, START_RATING]));
  const matchUpdates = [];

  for (const m of matches) {
    const ra = ratings.get(m.teamAId) ?? START_RATING;
    const rb = ratings.get(m.teamBId) ?? START_RATING;
    const scoreA = m.winnerId === null ? 0.5 : m.winnerId === m.teamAId ? 1 : 0;
    const [da, db] = eloDelta(ra, rb, scoreA);
    ratings.set(m.teamAId, ra + da);
    ratings.set(m.teamBId, rb + db);
    if (m.ratingDeltaA !== da || m.ratingDeltaB !== db) {
      matchUpdates.push(
        prisma.match.update({ where: { id: m.id }, data: { ratingDeltaA: da, ratingDeltaB: db } }),
      );
    }
  }

  await prisma.$transaction([
    ...matchUpdates,
    ...[...ratings].map(([id, rating]) =>
      prisma.team.update({ where: { id }, data: { rating } }),
    ),
  ]);
}

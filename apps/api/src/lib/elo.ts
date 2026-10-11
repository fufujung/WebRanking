import { prisma } from "./db.js";
import { scoreSeries, seriesPlayers, START_MMR } from "./mmr.js";

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
  const [teams, players, matches, oldChanges] = await Promise.all([
    prisma.team.findMany({ select: { id: true, rating: true } }),
    prisma.player.findMany({ select: { id: true, mmr: true, peakMmr: true } }),
    prisma.match.findMany({
      orderBy: [{ playedAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, teamAId: true, teamBId: true, winnerId: true, ratingDeltaA: true, ratingDeltaB: true,
        playerStats: { select: { playerId: true, teamId: true, award: true } },
      },
    }),
    prisma.playerMmrChange.findMany({ select: { id: true, playerId: true, matchId: true, before: true, delta: true, result: true } }),
  ]);
  const ratings = new Map(teams.map((t) => [t.id, START_RATING]));
  const stored = new Map(teams.map((t) => [t.id, t.rating]));
  const mmr = new Map<string, { mmr: number; series: number }>();
  const peak = new Map<string, number>();
  const matchUpdates = [];
  const changes: { playerId: string; matchId: string; before: number; delta: number; result: string }[] = [];

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

    const winner = m.winnerId === null ? null : m.winnerId === m.teamAId ? "A" : "B";
    for (const c of scoreSeries(seriesPlayers(m), winner, mmr, { A: ra, B: rb })) {
      changes.push({ ...c, matchId: m.id });
      peak.set(c.playerId, Math.max(peak.get(c.playerId) ?? START_MMR, c.before + c.delta));
    }
  }

  // Only write what changed: most replays move a handful of rows.
  const old = new Map(oldChanges.map((c) => [`${c.playerId}:${c.matchId}`, c]));
  const changeWrites = [];
  const fresh = [];
  for (const c of changes) {
    const key = `${c.playerId}:${c.matchId}`;
    const was = old.get(key);
    old.delete(key);
    if (!was) fresh.push(c);
    else if (was.before !== c.before || was.delta !== c.delta || was.result !== c.result) {
      changeWrites.push(prisma.playerMmrChange.update({ where: { id: was.id }, data: { before: c.before, delta: c.delta, result: c.result } }));
    }
  }
  if (old.size) changeWrites.push(prisma.playerMmrChange.deleteMany({ where: { id: { in: [...old.values()].map((c) => c.id) } } }));
  if (fresh.length) changeWrites.push(prisma.playerMmrChange.createMany({ data: fresh }));

  const playerWrites = players
    .map((p) => ({ id: p.id, mmr: mmr.get(p.id)?.mmr ?? START_MMR, peakMmr: peak.get(p.id) ?? START_MMR, was: p }))
    .filter((p) => p.mmr !== p.was.mmr || p.peakMmr !== p.was.peakMmr)
    .map((p) => prisma.player.update({ where: { id: p.id }, data: { mmr: p.mmr, peakMmr: p.peakMmr } }));

  await prisma.$transaction([
    ...matchUpdates,
    ...[...ratings].filter(([id, rating]) => stored.get(id) !== rating)
      .map(([id, rating]) => prisma.team.update({ where: { id }, data: { rating } })),
    ...changeWrites,
    ...playerWrites,
  ]);
}

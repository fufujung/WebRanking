/**
 * Test data for the rankings tests: ties, placement, unplayed players, two games, two teams per
 * filter, movement over the last week, a draw, same-day series, blacklist entries (active, repeated,
 * lifted) and a special-event-only player. Times are 1 or 30 days before `now`, far from the 7-day line.
 */
import type { PrismaClient } from "@prisma/client";

const DAY = 86400_000;

export async function seedLadder(prisma: PrismaClient, now = new Date()) {
  const g1 = await prisma.game.create({ data: { name: "Fixture Game 1" } });
  const g2 = await prisma.game.create({ data: { name: "Fixture Game 2" } });
  const t1 = await prisma.team.create({ data: { name: "Fixture Alpha", tag: "ALP", rating: 1040, gameId: g1.id } });
  const t2 = await prisma.team.create({ data: { name: "Fixture Bravo", rating: 990, gameId: g1.id } });
  const t3 = await prisma.team.create({ data: { name: "Fixture Charlie", gameId: g2.id } });
  const main = await prisma.tournament.create({ data: { name: "Fixture Cup", startDate: new Date(now.getTime() - 40 * DAY), gameId: g1.id } });
  const special = await prisma.tournament.create({ data: { name: "Fixture Special", startDate: new Date(now.getTime() - 40 * DAY), special: true } });

  let tick = 0;
  /** One series for one player; every series is its own match so the (player, match) pair stays unique. */
  async function series(playerId: string, daysAgo: number, delta: number, result: "W" | "L" | "D", opts: { special?: boolean; createdOffsetMs?: number } = {}) {
    const playedAt = new Date(now.getTime() - daysAgo * DAY);
    const match = await prisma.match.create({
      data: {
        tournamentId: opts.special ? special.id : main.id,
        teamAId: t1.id,
        teamBId: t2.id,
        scoreA: 2,
        scoreB: result === "D" ? 2 : 1,
        winnerId: result === "D" ? null : t1.id,
        playedAt,
        createdAt: new Date(playedAt.getTime() + (opts.createdOffsetMs ?? 0) + tick++),
      },
    });
    await prisma.playerMmrChange.create({ data: { playerId, matchId: match.id, before: 1000, delta, result } });
  }
  const player = (name: string, data: Record<string, unknown> = {}) =>
    prisma.player.create({ data: { name, gameId: g1.id, teamId: t1.id, uid: `uid-${name}`, server: "TH", discordId: `d-${name}`, ...data } });

  // A climbs past B, C and D this week.
  const a = await player("Ace", { mmr: 1200, peakMmr: 1210 });
  for (let i = 0; i < 3; i++) await series(a.id, 30, 10, "W");
  await series(a.id, 1, 40, "W");
  const b = await player("Bolt", { mmr: 1180, teamId: t2.id });
  for (let i = 0; i < 3; i++) await series(b.id, 30, 10, "W");
  await series(b.id, 1, -30, "L");
  // C and D tie with B on MMR; B has more series, C and D are split by name.
  const d = await player("Dune", { mmr: 1180 });
  for (let i = 0; i < 3; i++) await series(d.id, 30, 5, "D");
  const c = await player("Cove", { mmr: 1180 });
  for (let i = 0; i < 3; i++) await series(c.id, 30, 5, "L");
  // Still placing: two series on the same day, the later-created one is the latest.
  const e = await player("Echo", { mmr: 1005, teamId: t2.id });
  await series(e.id, 1, 10, "W", { createdOffsetMs: 0 });
  await series(e.id, 1, -5, "L", { createdOffsetMs: 60_000 });
  // Never played.
  await player("Fern", { mmr: 1000 });
  // Other game, blacklisted twice (still one flag).
  const g = await player("Gale", { mmr: 950, gameId: g2.id, teamId: t3.id });
  for (let i = 0; i < 3; i++) await series(g.id, 1, -15, "L");
  await prisma.blacklistEntry.create({ data: { playerId: g.id, reason: "no-show 1" } });
  await prisma.blacklistEntry.create({ data: { playerId: g.id, reason: "no-show 2", source: "ADMIN" } });
  // A lifted entry does not flag.
  const h = await player("Hale", { mmr: 880, teamId: null });
  for (let i = 0; i < 3; i++) await series(h.id, 30, -40, "L");
  await prisma.blacklistEntry.create({ data: { playerId: h.id, reason: "old", liftedAt: new Date(now.getTime() - 2 * DAY) } });
  // Only special-event series: unplayed on the main board, ranked on the special one.
  const i = await player("Iris", { specialMmr: 1300, specialPeakMmr: 1310 });
  for (let k = 0; k < 3; k++) await series(i.id, 1, 20, "W", { special: true });
  // Filler so paging has several pages.
  for (const [n, mmr] of [["Jade", 1060], ["Kite", 1130], ["Lynx", 990], ["Moss", 1310]] as const) {
    const p = await player(n, { mmr, teamId: t2.id });
    for (let k = 0; k < 3; k++) await series(p.id, 30, 1, "W");
  }
  return { g1, g2, t1, t2, t3, ids: { a: a.id, b: b.id, c: c.id, d: d.id, e: e.id, g: g.id, h: h.id, i: i.id } };
}

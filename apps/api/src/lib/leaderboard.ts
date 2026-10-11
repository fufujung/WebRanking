/** MMR boards for players and teams: tier, recent form and how far each moved in the last week. */
import { prisma } from "./db.js";
import { PLACEMENT_SERIES, tierProgress, TIERS, type SeriesResult } from "./mmr.js";
import { teamSummary } from "./selects.js";

/** Rank movement is measured against this many days ago. */
export const MOVEMENT_DAYS = 7;
const FORM_LENGTH = 5;

/** Competition ranking: equal values share a rank (1, 2, 2, 4 …). */
export function withRanks<T>(rows: T[], value: (row: T) => number) {
  let rank = 0;
  return rows.map((row, i) => {
    if (i === 0 || value(row) !== value(rows[i - 1])) rank = i + 1;
    return { rank, ...row };
  });
}

function rankMap<T extends { id: string }>(rows: T[], value: (row: T) => number) {
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  return new Map(withRanks(sorted, value).map((r) => [r.id, r.rank]));
}

const tierInfo = (rating: number) => {
  const { tier, progress, toNext } = tierProgress(rating);
  return { tier, tierProgress: progress, toNextTier: toNext };
};

/**
 * Every player with their MMR, tier, series played, last five results (newest first),
 * the change from their latest series, and rank movement over the last week.
 * Players need PLACEMENT_SERIES series to be ranked; the rest are still placing.
 */
export async function playerBoard(now = new Date()) {
  const since = new Date(now.getTime() - MOVEMENT_DAYS * 86400_000);
  const [players, changes] = await Promise.all([
    prisma.player.findMany({ include: { team: teamSummary } }),
    prisma.playerMmrChange.findMany({
      select: { playerId: true, delta: true, result: true, match: { select: { playedAt: true } } },
      orderBy: [{ match: { playedAt: "desc" } }, { match: { createdAt: "desc" } }],
    }),
  ]);
  const empty = () => ({ series: 0, wins: 0, losses: 0, seriesBefore: 0, recentDelta: 0, form: [] as SeriesResult[], lastDelta: null as number | null });
  const info = new Map<string, ReturnType<typeof empty>>();
  for (const c of changes) {
    let i = info.get(c.playerId);
    if (!i) info.set(c.playerId, (i = empty()));
    i.series++;
    if (c.result === "W") i.wins++;
    if (c.result === "L") i.losses++;
    if (i.lastDelta === null) i.lastDelta = c.delta;
    if (i.form.length < FORM_LENGTH) i.form.push(c.result as SeriesResult);
    if (c.match.playedAt >= since) i.recentDelta += c.delta;
    else i.seriesBefore++;
  }
  const rows = players.map((p) => {
    const i = info.get(p.id) ?? empty();
    return { ...p, ...tierInfo(p.mmr), series: i.series, wins: i.wins, losses: i.losses, placed: i.series >= PLACEMENT_SERIES, form: i.form, lastDelta: i.lastDelta, weekAgo: { mmr: p.mmr - i.recentDelta, placed: i.seriesBefore >= PLACEMENT_SERIES } };
  });
  const rankedNow = rows.filter((r) => r.placed);
  const nowRanks = rankMap(rankedNow, (r) => r.mmr);
  const thenRanks = rankMap(rows.filter((r) => r.weekAgo.placed), (r) => r.weekAgo.mmr);
  const order = (a: (typeof rows)[number], b: (typeof rows)[number]) => b.mmr - a.mmr || b.series - a.series || a.name.localeCompare(b.name);
  const ranked = withRanks(rankedNow.sort(order), (r) => r.mmr).map(({ weekAgo, ...r }) => {
    const before = thenRanks.get(r.id);
    return { ...r, rankChange: before === undefined ? null : before - nowRanks.get(r.id)! };
  });
  const placing = rows.filter((r) => !r.placed && r.series > 0).sort(order).map(({ weekAgo, ...r }) => ({ ...r, seriesToPlace: PLACEMENT_SERIES - r.series }));
  return { ranked, placing, unplayed: rows.filter((r) => r.series === 0).length };
}

/** How many ranked players sit in each tier, lowest tier first. */
export function tierCounts(rows: { tier: { key: string } }[]) {
  return TIERS.map((t) => ({ ...t, players: rows.filter((r) => r.tier.key === t.key).length }));
}

/** Rank movement, form and tier for every team, keyed by team id. */
export async function teamMovement(now = new Date()) {
  const since = new Date(now.getTime() - MOVEMENT_DAYS * 86400_000);
  const [teams, matches] = await Promise.all([
    prisma.team.findMany({ select: { id: true, rating: true } }),
    prisma.match.findMany({
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

export { tierInfo };

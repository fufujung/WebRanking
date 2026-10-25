/**
 * Test oracle only: GET /rankings/mmr exactly as it was before the rankings module (commit 9b0ac22,
 * routes/rankings.ts + lib/leaderboard.ts playerBoard + the tier code of lib/mmr.ts), frozen here so
 * the contract test can compare the new path with the old one on the same database.
 * Never import this from app code, and never "fix" it: it is the reference.
 */
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

type SeriesResult = "W" | "L" | "D";
const START_MMR = 1000;
const MMR_K = 32;
const PLACEMENT_K = 48;
const PLACEMENT_SERIES = 3;
const MVP_BONUS = 2;
const SVP_BONUS = 1;
const MOVEMENT_DAYS = 7;
const FORM_LENGTH = 5;

const TIERS = (
  [
    ["bronze", "Bronze", "บรอนซ์", "#cd7f32", 0],
    ["silver", "Silver", "ซิลเวอร์", "#b8c2cc", 900],
    ["gold", "Gold", "โกลด์", "#f5b400", 975],
    ["platinum", "Platinum", "แพลทินัม", "#35d0c0", 1050],
    ["diamond", "Diamond", "ไดมอนด์", "#4da3ff", 1125],
    ["master", "Master", "มาสเตอร์", "#b26bff", 1200],
    ["legend", "Legend", "เลเจนด์", "#ff2d3d", 1300],
  ] as const
).map(([key, name, nameTh, color, min], i, all) => ({ key, name, nameTh, color, min, next: all[i + 1]?.[4] ?? null }));

function tierOf(mmr: number) {
  let tier = TIERS[0];
  for (const t of TIERS) if (mmr >= t.min) tier = t;
  return tier;
}

function tierProgress(mmr: number) {
  const t = tierOf(mmr);
  if (t.next === null) return { tier: t, progress: 100, toNext: 0 };
  const floor = t.key === "bronze" ? Math.min(mmr, t.next - 100) : t.min;
  const progress = Math.round(((mmr - floor) / (t.next - floor)) * 100);
  return { tier: t, progress: Math.max(0, Math.min(100, progress)), toNext: t.next - mmr };
}

function withRanks<T>(rows: T[], value: (row: T) => number) {
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

async function playerBoard(prisma: PrismaClient, gameId?: string | null, now = new Date(), special = false) {
  const since = new Date(now.getTime() - MOVEMENT_DAYS * 86400_000);
  const [found, changes, blacklisted] = await Promise.all([
    prisma.player.findMany({ where: gameId ? { gameId } : {}, include: { team: { select: { id: true, name: true, tag: true, logoUrl: true, rating: true } } } }),
    prisma.playerMmrChange.findMany({
      where: { match: { tournament: { special } } },
      select: { playerId: true, delta: true, result: true, match: { select: { playedAt: true } } },
      orderBy: [{ match: { playedAt: "desc" } }, { match: { createdAt: "desc" } }],
    }),
    prisma.blacklistEntry.findMany({ where: { liftedAt: null }, select: { playerId: true }, distinct: ["playerId"] }),
  ]);
  const players = special ? found.map((p) => ({ ...p, mmr: p.specialMmr, peakMmr: p.specialPeakMmr })) : found;
  const banned = new Set(blacklisted.map((b) => b.playerId));
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
    return { ...p, ...tierInfo(p.mmr), blacklisted: banned.has(p.id), series: i.series, wins: i.wins, losses: i.losses, placed: i.series >= PLACEMENT_SERIES, form: i.form, lastDelta: i.lastDelta, weekAgo: { mmr: p.mmr - i.recentDelta, placed: i.seriesBefore >= PLACEMENT_SERIES } };
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
  return { ranked, placing };
}

/** The old handler's body, given the already-parsed query. */
export async function legacyMmrLadder(prisma: PrismaClient, q: { limit: number; offset: number; teamId?: string; gameId?: string }) {
  const board = await playerBoard(prisma, q.gameId);
  const ranked = q.teamId ? board.ranked.filter((p) => p.teamId === q.teamId) : board.ranked;
  const placing = q.teamId ? board.placing.filter((p) => p.teamId === q.teamId) : board.placing;
  return {
    data: ranked.slice(q.offset, q.offset + q.limit),
    total: ranked.length,
    limit: q.limit,
    offset: q.offset,
    placing,
    tiers: TIERS.map((t) => ({ ...t, players: ranked.filter((r) => r.tier.key === t.key).length })),
    rules: { start: START_MMR, k: MMR_K, placementK: PLACEMENT_K, placementSeries: PLACEMENT_SERIES, mvpBonus: MVP_BONUS, svpBonus: SVP_BONUS, movementDays: MOVEMENT_DAYS },
  };
}

/** The old query validation (lib/validate.ts pagination + the route's teamId and gameId). */
export const legacyMmrQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  teamId: z.string().optional(),
  gameId: z.string().trim().min(1).max(40).optional(),
});

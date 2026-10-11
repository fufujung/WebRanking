import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { emptyPlayerStats, emptyTeamStats, statLineSelect, statsByPlayer, statsByTeam, type PlayerStats } from "../lib/stats.js";
import { pagination } from "../lib/validate.js";
import { teamSummary } from "../lib/selects.js";
import { MOVEMENT_DAYS, playerBoard, teamMovement, tierCounts, tierInfo, withRanks } from "../lib/leaderboard.js";
import { MMR_K, MVP_BONUS, PLACEMENT_K, PLACEMENT_SERIES, START_MMR, SVP_BONUS, TIERS } from "../lib/mmr.js";

export const rankings = Router();

/** ?gameId= limits a board to one game; without it every game is mixed (older clients). */
const gameId = z.string().trim().min(1).max(40).optional();

rankings.get("/teams", async (req, res) => {
  const q = pagination.extend({ minMatches: z.coerce.number().int().min(0).default(0), gameId }).parse(req.query);
  const [teams, allMatches, titles, movement] = await Promise.all([
    prisma.team.findMany({ where: q.gameId ? { gameId: q.gameId } : {}, orderBy: [{ rating: "desc" }, { name: "asc" }] }),
    prisma.match.findMany({ select: { teamAId: true, teamBId: true, scoreA: true, scoreB: true, winnerId: true } }),
    prisma.tournamentEntry.groupBy({ by: ["teamId"], where: { placement: 1 }, _count: true }),
    teamMovement(q.gameId),
  ]);
  const stats = statsByTeam(allMatches);
  const titleCount = new Map(titles.map((t) => [t.teamId, t._count]));
  const rows = teams
    .map((t) => ({ ...t, ...movement.get(t.id)!, stats: { ...(stats.get(t.id) ?? emptyTeamStats()), titles: titleCount.get(t.id) ?? 0 } }))
    .filter((t) => t.stats.matches >= q.minMatches);
  const data = withRanks(rows, (t) => t.rating);
  res.json({ data: data.slice(q.offset, q.offset + q.limit), total: data.length, limit: q.limit, offset: q.offset });
});

const playerSorts = ["mmr", "pts", "ppg", "avgRating", "reb", "ast", "blk", "stl", "lbr", "mvp", "wins", "winRate", "games"] as const;

rankings.get("/players", async (req, res) => {
  const q = pagination
    .extend({
      sort: z.enum(playerSorts).default("pts"),
      minGames: z.coerce.number().int().min(0).optional(),
      /** Older name for minGames. */
      minMatches: z.coerce.number().int().min(0).optional(),
      teamId: z.string().optional(),
      gameId,
    })
    .parse(req.query);
  const [players, lines] = await Promise.all([
    prisma.player.findMany({ where: { ...(q.teamId ? { teamId: q.teamId } : {}), ...(q.gameId ? { gameId: q.gameId } : {}) }, include: { team: teamSummary } }),
    prisma.matchPlayerStat.findMany({ select: statLineSelect }),
  ]);
  const stats = statsByPlayer(lines);
  const value = (p: { mmr: number; stats: PlayerStats }) => (q.sort === "mmr" ? p.mmr : p.stats[q.sort as keyof PlayerStats]);
  const rows = players
    .map((p) => ({ ...p, ...tierInfo(p.mmr), stats: stats.get(p.id) ?? emptyPlayerStats() }))
    .filter((p) => p.stats.games >= (q.minGames ?? q.minMatches ?? 0))
    .sort((a, b) => value(b) - value(a) || b.stats.pts - a.stats.pts || a.name.localeCompare(b.name));
  const data = withRanks(rows, value);
  res.json({ data: data.slice(q.offset, q.offset + q.limit), total: data.length, limit: q.limit, offset: q.offset, sort: q.sort });
});

/**
 * The MMR ladder: ranked players (PLACEMENT_SERIES series or more) by MMR with tier, form and
 * rank movement; players still placing; tier list and how many players are in each tier.
 */
rankings.get("/mmr", async (req, res) => {
  const q = pagination.extend({ teamId: z.string().optional(), gameId }).parse(req.query);
  const board = await playerBoard(q.gameId);
  const ranked = q.teamId ? board.ranked.filter((p) => p.teamId === q.teamId) : board.ranked;
  const placing = q.teamId ? board.placing.filter((p) => p.teamId === q.teamId) : board.placing;
  res.json({
    data: ranked.slice(q.offset, q.offset + q.limit),
    total: ranked.length,
    limit: q.limit,
    offset: q.offset,
    placing,
    tiers: tierCounts(ranked),
    rules: { start: START_MMR, k: MMR_K, placementK: PLACEMENT_K, placementSeries: PLACEMENT_SERIES, mvpBonus: MVP_BONUS, svpBonus: SVP_BONUS, movementDays: MOVEMENT_DAYS },
  });
});

/** The tier list on its own, lowest first: name, colour and MMR range. */
rankings.get("/tiers", (_req, res) => {
  res.json({ data: TIERS });
});

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { emptyPlayerStats, emptyTeamStats, statLineSelect, statsByPlayer, statsByTeam, type PlayerStats } from "../lib/stats.js";
import { pagination } from "../lib/validate.js";
import { teamSummary } from "../lib/selects.js";

export const rankings = Router();

/** Competition ranking: equal values share a rank (1, 2, 2, 4 …). */
function withRanks<T>(rows: T[], value: (row: T) => number) {
  let rank = 0;
  return rows.map((row, i) => {
    if (i === 0 || value(row) !== value(rows[i - 1])) rank = i + 1;
    return { rank, ...row };
  });
}

rankings.get("/teams", async (req, res) => {
  const q = pagination.extend({ minMatches: z.coerce.number().int().min(0).default(0) }).parse(req.query);
  const [teams, allMatches, titles] = await Promise.all([
    prisma.team.findMany({ orderBy: [{ rating: "desc" }, { name: "asc" }] }),
    prisma.match.findMany({ select: { teamAId: true, teamBId: true, scoreA: true, scoreB: true, winnerId: true } }),
    prisma.tournamentEntry.groupBy({ by: ["teamId"], where: { placement: 1 }, _count: true }),
  ]);
  const stats = statsByTeam(allMatches);
  const titleCount = new Map(titles.map((t) => [t.teamId, t._count]));
  const rows = teams
    .map((t) => ({ ...t, stats: { ...(stats.get(t.id) ?? emptyTeamStats()), titles: titleCount.get(t.id) ?? 0 } }))
    .filter((t) => t.stats.matches >= q.minMatches);
  const data = withRanks(rows, (t) => t.rating);
  res.json({ data: data.slice(q.offset, q.offset + q.limit), total: data.length, limit: q.limit, offset: q.offset });
});

const playerSorts = ["pts", "ppg", "avgRating", "reb", "ast", "blk", "stl", "lbr", "mvp", "wins", "winRate", "games"] as const;

rankings.get("/players", async (req, res) => {
  const q = pagination
    .extend({
      sort: z.enum(playerSorts).default("pts"),
      minGames: z.coerce.number().int().min(0).optional(),
      /** Older name for minGames. */
      minMatches: z.coerce.number().int().min(0).optional(),
      teamId: z.string().optional(),
    })
    .parse(req.query);
  const [players, lines] = await Promise.all([
    prisma.player.findMany({ where: q.teamId ? { teamId: q.teamId } : {}, include: { team: teamSummary } }),
    prisma.matchPlayerStat.findMany({ select: statLineSelect }),
  ]);
  const stats = statsByPlayer(lines);
  const key = q.sort as keyof PlayerStats;
  const rows = players
    .map((p) => ({ ...p, stats: stats.get(p.id) ?? emptyPlayerStats() }))
    .filter((p) => p.stats.games >= (q.minGames ?? q.minMatches ?? 0))
    .sort((a, b) => b.stats[key] - a.stats[key] || b.stats.pts - a.stats.pts || a.name.localeCompare(b.name));
  const data = withRanks(rows, (p) => p.stats[key]);
  res.json({ data: data.slice(q.offset, q.offset + q.limit), total: data.length, limit: q.limit, offset: q.offset, sort: q.sort });
});

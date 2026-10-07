import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { emptyPlayerStats, emptyTeamStats, statsByPlayer, statsByTeam, type PlayerStats } from "../lib/stats.js";
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

const playerSorts = ["score", "kills", "kda", "wins", "winRate", "avgScore", "assists"] as const;

rankings.get("/players", async (req, res) => {
  const q = pagination
    .extend({
      sort: z.enum(playerSorts).default("score"),
      minMatches: z.coerce.number().int().min(0).default(0),
      teamId: z.string().optional(),
    })
    .parse(req.query);
  const [players, lines] = await Promise.all([
    prisma.player.findMany({ where: q.teamId ? { teamId: q.teamId } : {}, include: { team: teamSummary } }),
    prisma.matchPlayerStat.findMany({
      select: { playerId: true, teamId: true, kills: true, deaths: true, assists: true, score: true, match: { select: { winnerId: true } } },
    }),
  ]);
  const stats = statsByPlayer(lines);
  const key = q.sort as keyof PlayerStats;
  const rows = players
    .map((p) => ({ ...p, stats: stats.get(p.id) ?? emptyPlayerStats() }))
    .filter((p) => p.stats.matches >= q.minMatches)
    .sort((a, b) => b.stats[key] - a.stats[key] || b.stats.score - a.stats.score || a.name.localeCompare(b.name));
  const data = withRanks(rows, (p) => p.stats[key]);
  res.json({ data: data.slice(q.offset, q.offset + q.limit), total: data.length, limit: q.limit, offset: q.offset, sort: q.sort });
});

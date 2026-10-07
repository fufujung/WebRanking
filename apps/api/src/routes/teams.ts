import { Router } from "express";
import { prisma } from "../lib/db.js";
import { notFound } from "../lib/errors.js";
import { recomputeRatings } from "../lib/elo.js";
import { emptyPlayerStats, emptyTeamStats, statLineSelect, statsByPlayer, statsByTeam } from "../lib/stats.js";
import { searchQuery, teamInput } from "../lib/validate.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { matchInclude, matchOrder } from "../lib/selects.js";

export const teams = Router();

teams.get("/", async (req, res) => {
  const q = searchQuery.parse(req.query);
  const where = q.search ? { OR: [{ name: { contains: q.search } }, { tag: { contains: q.search } }] } : {};
  const [rows, total] = await Promise.all([
    prisma.team.findMany({
      where,
      orderBy: { name: "asc" },
      take: q.limit,
      skip: q.offset,
      include: { _count: { select: { players: true } } },
    }),
    prisma.team.count({ where }),
  ]);
  const data = rows.map(({ _count, ...t }) => ({ ...t, playerCount: _count.players }));
  res.json({ data, total, limit: q.limit, offset: q.offset });
});

teams.post("/", requireAdmin, async (req, res) => {
  const team = await prisma.team.create({ data: teamInput.parse(req.body) });
  res.status(201).json(team);
});

teams.get("/:id", async (req, res) => {
  const team = await prisma.team.findUnique({
    where: { id: String(req.params.id) },
    include: {
      players: { orderBy: { name: "asc" } },
      entries: { include: { tournament: true }, orderBy: { tournament: { startDate: "desc" } } },
    },
  });
  if (!team) throw notFound("Team");

  const [matches, lines, higher] = await Promise.all([
    prisma.match.findMany({
      where: { OR: [{ teamAId: team.id }, { teamBId: team.id }] },
      orderBy: matchOrder,
      include: matchInclude,
    }),
    prisma.matchPlayerStat.findMany({
      where: { playerId: { in: team.players.map((p) => p.id) } },
      select: statLineSelect,
    }),
    prisma.team.count({ where: { rating: { gt: team.rating } } }),
  ]);
  const playerStats = statsByPlayer(lines);
  const { entries, players, ...rest } = team;
  res.json({
    ...rest,
    rank: higher + 1,
    stats: {
      ...(statsByTeam(matches).get(team.id) ?? emptyTeamStats()),
      tournaments: entries.length,
      titles: entries.filter((e) => e.placement === 1).length,
      podiums: entries.filter((e) => e.placement !== null && e.placement <= 3).length,
    },
    players: players.map((p) => ({ ...p, stats: playerStats.get(p.id) ?? emptyPlayerStats() })),
    tournaments: entries.map((e) => ({ placement: e.placement, tournament: e.tournament })),
    recentMatches: matches.slice(0, 20),
  });
});

teams.patch("/:id", requireAdmin, async (req, res) => {
  const team = await prisma.team.update({ where: { id: String(req.params.id) }, data: teamInput.partial().parse(req.body) });
  res.json(team);
});

teams.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.team.delete({ where: { id: String(req.params.id) } });
  await recomputeRatings();
  res.status(204).end();
});

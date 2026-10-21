import { Router } from "express";
import { z } from "zod";
import { newCode } from "../lib/teamSelf.js";
import { gameIdOrNull } from "../lib/games.js";
import { prisma } from "../lib/db.js";
import { fail, notFound } from "../lib/errors.js";
import { recomputeRatings } from "../lib/elo.js";
import { emptyPlayerStats, emptyTeamStats, statLineSelect, statsByPlayer, statsByTeam } from "../lib/stats.js";
import { searchQuery, teamInput } from "../lib/validate.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { matchInclude, matchOrder } from "../lib/selects.js";
import { teamMovement, tierInfo } from "../lib/leaderboard.js";

export const teams = Router();

teams.get("/", async (req, res) => {
  const q = searchQuery.extend({ gameId: z.string().trim().min(1).optional() }).parse(req.query);
  const where = {
    ...(q.search ? { OR: [{ name: { contains: q.search } }, { tag: { contains: q.search } }] } : {}),
    ...(q.gameId ? { gameId: q.gameId } : {}),
  };
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
  const input = teamInput.parse(req.body);
  if (input.gameId !== undefined) input.gameId = await gameIdOrNull(prisma, input.gameId);
  const team = await prisma.team.create({ data: input });
  res.status(201).json(team);
});

teams.get("/:id", async (req, res) => {
  const team = await prisma.team.findUnique({
    where: { id: String(req.params.id) },
    include: {
      players: { orderBy: { name: "asc" } },
      game: { select: { id: true, name: true } },
      entries: { include: { tournament: true }, orderBy: { tournament: { startDate: "desc" } } },
    },
  });
  if (!team) throw notFound("Team");
  // A team drawn for a SOLO tournament has no players of its own: show who played for it.
  if (!team.players.length && team.entries.length) {
    team.players = await prisma.player.findMany({ where: { rosters: { some: { entry: { teamId: team.id } } } }, orderBy: { name: "asc" } });
  }

  const [matches, lines, higher, movement] = await Promise.all([
    prisma.match.findMany({
      where: { OR: [{ teamAId: team.id }, { teamBId: team.id }] },
      orderBy: matchOrder,
      include: matchInclude,
    }),
    prisma.matchPlayerStat.findMany({
      where: { playerId: { in: team.players.map((p) => p.id) } },
      select: statLineSelect,
    }),
    prisma.team.count({ where: { rating: { gt: team.rating }, ...(team.gameId ? { gameId: team.gameId } : {}) } }),
    teamMovement(team.gameId),
  ]);
  const playerStats = statsByPlayer(lines);
  const { entries, players, ...rest } = team;
  res.json({
    ...rest,
    rank: higher + 1,
    ...tierInfo(team.rating),
    form: movement.get(team.id)?.form ?? [],
    rankChange: movement.get(team.id)?.rankChange ?? null,
    stats: {
      ...(statsByTeam(matches).get(team.id) ?? emptyTeamStats()),
      tournaments: entries.length,
      titles: entries.filter((e) => e.placement === 1).length,
      podiums: entries.filter((e) => e.placement !== null && e.placement <= 3).length,
    },
    players: players
      .map((p) => ({ ...p, ...tierInfo(p.mmr), stats: playerStats.get(p.id) ?? emptyPlayerStats() }))
      .sort((a, b) => b.mmr - a.mmr || a.name.localeCompare(b.name)),
    tournaments: entries.map((e) => ({ placement: e.placement, tournament: e.tournament })),
    recentMatches: matches.slice(0, 20),
  });
});

teams.patch("/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const { captainId, ...input } = teamInput.extend({ captainId: z.string().trim().nullish().transform((v) => (v === undefined ? undefined : v || null)) }).partial().parse(req.body);
  if (input.gameId !== undefined) input.gameId = await gameIdOrNull(prisma, input.gameId);
  if (captainId) {
    const member = await prisma.player.findUnique({ where: { id: captainId }, select: { teamId: true } });
    if (member?.teamId !== id) throw fail(400, "The captain must be on the team", "หัวหน้าทีมต้องเป็นผู้เล่นในทีมนี้");
  }
  if (input.name) {
    const taken = await prisma.team.findFirst({ where: { name: input.name, id: { not: id } }, select: { id: true } });
    if (taken) throw fail(409, "A team with this name exists", `มีทีมชื่อ "${input.name}" อยู่แล้ว ใช้ชื่ออื่น`);
  }
  const team = await prisma.team.update({ where: { id }, data: { ...input, ...(captainId !== undefined ? { captainId } : {}) } });
  res.json(team);
});

/** The team's invite code (made on first use), for organizers to share. ?new=1 makes a new one. */
teams.get("/:id/invite", requireAdmin, async (req, res) => {
  const teamId = String(req.params.id);
  if (!(await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } }))) throw notFound("Team");
  const current = await prisma.teamInvite.findUnique({ where: { teamId } });
  if (current && req.query.new !== "1") return void res.json({ code: current.code });
  const code = newCode();
  await prisma.teamInvite.upsert({ where: { teamId }, create: { teamId, code }, update: { code, createdAt: new Date() } });
  res.json({ code });
});

teams.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.team.delete({ where: { id: String(req.params.id) } });
  await recomputeRatings();
  res.status(204).end();
});

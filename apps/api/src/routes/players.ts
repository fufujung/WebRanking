import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { notFound } from "../lib/errors.js";
import { emptyPlayerStats, statsByPlayer } from "../lib/stats.js";
import { playerInput, searchQuery } from "../lib/validate.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { matchInclude, teamSummary } from "../lib/selects.js";

export const players = Router();

players.get("/", async (req, res) => {
  const q = searchQuery.extend({ teamId: z.string().optional() }).parse(req.query);
  const where = {
    ...(q.teamId ? { teamId: q.teamId } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search } }, { nickname: { contains: q.search } }] } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.player.findMany({ where, orderBy: { name: "asc" }, take: q.limit, skip: q.offset, include: { team: teamSummary } }),
    prisma.player.count({ where }),
  ]);
  res.json({ data, total, limit: q.limit, offset: q.offset });
});

players.post("/", requireAdmin, async (req, res) => {
  const player = await prisma.player.create({ data: playerInput.parse(req.body), include: { team: teamSummary } });
  res.status(201).json(player);
});

players.get("/:id", async (req, res) => {
  const player = await prisma.player.findUnique({ where: { id: String(req.params.id) }, include: { team: teamSummary } });
  if (!player) throw notFound("Player");
  const lines = await prisma.matchPlayerStat.findMany({
    where: { playerId: player.id },
    include: { match: { include: matchInclude }, team: teamSummary },
    orderBy: [{ match: { playedAt: "desc" } }, { match: { createdAt: "desc" } }],
  });
  res.json({
    ...player,
    stats: statsByPlayer(lines).get(player.id) ?? emptyPlayerStats(),
    recentMatches: lines.slice(0, 20).map(({ match, team, kills, deaths, assists, score }) => ({
      match,
      team,
      kills,
      deaths,
      assists,
      score,
    })),
  });
});

players.patch("/:id", requireAdmin, async (req, res) => {
  const player = await prisma.player.update({
    where: { id: String(req.params.id) },
    data: playerInput.partial().parse(req.body),
    include: { team: teamSummary },
  });
  res.json(player);
});

players.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.player.delete({ where: { id: String(req.params.id) } });
  res.status(204).end();
});

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { HttpError, notFound } from "../lib/errors.js";
import { recomputeRatings, winnerOf } from "../lib/elo.js";
import { matchInput, pagination } from "../lib/validate.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { matchInclude, matchOrder, playerSummary } from "../lib/selects.js";

export const matches = Router();

const fullInclude = {
  ...matchInclude,
  playerStats: { include: { player: playerSummary }, orderBy: { score: "desc" as const } },
};

matches.get("/", async (req, res) => {
  const q = pagination
    .extend({ tournamentId: z.string().optional(), teamId: z.string().optional() })
    .parse(req.query);
  const where = {
    ...(q.tournamentId ? { tournamentId: q.tournamentId } : {}),
    ...(q.teamId ? { OR: [{ teamAId: q.teamId }, { teamBId: q.teamId }] } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.match.findMany({ where, include: matchInclude, orderBy: matchOrder, take: q.limit, skip: q.offset }),
    prisma.match.count({ where }),
  ]);
  res.json({ data, total, limit: q.limit, offset: q.offset });
});

matches.get("/:id", async (req, res) => {
  const match = await prisma.match.findUnique({ where: { id: String(req.params.id) }, include: fullInclude });
  if (!match) throw notFound("Match");
  res.json(match);
});

type MatchInput = z.infer<typeof matchInput>;

/** Checks references and resolves which side each player's stat line belongs to. */
async function prepare(input: MatchInput) {
  const [tournament, teamCount, players] = await Promise.all([
    prisma.tournament.findUnique({ where: { id: input.tournamentId } }),
    prisma.team.count({ where: { id: { in: [input.teamAId, input.teamBId] } } }),
    prisma.player.findMany({ where: { id: { in: input.playerStats.map((p) => p.playerId) } } }),
  ]);
  if (!tournament) throw notFound("Tournament");
  if (teamCount !== 2) throw notFound("Team");
  const byId = new Map(players.map((p) => [p.id, p]));
  const sides = new Set([input.teamAId, input.teamBId]);
  const statLines = input.playerStats.map((line) => {
    const player = byId.get(line.playerId);
    if (!player) throw new HttpError(404, `Player ${line.playerId} not found`);
    const teamId = line.teamId ?? player.teamId;
    if (!teamId || !sides.has(teamId)) {
      throw new HttpError(400, `Player "${player.name}" must be assigned to one of the two teams in this match`);
    }
    const { playerId, kills, deaths, assists, score } = line;
    return { playerId, teamId, kills, deaths, assists, score };
  });
  const { playerStats: _ignored, ...match } = input;
  return {
    match: { ...match, winnerId: winnerOf(input.teamAId, input.teamBId, input.scoreA, input.scoreB) },
    statLines,
  };
}

async function enrol(tournamentId: string, teamIds: string[]) {
  for (const teamId of teamIds) {
    await prisma.tournamentEntry.upsert({
      where: { tournamentId_teamId: { tournamentId, teamId } },
      create: { tournamentId, teamId },
      update: {},
    });
  }
}

matches.post("/", requireAdmin, async (req, res) => {
  const { match, statLines } = await prepare(matchInput.parse(req.body));
  await enrol(match.tournamentId, [match.teamAId, match.teamBId]);
  const created = await prisma.match.create({ data: { ...match, playerStats: { create: statLines } } });
  await recomputeRatings();
  res.status(201).json(await prisma.match.findUnique({ where: { id: created.id }, include: fullInclude }));
});

/** Replaces a match result (and its player stat lines) in full. */
matches.put("/:id", requireAdmin, async (req, res) => {
  const existing = await prisma.match.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) throw notFound("Match");
  const { match, statLines } = await prepare(matchInput.parse(req.body));
  await enrol(match.tournamentId, [match.teamAId, match.teamBId]);
  await prisma.$transaction([
    prisma.matchPlayerStat.deleteMany({ where: { matchId: existing.id } }),
    prisma.match.update({
      where: { id: existing.id },
      data: { ...match, playedAt: match.playedAt ?? existing.playedAt, playerStats: { create: statLines } },
    }),
  ]);
  await recomputeRatings();
  res.json(await prisma.match.findUnique({ where: { id: existing.id }, include: fullInclude }));
});

matches.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.match.delete({ where: { id: String(req.params.id) } });
  await recomputeRatings();
  res.status(204).end();
});

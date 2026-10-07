import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { HttpError, notFound } from "../lib/errors.js";
import { recomputeRatings } from "../lib/elo.js";
import { standings } from "../lib/stats.js";
import { datesInOrder, entryInput, searchQuery, tournamentInput, tournamentStatus } from "../lib/validate.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { matchInclude, matchOrder, teamSummary } from "../lib/selects.js";

export const tournaments = Router();

const badDates = () => new HttpError(400, "endDate must be on or after startDate");

tournaments.get("/", async (req, res) => {
  const q = searchQuery.extend({ status: tournamentStatus.optional() }).parse(req.query);
  const where = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.search
      ? { OR: [{ name: { contains: q.search } }, { game: { contains: q.search } }, { location: { contains: q.search } }] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.tournament.findMany({
      where,
      orderBy: { startDate: "desc" },
      take: q.limit,
      skip: q.offset,
      include: { _count: { select: { entries: true, matches: true } } },
    }),
    prisma.tournament.count({ where }),
  ]);
  const data = rows.map(({ _count, ...t }) => ({ ...t, teamCount: _count.entries, matchCount: _count.matches }));
  res.json({ data, total, limit: q.limit, offset: q.offset });
});

tournaments.post("/", requireAdmin, async (req, res) => {
  const input = tournamentInput.parse(req.body);
  if (!datesInOrder(input)) throw badDates();
  res.status(201).json(await prisma.tournament.create({ data: input }));
});

tournaments.get("/:id", async (req, res) => {
  const t = await prisma.tournament.findUnique({
    where: { id: String(req.params.id) },
    include: {
      entries: { include: { team: teamSummary } },
      matches: { orderBy: matchOrder, include: matchInclude },
    },
  });
  if (!t) throw notFound("Tournament");

  const byId = new Map(t.entries.map((e) => [e.team.id, e]));
  const table = standings([...byId.keys()], t.matches).map((s, i) => ({
    position: i + 1,
    ...s,
    placement: byId.get(s.teamId)?.placement ?? null,
    team: byId.get(s.teamId)?.team ?? null,
  }));
  const { entries, ...rest } = t;
  res.json({
    ...rest,
    teams: entries
      .map((e) => ({ ...e.team, placement: e.placement }))
      .sort((a, b) => (a.placement ?? Infinity) - (b.placement ?? Infinity) || a.name.localeCompare(b.name)),
    standings: table,
  });
});

tournaments.patch("/:id", requireAdmin, async (req, res) => {
  const input = tournamentInput.partial().parse(req.body);
  const existing = await prisma.tournament.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) throw notFound("Tournament");
  if (!datesInOrder({ ...existing, ...input })) throw badDates();
  res.json(await prisma.tournament.update({ where: { id: String(req.params.id) }, data: input }));
});

tournaments.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.tournament.delete({ where: { id: String(req.params.id) } });
  await recomputeRatings();
  res.status(204).end();
});

/** Registers a team in the tournament, or updates its final placement. */
tournaments.post("/:id/entries", requireAdmin, async (req, res) => {
  const input = entryInput.parse(req.body);
  const [tournament, team] = await Promise.all([
    prisma.tournament.findUnique({ where: { id: String(req.params.id) } }),
    prisma.team.findUnique({ where: { id: input.teamId } }),
  ]);
  if (!tournament) throw notFound("Tournament");
  if (!team) throw notFound("Team");
  const entry = await prisma.tournamentEntry.upsert({
    where: { tournamentId_teamId: { tournamentId: tournament.id, teamId: team.id } },
    create: { tournamentId: tournament.id, teamId: team.id, placement: input.placement ?? null },
    update: input.placement === undefined ? {} : { placement: input.placement },
  });
  res.status(201).json(entry);
});

tournaments.delete("/:id/entries/:teamId", requireAdmin, async (req, res) => {
  const { id, teamId } = z.object({ id: z.string(), teamId: z.string() }).parse(req.params);
  const played = await prisma.match.count({
    where: { tournamentId: id, OR: [{ teamAId: teamId }, { teamBId: teamId }] },
  });
  if (played) throw new HttpError(409, "Team has matches in this tournament; delete those matches first");
  await prisma.tournamentEntry.delete({ where: { tournamentId_teamId: { tournamentId: id, teamId } } });
  res.status(204).end();
});

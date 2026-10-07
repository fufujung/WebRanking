import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { recomputeRatings } from "../lib/elo.js";
import { matchInput, pagination } from "../lib/validate.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { matchInclude, matchOrder } from "../lib/selects.js";
import { getMatch, saveMatch } from "../lib/matchWrite.js";

export const matches = Router();

matches.get("/", async (req, res) => {
  const q = pagination
    .extend({
      tournamentId: z.string().optional(),
      teamId: z.string().optional(),
      /** played = newest game date first (default); created = most recently recorded first. */
      sort: z.enum(["played", "created"]).default("played"),
    })
    .parse(req.query);
  const where = {
    ...(q.tournamentId ? { tournamentId: q.tournamentId } : {}),
    ...(q.teamId ? { OR: [{ teamAId: q.teamId }, { teamBId: q.teamId }] } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.match.findMany({ where, include: matchInclude, orderBy: q.sort === "created" ? { createdAt: "desc" } : matchOrder, take: q.limit, skip: q.offset }),
    prisma.match.count({ where }),
  ]);
  res.json({ data, total, limit: q.limit, offset: q.offset });
});

/** Finds the series recorded from a source reference (e.g. a Discord message id): ?ref=... */
matches.get("/by-source", async (req, res) => {
  const q = z.object({ ref: z.string().min(1) }).parse(req.query);
  const found = await prisma.match.findUnique({ where: { sourceRef: q.ref }, select: { id: true } });
  res.json({ matchId: found?.id ?? null });
});

matches.get("/:id", async (req, res) => {
  res.json(await getMatch(String(req.params.id)));
});

matches.post("/", requireAdmin, async (req, res) => {
  res.status(201).json(await saveMatch(matchInput.parse(req.body)));
});

/** Replaces a series (its games and scoreboards) in full. */
matches.put("/:id", requireAdmin, async (req, res) => {
  res.json(await saveMatch(matchInput.parse(req.body), String(req.params.id)));
});

matches.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.match.delete({ where: { id: String(req.params.id) } });
  await recomputeRatings();
  res.status(204).end();
});

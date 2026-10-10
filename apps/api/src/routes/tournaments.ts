import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { fail, HttpError, notFound } from "../lib/errors.js";
import { recomputeRatings } from "../lib/elo.js";
import { standings } from "../lib/stats.js";
import { datesInOrder, entryInput, rosterSizeOk, searchQuery, tournamentInput, tournamentStatus } from "../lib/validate.js";
import * as comp from "../lib/competition.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { matchInclude, matchOrder } from "../lib/selects.js";

export const tournaments = Router();

const badDates = () => new HttpError(400, "endDate must be on or after startDate");
const badRoster = () => fail(400, "rosterMin must not be more than rosterMax", "จำนวนผู้เล่นขั้นต่ำต้องไม่มากกว่าขั้นสูงสุด");

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
  if (!rosterSizeOk(input)) throw badRoster();
  res.status(201).json(await prisma.tournament.create({ data: input }));
});

tournaments.get("/:id", async (req, res) => {
  const t = await prisma.tournament.findUnique({
    where: { id: String(req.params.id) },
    include: {
      matches: { orderBy: matchOrder, include: matchInclude },
    },
  });
  if (!t) throw notFound("Tournament");
  const entries = await comp.entriesView(t.id);

  const byId = new Map(entries.map((e) => [e.id, e]));
  const table = standings([...byId.keys()], t.matches).map((s, i) => {
    const e = byId.get(s.teamId);
    return {
      position: i + 1,
      ...s,
      placement: e?.placement ?? null,
      team: e ? { id: e.id, name: e.name, tag: e.tag, logoUrl: e.logoUrl, rating: e.rating } : null,
    };
  });
  res.json({
    ...t,
    teams: entries.sort((a, b) => (a.placement ?? Infinity) - (b.placement ?? Infinity) || a.name.localeCompare(b.name)),
    standings: table,
  });
});

tournaments.patch("/:id", requireAdmin, async (req, res) => {
  const input = tournamentInput.partial().parse(req.body);
  const existing = await prisma.tournament.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) throw notFound("Tournament");
  if (!datesInOrder({ ...existing, ...input })) throw badDates();
  if (!rosterSizeOk({ ...existing, ...input })) throw badRoster();
  const shapeChanged = (["format", "thirdPlaceMatch", "grandFinalReset"] as const).some((k) => input[k] !== undefined && input[k] !== existing[k]);
  if (shapeChanged && (existing.bracketStatus === "LIVE" || existing.bracketStatus === "DONE")) {
    throw fail(409, "The bracket has started; its format can no longer change", "เริ่มแข่งแล้ว เปลี่ยนรูปแบบการแข่งไม่ได้ (ต้องรีเซ็ตสายก่อน)");
  }
  const updated = await prisma.$transaction(async (tx) => {
    // A seeded draft no longer fits a new format: drop it so it is seeded again.
    if (shapeChanged && existing.bracketStatus === "DRAFT") {
      await tx.bracketMatch.deleteMany({ where: { tournamentId: existing.id } });
      await tx.tournamentEntry.updateMany({ where: { tournamentId: existing.id }, data: { seed: null } });
      return tx.tournament.update({ where: { id: existing.id }, data: { ...input, bracketStatus: "NONE" } });
    }
    return tx.tournament.update({ where: { id: existing.id }, data: input });
  });
  res.json(updated);
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
  await comp.withdraw(id, teamId);
  res.status(204).end();
});

// ---------- Registration and rosters ----------

/** A team signs up with its roster. Needs registration to be open, unless override is true. */
tournaments.post("/:id/registrations", requireAdmin, async (req, res) => {
  res.status(201).json(await comp.register(String(req.params.id), req.body));
});

/** Replaces a team's roster (and optionally its captain). Locked once the first match starts, unless override is true. */
tournaments.put("/:id/entries/:teamId/roster", requireAdmin, async (req, res) => {
  res.json(await comp.setRoster(String(req.params.id), String(req.params.teamId), req.body));
});

// ---------- Bracket ----------

tournaments.get("/:id/bracket", async (req, res) => {
  res.json(await comp.bracketView(String(req.params.id)));
});

/** Seeds the teams (by rating, at random, or by hand) and builds a bracket to review. */
tournaments.post("/:id/bracket/seed", requireAdmin, async (req, res) => {
  res.json(await comp.seed(String(req.params.id), req.body));
});

/** Confirms the reviewed bracket: the tournament starts and registration closes. */
tournaments.post("/:id/bracket/start", requireAdmin, async (req, res) => {
  res.json(await comp.start(String(req.params.id)));
});

tournaments.delete("/:id/bracket", requireAdmin, async (req, res) => {
  await comp.resetBracket(String(req.params.id), req.query.force === "true");
  res.status(204).end();
});

/** Sets the start time of a match ({ match }) or of a whole round ({ stage, round }). */
tournaments.post("/:id/bracket/schedule", requireAdmin, async (req, res) => {
  res.json(await comp.schedule(String(req.params.id), req.body));
});

tournaments.get("/:id/bracket/matches/:match", async (req, res) => {
  const view = await comp.bracketView(String(req.params.id));
  const ref = String(req.params.match);
  const n = /^m?(\d+)$/i.exec(ref);
  const m = view.matches.find((x) => x.id === ref || x.code === ref || (n && x.number === Number(n[1])));
  if (!m) throw fail(404, "Bracket match not found", "ไม่พบแมตช์นี้ในสาย");
  res.json(await comp.slotView(view.tournamentId, m.id));
});

tournaments.post("/:id/bracket/matches/:match/result", requireAdmin, async (req, res) => {
  res.json(await comp.recordResult(String(req.params.id), String(req.params.match), req.body));
});

tournaments.post("/:id/bracket/matches/:match/walkover", requireAdmin, async (req, res) => {
  res.json(await comp.walkover(String(req.params.id), String(req.params.match), req.body));
});

tournaments.post("/:id/bracket/matches/:match/reopen", requireAdmin, async (req, res) => {
  const { force } = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
  res.json(await comp.reopenMatch(String(req.params.id), String(req.params.match), force));
});

tournaments.post("/:id/bracket/matches/:match/checkin", requireAdmin, async (req, res) => {
  res.json(await comp.checkIn(String(req.params.id), String(req.params.match), req.body));
});

tournaments.post("/:id/bracket/matches/:match/dispute", requireAdmin, async (req, res) => {
  res.json(await comp.dispute(String(req.params.id), String(req.params.match), req.body ?? {}));
});

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { HttpError, notFound } from "./errors.js";
import { recomputeRatings, winnerOf } from "./elo.js";
import { matchInput, normaliseName } from "./validate.js";
import { announceMatch } from "./announce.js";

export type MatchInput = z.infer<typeof matchInput>;
type Tx = Prisma.TransactionClient;

/** Finds a team by id, or by name/tag; an unknown name creates the team. */
async function resolveTeam(tx: Tx, id: string | undefined, name: string | undefined) {
  if (id) {
    const team = await tx.team.findUnique({ where: { id } });
    if (!team) throw notFound("Team");
    return team;
  }
  const wanted = normaliseName(name!);
  const teams = await tx.team.findMany({ select: { id: true, name: true, tag: true } });
  const found = teams.find((t) => normaliseName(t.name) === wanted) ?? teams.find((t) => t.tag && normaliseName(t.tag) === wanted);
  if (found) return found;
  return tx.team.create({ data: { name: name!.trim() } });
}

/**
 * Turns each scoreboard row into a player id. A name is matched against the side's own
 * roster first, then against everyone (a substitute); an unknown name becomes a new
 * player on that side's team.
 */
async function resolvePlayers(tx: Tx, input: MatchInput, teamIds: { A: string; B: string }) {
  const ids = input.games.flatMap((g) => g.players.map((p) => p.playerId).filter((x): x is string => Boolean(x)));
  const named = input.games.some((g) => g.players.some((p) => !p.playerId));
  const [byIdList, everyone] = await Promise.all([
    tx.player.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    named ? tx.player.findMany({ select: { id: true, name: true, nickname: true, teamId: true } }) : Promise.resolve([]),
  ]);
  const known = new Set(byIdList.map((p) => p.id));
  const created = new Map<string, string>(); // `${teamId}:${normalisedName}` -> player id

  const find = async (name: string, teamId: string) => {
    const key = normaliseName(name);
    const sameName = (p: (typeof everyone)[number]) => normaliseName(p.name) === key || (p.nickname && normaliseName(p.nickname) === key);
    const existing = everyone.find((p) => p.teamId === teamId && sameName(p)) ?? everyone.find(sameName);
    if (existing) return existing.id;
    const cacheKey = `${teamId}:${key}`;
    let id = created.get(cacheKey);
    if (!id) {
      id = (await tx.player.create({ data: { name: name.trim(), teamId } })).id;
      created.set(cacheKey, id);
    }
    return id;
  };

  const games = [];
  for (const game of input.games) {
    const lines = [];
    for (const p of game.players) {
      const teamId = teamIds[p.side];
      let playerId = p.playerId;
      if (playerId && !known.has(playerId)) throw new HttpError(404, `Player ${playerId} not found`);
      playerId ??= await find(p.name!, teamId);
      const { pts, reb, blk, stl, ast, lbr, rating, award } = p;
      lines.push({ playerId, teamId, pts, reb, blk, stl, ast, lbr, rating, award });
    }
    if (new Set(lines.map((l) => l.playerId)).size !== lines.length) {
      throw new HttpError(400, "Each player can only appear once per game");
    }
    games.push({ scoreA: game.scoreA, scoreB: game.scoreB, imageUrl: game.imageUrl, lines });
  }
  return games;
}

async function enrol(tx: Tx, tournamentId: string, teamIds: string[]) {
  for (const teamId of teamIds) {
    await tx.tournamentEntry.upsert({
      where: { tournamentId_teamId: { tournamentId, teamId } },
      create: { tournamentId, teamId },
      update: {},
    });
  }
}

/** Creates (or, with existingId, fully replaces) a series with its games and scoreboards. */
export async function saveMatch(input: MatchInput, existingId?: string) {
  const id = await prisma.$transaction(async (tx) => {
    const existing = existingId ? await tx.match.findUnique({ where: { id: existingId } }) : null;
    if (existingId && !existing) throw notFound("Match");
    if (!(await tx.tournament.findUnique({ where: { id: input.tournamentId } }))) throw notFound("Tournament");
    if (input.sourceRef) {
      const dupe = await tx.match.findUnique({ where: { sourceRef: input.sourceRef }, select: { id: true } });
      if (dupe && dupe.id !== existingId) throw new HttpError(409, "This result has already been recorded", { matchId: dupe.id });
    }

    const teamA = await resolveTeam(tx, input.teamAId, input.teamAName);
    const teamB = await resolveTeam(tx, input.teamBId, input.teamBName);
    if (teamA.id === teamB.id) throw new HttpError(400, "A team cannot play against itself");
    const games = await resolvePlayers(tx, input, { A: teamA.id, B: teamB.id });

    const scoreA = input.scoreA ?? games.filter((g) => g.scoreA > g.scoreB).length;
    const scoreB = input.scoreB ?? games.filter((g) => g.scoreB > g.scoreA).length;
    const data = {
      tournamentId: input.tournamentId,
      teamAId: teamA.id,
      teamBId: teamB.id,
      scoreA,
      scoreB,
      winnerId: winnerOf(teamA.id, teamB.id, scoreA, scoreB),
      round: input.round,
      notes: input.notes,
      imageUrl: input.imageUrl,
      source: input.source,
      sourceRef: input.sourceRef,
      playedAt: input.playedAt ?? existing?.playedAt ?? new Date(),
    };

    await enrol(tx, input.tournamentId, [teamA.id, teamB.id]);
    let matchId: string;
    if (existing) {
      await tx.matchGame.deleteMany({ where: { matchId: existing.id } });
      await tx.match.update({ where: { id: existing.id }, data });
      matchId = existing.id;
    } else {
      matchId = (await tx.match.create({ data })).id;
    }
    for (const [i, g] of games.entries()) {
      await tx.matchGame.create({
        data: {
          matchId,
          number: i + 1,
          scoreA: g.scoreA,
          scoreB: g.scoreB,
          imageUrl: g.imageUrl,
          playerStats: { create: g.lines.map((l) => ({ ...l, matchId })) },
        },
      });
    }
    return matchId;
  });
  await recomputeRatings();
  const saved = await getMatch(id);
  if (!existingId) announceMatch(saved);
  return saved;
}

export const matchDetailInclude = {
  teamA: { select: { id: true, name: true, tag: true, logoUrl: true, rating: true } },
  teamB: { select: { id: true, name: true, tag: true, logoUrl: true, rating: true } },
  tournament: { select: { id: true, name: true } },
  games: {
    orderBy: { number: "asc" as const },
    include: {
      playerStats: {
        include: { player: { select: { id: true, name: true, nickname: true, avatarUrl: true, teamId: true } } },
        orderBy: [{ pts: "desc" as const }, { rating: "desc" as const }],
      },
    },
  },
} satisfies Prisma.MatchInclude;

/** A series with its games plus each player's totals across the series. */
export async function getMatch(id: string) {
  const match = await prisma.match.findUnique({ where: { id }, include: matchDetailInclude });
  if (!match) throw notFound("Match");
  const totals = new Map<string, ReturnType<typeof emptyTotals> & { player: (typeof match.games)[number]["playerStats"][number]["player"]; teamId: string }>();
  for (const game of match.games) {
    for (const s of game.playerStats) {
      let t = totals.get(s.playerId);
      if (!t) totals.set(s.playerId, (t = { ...emptyTotals(), player: s.player, teamId: s.teamId }));
      t.games++;
      t.pts += s.pts;
      t.reb += s.reb;
      t.blk += s.blk;
      t.stl += s.stl;
      t.ast += s.ast;
      t.lbr += s.lbr;
      if (s.rating !== null) {
        t.ratingSum += s.rating;
        t.rated++;
      }
      if (s.award === "MVP") t.mvp++;
      if (s.award === "SVP") t.svp++;
    }
  }
  const players = [...totals.values()]
    .map(({ ratingSum, rated, ...t }) => ({ ...t, avgRating: rated ? Math.round((ratingSum / rated) * 10) / 10 : null }))
    .sort((a, b) => b.pts - a.pts || (b.avgRating ?? 0) - (a.avgRating ?? 0));
  return { ...match, players };
}

const emptyTotals = () => ({ games: 0, pts: 0, reb: 0, blk: 0, stl: 0, ast: 0, lbr: 0, mvp: 0, svp: 0, ratingSum: 0, rated: 0 });

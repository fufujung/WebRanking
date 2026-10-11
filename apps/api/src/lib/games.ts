/** Games: every player, team and tournament belongs to one, so MMR and rankings are per game. */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { fail } from "./errors.js";
import { normaliseName } from "./validate.js";

type Db = Prisma.TransactionClient | typeof prisma;

export const gameInput = z.object({ name: z.string().trim().min(1).max(100) });

/** The game with this name (ignoring case, spaces and punctuation), created when new. */
export async function gameByName(db: Db, name: string) {
  const key = normaliseName(name);
  if (!key) throw fail(400, "Game names must contain letters or numbers", "ชื่อเกมต้องมีตัวอักษรหรือตัวเลข");
  const all = await db.game.findMany();
  return all.find((g) => normaliseName(g.name) === key) ?? db.game.create({ data: { name: name.trim() } });
}

/**
 * Turns a tournament's game (an id, or a name from older clients) into both fields:
 * gameId for the link and game for the name API clients read.
 */
export async function tournamentGame(db: Db, input: { gameId?: string | null; game?: string | null }) {
  if (input.gameId) {
    const g = await db.game.findUnique({ where: { id: input.gameId } });
    if (!g) throw fail(400, "Unknown game", "ไม่พบเกมนี้");
    return { gameId: g.id, game: g.name };
  }
  if (input.game) {
    const g = await gameByName(db, input.game);
    return { gameId: g.id, game: g.name };
  }
  return { gameId: null, game: null };
}

/** Checks a game id from a form or the API; blank means "no game". */
export async function gameIdOrNull(db: Db, id: string | null | undefined) {
  if (!id) return null;
  if (!(await db.game.findUnique({ where: { id }, select: { id: true } }))) throw fail(400, "Unknown game", "ไม่พบเกมนี้");
  return id;
}

/**
 * Teams and players that play in a tournament take its game, if they have none yet.
 * Called after sign-ups, roster changes and results.
 */
export async function adoptGame(tournamentId: string | null | undefined) {
  if (!tournamentId) return;
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { gameId: true } });
  if (!t?.gameId) return;
  const [entries, matches, rosters, lines] = await Promise.all([
    prisma.tournamentEntry.findMany({ where: { tournamentId }, select: { teamId: true } }),
    prisma.match.findMany({ where: { tournamentId }, select: { teamAId: true, teamBId: true } }),
    prisma.rosterPlayer.findMany({ where: { entry: { tournamentId } }, select: { playerId: true } }),
    prisma.matchPlayerStat.findMany({ where: { match: { tournamentId } }, select: { playerId: true } }),
  ]);
  const teamIds = [...new Set([...entries.map((e) => e.teamId), ...matches.flatMap((m) => [m.teamAId, m.teamBId])])];
  const playerIds = [...new Set([...rosters, ...lines].map((r) => r.playerId))];
  await prisma.$transaction([
    prisma.team.updateMany({ where: { id: { in: teamIds }, gameId: null }, data: { gameId: t.gameId } }),
    prisma.player.updateMany({ where: { id: { in: playerIds }, gameId: null }, data: { gameId: t.gameId } }),
  ]);
}

/**
 * Data saved before games existed: each tournament's game name becomes a game, its teams and
 * players join it, and when there is only one game everyone else joins it too. Safe to run on every start.
 */
export async function backfillGames() {
  const loose = await prisma.tournament.findMany({ where: { gameId: null, game: { not: null } }, select: { id: true, game: true } });
  for (const t of loose) {
    if (!t.game?.trim()) continue;
    const g = await gameByName(prisma, t.game);
    await prisma.tournament.update({ where: { id: t.id }, data: { gameId: g.id, game: g.name } });
  }
  for (const t of await prisma.tournament.findMany({ where: { gameId: { not: null } }, select: { id: true } })) await adoptGame(t.id);
  const games = await prisma.game.findMany({ select: { id: true } });
  if (games.length === 1) {
    await prisma.$transaction([
      prisma.team.updateMany({ where: { gameId: null }, data: { gameId: games[0].id } }),
      prisma.player.updateMany({ where: { gameId: null }, data: { gameId: games[0].id } }),
      prisma.tournament.updateMany({ where: { gameId: null }, data: { gameId: games[0].id } }),
    ]);
  }
  return games.length;
}

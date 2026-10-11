import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { fail, notFound } from "../lib/errors.js";
import { z } from "zod";
import { gameInput, parseRanks, rankInput } from "../lib/games.js";
import { normaliseName } from "../lib/validate.js";

export const games = Router();

/** Every game with how many players, teams and tournaments it has. */
games.get("/", async (_req, res) => {
  const rows = await prisma.game.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { players: true, teams: true, tournaments: true } } } });
  res.json({ data: rows.map(({ _count, ...g }) => ({ ...g, ranks: parseRanks(g.ranks), ..._count })) });
});

games.get("/:id", async (req, res) => {
  const g = await prisma.game.findUnique({ where: { id: String(req.params.id) } });
  if (!g) throw notFound("Game");
  res.json({ ...g, ranks: parseRanks(g.ranks) });
});

async function nameFree(name: string, except?: string) {
  const key = normaliseName(name);
  if (!key) throw fail(400, "Game names must contain letters or numbers", "ชื่อเกมต้องมีตัวอักษรหรือตัวเลข");
  const clash = (await prisma.game.findMany()).find((g) => g.id !== except && normaliseName(g.name) === key);
  if (clash) throw fail(409, "This game exists", `มีเกม ${clash.name} อยู่แล้ว`);
}

games.post("/", requireAdmin, async (req, res) => {
  const { name } = gameInput.parse(req.body);
  await nameFree(name);
  const g = await prisma.game.create({ data: { name } });
  res.status(201).json({ ...g, ranks: [] });
});

const gamePatch = gameInput.partial().extend({ ranks: z.array(rankInput).max(30).optional() });

/**
 * Renames the game (its tournaments' `game` name follows, which API clients read) and/or
 * replaces its in-game ranks, lowest first.
 */
games.patch("/:id", requireAdmin, async (req, res) => {
  const { name, ranks } = gamePatch.parse(req.body);
  const id = String(req.params.id);
  if (!(await prisma.game.findUnique({ where: { id } }))) throw notFound("Game");
  if (name !== undefined) await nameFree(name, id);
  if (ranks) {
    const names = ranks.map((r) => normaliseName(r.name));
    if (new Set(names).size !== names.length) throw fail(400, "Rank names must differ", "ชื่อแรงค์ซ้ำกัน");
  }
  const [game] = await prisma.$transaction([
    prisma.game.update({ where: { id }, data: { ...(name !== undefined ? { name } : {}), ...(ranks ? { ranks: JSON.stringify(ranks) } : {}) } }),
    ...(name !== undefined ? [prisma.tournament.updateMany({ where: { gameId: id }, data: { game: name } })] : []),
  ]);
  res.json({ ...game, ranks: parseRanks(game.ranks) });
});

/** Only a game nothing uses yet can be deleted, so no ranking loses its game by accident. */
games.delete("/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const g = await prisma.game.findUnique({ where: { id }, include: { _count: { select: { players: true, teams: true, tournaments: true } } } });
  if (!g) throw notFound("Game");
  const used = g._count.players + g._count.teams + g._count.tournaments;
  if (used) throw fail(409, "This game is in use", `เกมนี้มีผู้เล่น ${g._count.players} คน ทีม ${g._count.teams} ทีม และทัวร์นาเมนต์ ${g._count.tournaments} รายการ ลบไม่ได้`);
  await prisma.game.delete({ where: { id } });
  res.status(204).end();
});

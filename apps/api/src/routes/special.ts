import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../lib/apiKeys.js";
import { editReserve, importReserve, removeReserve, reserveList, reserveRanks, specialBoard } from "../lib/special.js";

/**
 * The special "เล่นเก่งปากเก่ง" events: the separate MMR and stats board, and the standing list of substitutes.
 * The public list has no contact details; /reserve/private (admin key) adds Facebook, phone and Discord.
 */
export const special = Router();

special.get("/", async (req, res) => {
  const q = z.object({ gameId: z.string().trim().min(1).max(40).optional() }).parse(req.query);
  res.json(await specialBoard(q.gameId));
});

/** The ranks substitutes pick from: the game's in-game ranks, lowest first. */
special.get("/ranks", async (req, res) => {
  const q = z.object({ gameId: z.string().trim().min(1).max(40).optional() }).parse(req.query);
  res.json({ data: await reserveRanks(q.gameId) });
});

const gameQuery = z.object({ gameId: z.string().trim().min(1).max(40).optional() });

/** One game's list with ?gameId= (each game keeps its own), or every game's. */
special.get("/reserve", async (req, res) => {
  res.json({ data: await reserveList(false, gameQuery.parse(req.query).gameId) });
});

special.get("/reserve/private", requireAdmin, async (req, res) => {
  res.json({ data: await reserveList(true, gameQuery.parse(req.query).gameId) });
});

special.patch("/reserve/:playerId", requireAdmin, async (req, res) => {
  res.json(await editReserve(String(req.params.playerId), req.body));
});

special.delete("/reserve/:playerId", requireAdmin, async (req, res) => {
  await removeReserve(String(req.params.playerId));
  res.status(204).end();
});

/** Carries the bot's old Discord-only list over (once, when the bot starts). */
special.post("/reserve/import", requireAdmin, async (req, res) => {
  res.json(await importReserve(req.body));
});

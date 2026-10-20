import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../lib/apiKeys.js";
import { editReserve, importReserve, removeReserve, reserveList, reserveRanks, specialBoard } from "../lib/special.js";
import { addSeasonPlayers, createSeason, deleteSeason, listSeasons, removeSeasonPlayer, seasonView, updateSeason } from "../lib/seasons.js";

/**
 * The special "เล่นเก่งปากเก่ง" events: the separate MMR and stats board, and the standing list of substitutes.
 * The public list has no contact details; /reserve/private (admin key) adds Facebook, phone and Discord.
 */
export const special = Router();

/** The board of every special event, or of one season with ?seasonId= (its players, events and stats). */
special.get("/", async (req, res) => {
  const q = z.object({ gameId: z.string().trim().min(1).max(40).optional(), seasonId: z.string().trim().min(1).max(40).optional() }).parse(req.query);
  res.json(await specialBoard(q.gameId, q.seasonId));
});

/** Seasons: each lists the players (name + UID) allowed to play in its events. */
special.get("/seasons", async (req, res) => {
  const q = z.object({ gameId: z.string().trim().min(1).max(40).optional() }).parse(req.query);
  res.json({ data: await listSeasons(q.gameId) });
});

special.get("/seasons/:id", async (req, res) => {
  res.json(await seasonView(String(req.params.id)));
});

special.post("/seasons", requireAdmin, async (req, res) => {
  res.status(201).json(await createSeason(req.body));
});

special.patch("/seasons/:id", requireAdmin, async (req, res) => {
  res.json(await updateSeason(String(req.params.id), req.body));
});

special.delete("/seasons/:id", requireAdmin, async (req, res) => {
  await deleteSeason(String(req.params.id));
  res.status(204).end();
});

/** Adds players by { players: [{ uid, name } | { playerId }] } or pasted { text } (one "name UID" per line). */
special.post("/seasons/:id/players", requireAdmin, async (req, res) => {
  res.json(await addSeasonPlayers(String(req.params.id), req.body));
});

special.delete("/seasons/:id/players/:playerId", requireAdmin, async (req, res) => {
  await removeSeasonPlayer(String(req.params.id), String(req.params.playerId));
  res.status(204).end();
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

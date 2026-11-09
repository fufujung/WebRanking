import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../lib/apiKeys.js";
import { seasonStories, seasonsWithStories, setStories, specialStories } from "../lib/stories.js";
import { editReserve, importReserve, removeReserve, reserveGame, reserveList, reserveRanks, setReserveSeason, specialBoard } from "../lib/special.js";
import { addSeasonPlayers, createSeason, deleteSeason, listSeasons, openReserveSeasons, removeSeasonPlayer, seasonView, updateSeason } from "../lib/seasons.js";

/**
 * The special "เล่นเก่งปากเก่ง" events: the separate MMR and stats board, and the substitutes of each season.
 * The public list has no contact details; /reserve/private (admin key) adds Facebook, phone and Discord.
 */
export const special = Router();

/** The board of every special event, or of one season with ?seasonId= (its players, events and stats). */
special.get("/", async (req, res) => {
  const q = z.object({ gameId: z.string().trim().min(1).max(40).optional(), seasonId: z.string().trim().min(1).max(40).optional() }).parse(req.query);
  res.json(await specialBoard(q.gameId, q.seasonId));
});

/** The stories (Facebook posts) of special events, optionally one season's. */
special.get("/stories", async (req, res) => {
  const q = z.object({ seasonId: z.string().trim().min(1).max(40).optional() }).parse(req.query);
  const [data, seasons] = await Promise.all([specialStories(q.seasonId), seasonsWithStories(q.seasonId)]);
  res.json({ data, seasons });
});

/** Seasons: each lists the players (name + UID) allowed to play in its events. ?open=true: only the seasons taking substitutes now. */
special.get("/seasons", async (req, res) => {
  const q = z.object({ gameId: z.string().trim().min(1).max(40).optional(), open: z.enum(["true", "false"]).optional() }).parse(req.query);
  if (q.open === "true") return void res.json({ data: await openReserveSeasons(await reserveGame(q.gameId)) });
  res.json({ data: await listSeasons(q.gameId) });
});

special.get("/seasons/:id", async (req, res) => {
  res.json(await seasonView(String(req.params.id)));
});

/** A season's own story posts (for the story told before any event of the season exists). */
special.get("/seasons/:id/stories", async (req, res) => {
  res.json({ data: await seasonStories(String(req.params.id)) });
});

special.put("/seasons/:id/stories", requireAdmin, async (req, res) => {
  res.json({ data: await setStories({ seasonId: String(req.params.id) }, req.body) });
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

const gameQuery = z.object({ gameId: z.string().trim().min(1).max(40).optional(), seasonId: z.string().trim().min(1).max(40).optional() });

/** One game's list with ?gameId= (each game keeps its own), or every game's; ?seasonId= keeps one season's substitutes. */
special.get("/reserve", async (req, res) => {
  const q = gameQuery.parse(req.query);
  res.json({ data: await reserveList(false, q.gameId, q.seasonId) });
});

special.get("/reserve/private", requireAdmin, async (req, res) => {
  const q = gameQuery.parse(req.query);
  res.json({ data: await reserveList(true, q.gameId, q.seasonId) });
});

/** An organizer adds a substitute to a season's list (open for sign-ups or not) or takes them off it. */
special.put("/seasons/:id/reserve/:playerId", requireAdmin, async (req, res) => {
  await setReserveSeason(String(req.params.id), String(req.params.playerId), true);
  res.status(204).end();
});

special.delete("/seasons/:id/reserve/:playerId", requireAdmin, async (req, res) => {
  await setReserveSeason(String(req.params.id), String(req.params.playerId), false);
  res.status(204).end();
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

import { Router } from "express";
import { requireAdmin } from "../lib/apiKeys.js";
import { activeDraws, addEntry, addManualEntries, closeDraw, createDraw, deleteDraw, drawDetail, drawWinners, listDraws, openDraw, publicDraw, removeEntry, updateDraw, voidWinner } from "../lib/draws.js";

/**
 * Lucky draws on stream. Anyone with a key sees a draw's count and winners (the overlay, Discord); the
 * organizer (admin key) creates, opens, closes and draws, and adds Discord or hand-typed entries.
 */
export const draws = Router();

const id = (v: unknown) => String(v);

draws.get("/active", async (_req, res) => {
  res.json({ data: await activeDraws() });
});

draws.get("/:id/public", async (req, res) => {
  res.json(await publicDraw(id(req.params.id)));
});

// ---------- Organizer ----------
draws.use(requireAdmin);

draws.get("/", async (_req, res) => {
  res.json({ data: await listDraws() });
});

draws.post("/", async (req, res) => {
  res.status(201).json(await createDraw(req.body));
});

draws.get("/:id", async (req, res) => {
  res.json(await drawDetail(id(req.params.id)));
});

draws.patch("/:id", async (req, res) => {
  res.json(await updateDraw(id(req.params.id), req.body));
});

draws.delete("/:id", async (req, res) => {
  await deleteDraw(id(req.params.id));
  res.status(204).end();
});

draws.post("/:id/open", async (req, res) => {
  res.json(await openDraw(id(req.params.id)));
});

draws.post("/:id/close", async (req, res) => {
  res.json(await closeDraw(id(req.params.id)));
});

draws.post("/:id/draw", async (req, res) => {
  res.json({ data: await drawWinners(id(req.params.id), req.body) });
});

draws.post("/:id/entries", async (req, res) => {
  if (typeof req.body?.lines === "string") return void res.json(await addManualEntries(id(req.params.id), req.body.lines));
  const r = await addEntry(id(req.params.id), req.body);
  res.status(r.added ? 201 : 200).json(r);
});

draws.delete("/:id/entries/:entryId", async (req, res) => {
  await removeEntry(id(req.params.id), id(req.params.entryId));
  res.status(204).end();
});

draws.post("/:id/entries/:entryId/void", async (req, res) => {
  res.json(await voidWinner(id(req.params.id), id(req.params.entryId), req.body));
});

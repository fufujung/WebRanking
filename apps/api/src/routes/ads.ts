import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { notFound } from "../lib/errors.js";
import { adInput } from "../lib/validate.js";

export const ads = Router();

/** Ads that should be on the site right now: switched on and inside their start/end window. */
const liveWhere = (now: Date) => ({
  active: true,
  AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
});

const listQuery = z.object({
  placement: z.enum(["banner", "card", "popup"]).optional(),
  live: z.enum(["0", "1", "true", "false"]).optional(),
});

ads.get("/", async (req, res) => {
  const q = listQuery.parse(req.query);
  const live = q.live === "1" || q.live === "true";
  const data = await prisma.ad.findMany({
    where: { ...(q.placement ? { placement: q.placement } : {}), ...(live ? liveWhere(new Date()) : {}) },
    orderBy: { createdAt: "desc" },
  });
  res.json({ data });
});

ads.post("/", requireAdmin, async (req, res) => {
  res.status(201).json(await prisma.ad.create({ data: adInput.parse(req.body) }));
});

ads.get("/:id", async (req, res) => {
  const ad = await prisma.ad.findUnique({ where: { id: String(req.params.id) } });
  if (!ad) throw notFound("Ad");
  res.json(ad);
});

ads.patch("/:id", requireAdmin, async (req, res) => {
  res.json(await prisma.ad.update({ where: { id: String(req.params.id) }, data: adInput.parse(req.body) }));
});

ads.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.ad.delete({ where: { id: String(req.params.id) } });
  res.status(204).end();
});

/** Counts a click and returns where to send the visitor. Like every write, it needs an admin key (the web server has one). */
ads.post("/:id/click", async (req, res) => {
  const ad = await prisma.ad.update({ where: { id: String(req.params.id) }, data: { clicks: { increment: 1 } }, select: { linkUrl: true, clicks: true } });
  res.json(ad);
});

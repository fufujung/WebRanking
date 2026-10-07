import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { HttpError, notFound } from "../lib/errors.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { imageUpload, mediaTypeOf, uploadedFilePath } from "../lib/uploads.js";
import { imageReader } from "../lib/extract.js";
import { buildDraft } from "../lib/draft.js";

export const uploads = Router();

/** Upload an image (multipart field "image"). Returns its URL for use as logoUrl, avatarUrl or a match imageUrl. */
uploads.post("/uploads", requireAdmin, imageUpload.single("image"), (req, res) => {
  if (!req.file) throw new HttpError(400, 'Send the image as multipart/form-data in the field "image"');
  res.status(201).json({ url: `/uploads/${req.file.filename}`, size: req.file.size, mediaType: req.file.mimetype });
});

uploads.get("/extract/status", (_req, res) => {
  res.json({ enabled: imageReader.enabled() });
});

/**
 * Reads a result post (its text plus one scoreboard screenshot per game, already
 * uploaded) and returns a draft series with names matched to existing teams and
 * players. Nothing is saved; send the reviewed draft to POST /matches.
 */
uploads.post("/extract/series", requireAdmin, async (req, res) => {
  const input = z
    .object({
      imageUrls: z.array(z.string()).min(1).max(6),
      text: z.string().max(2000).default(""),
      teamAId: z.string().optional(),
      teamBId: z.string().optional(),
    })
    .parse(req.body);
  const images = input.imageUrls.map((url) => {
    const file = uploadedFilePath(url);
    const mediaType = file && mediaTypeOf(file);
    if (!file || !mediaType) throw notFound("Uploaded image");
    return { file, mediaType };
  });
  const teams = await prisma.team.findMany({
    select: { name: true, players: { select: { name: true } } },
    orderBy: { rating: "desc" },
  });
  const read = await imageReader.read(images, input.text, {
    teams: teams.map((t) => ({ name: t.name, players: t.players.map((p) => p.name) })),
  });
  res.json({ raw: read, draft: await buildDraft(read, input.text, input.imageUrls, input) });
});

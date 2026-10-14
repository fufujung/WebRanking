import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { HttpError, notFound } from "../lib/errors.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { imageUpload, mediaTypeOf, uploadedFilePath } from "../lib/uploads.js";
import { imageReader } from "../lib/extract.js";
import { buildDraft, type RosterName } from "../lib/draft.js";

export const uploads = Router();

/** Upload an image (multipart field "image"). Returns its URL for use as logoUrl, avatarUrl or a match imageUrl. */
uploads.post("/uploads", requireAdmin, imageUpload.single("image"), (req, res) => {
  if (!req.file) throw new HttpError(400, 'Send the image as multipart/form-data in the field "image"');
  res.status(201).json({ url: `/uploads/${req.file.filename}`, size: req.file.size, mediaType: req.file.mimetype });
});

uploads.get("/extract/status", (_req, res) => {
  res.json({ enabled: imageReader.enabled(), mode: imageReader.mode() });
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
      tournamentId: z.string().optional(),
    })
    .parse(req.body);
  const images = input.imageUrls.map((url) => {
    const file = uploadedFilePath(url);
    const mediaType = file && mediaTypeOf(file);
    if (!file || !mediaType) throw notFound("Uploaded image");
    return { file, mediaType };
  });
  // A bracket match: the names may only come from the two teams' tournament rosters.
  const rosters = input.teamAId && input.teamBId ? { A: await rosterOf(input.teamAId, input.tournamentId), B: await rosterOf(input.teamBId, input.tournamentId) } : undefined;
  const teams = rosters
    ? [rosters.A, rosters.B].map((r) => ({ name: "", players: r.map((p) => p.name) }))
    : (await prisma.team.findMany({ select: { name: true, players: { select: { name: true } } }, orderBy: { rating: "desc" } })).map((t) => ({
        name: t.name,
        players: t.players.map((p) => p.name),
      }));
  const read = await imageReader.read(images, input.text, { teams });
  res.json({ raw: read, draft: await buildDraft(read, input.text, input.imageUrls, { ...input, rosters }) });
});

/**
 * The players a team is registered with in a tournament (that tournament's entry, else the
 * team's latest), with their UIDs; a team with no roster falls back to its own members.
 */
async function rosterOf(teamId: string, tournamentId?: string): Promise<RosterName[]> {
  const entry = await prisma.tournamentEntry.findFirst({
    where: { teamId, ...(tournamentId ? { tournamentId } : {}) },
    orderBy: { createdAt: "desc" },
    select: { roster: { orderBy: { order: "asc" }, select: { uid: true, player: { select: { id: true, name: true, uid: true } } } } },
  });
  if (entry?.roster.length) return entry.roster.map((r) => ({ playerId: r.player.id, name: r.player.name, uid: r.uid ?? r.player.uid }));
  const members = await prisma.player.findMany({ where: { teamId }, select: { id: true, name: true, uid: true } });
  return members.map((p) => ({ playerId: p.id, name: p.name, uid: p.uid }));
}

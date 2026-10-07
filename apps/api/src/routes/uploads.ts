import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { HttpError, notFound } from "../lib/errors.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { imageUpload, mediaTypeOf, uploadedFilePath } from "../lib/uploads.js";
import { imageReader } from "../lib/extract.js";

export const uploads = Router();

/** Upload an image (multipart field "image"). Returns its URL for use as logoUrl, avatarUrl or a match imageUrl. */
uploads.post("/uploads", requireAdmin, imageUpload.single("image"), (req, res) => {
  if (!req.file) throw new HttpError(400, 'Send the image as multipart/form-data in the field "image"');
  res.status(201).json({ url: `/uploads/${req.file.filename}`, size: req.file.size, mediaType: req.file.mimetype });
});

uploads.get("/extract/status", (_req, res) => {
  res.json({ enabled: imageReader.enabled() });
});

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Reads a previously uploaded result screenshot and returns a suggested match
 * result with names matched to existing teams and players. Nothing is saved.
 */
uploads.post("/extract/match", requireAdmin, async (req, res) => {
  const input = z
    .object({ imageUrl: z.string(), teamAId: z.string().optional(), teamBId: z.string().optional() })
    .parse(req.body);
  const file = uploadedFilePath(input.imageUrl);
  const mediaType = file && mediaTypeOf(file);
  if (!file || !mediaType) throw notFound("Uploaded image");

  const teamIds = [input.teamAId, input.teamBId].filter((x): x is string => Boolean(x));
  const [allTeams, players] = await Promise.all([
    prisma.team.findMany({ select: { id: true, name: true, tag: true } }),
    prisma.player.findMany({
      where: teamIds.length ? { teamId: { in: teamIds } } : {},
      select: { id: true, name: true, nickname: true, teamId: true },
      take: 500,
    }),
  ]);
  const teamName = (id?: string) => allTeams.find((t) => t.id === id)?.name;
  const result = await imageReader.read(file, mediaType, {
    teamA: teamName(input.teamAId),
    teamB: teamName(input.teamBId),
    roster: players.flatMap((p) => [p.name, p.nickname].filter((n): n is string => Boolean(n))),
  });

  const findTeam = (name: string) =>
    allTeams.find((t) => normalise(t.name) === normalise(name) || (t.tag && normalise(t.tag) === normalise(name)));
  const findPlayer = (name: string) =>
    players.find((p) => normalise(p.name) === normalise(name) || (p.nickname && normalise(p.nickname) === normalise(name)));

  const teamAId = input.teamAId ?? findTeam(result.teamA.name)?.id ?? null;
  const teamBId = input.teamBId ?? findTeam(result.teamB.name)?.id ?? null;
  res.json({
    raw: result,
    suggestion: {
      teamAId,
      teamBId,
      scoreA: result.teamA.score,
      scoreB: result.teamB.score,
      playerStats: result.players.map((p) => {
        const match = findPlayer(p.name);
        const sideTeam = p.side === "A" ? teamAId : p.side === "B" ? teamBId : null;
        return {
          readName: p.name,
          playerId: match?.id ?? null,
          teamId: sideTeam ?? match?.teamId ?? null,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          score: p.score,
        };
      }),
      notes: result.notes,
    },
  });
});

import { z } from "zod";

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const searchQuery = pagination.extend({ search: z.string().trim().max(100).optional() });

/** Optional free-text field: blank strings are stored as null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Accepts an absolute http(s) URL or a path to a file uploaded to this API (/uploads/...). */
const imageUrl = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\//.test(v) || /^\/uploads\/[\w.-]+$/.test(v), {
    message: "Must be an http(s) URL or an uploaded file path",
  });

const optionalId = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null));

export const teamInput = z.object({
  name: z.string().trim().min(1).max(100),
  tag: optionalText(12),
  country: optionalText(60),
  logoUrl: imageUrl,
});

export const playerInput = z.object({
  name: z.string().trim().min(1).max(100),
  nickname: optionalText(100),
  country: optionalText(60),
  role: optionalText(60),
  avatarUrl: imageUrl,
  teamId: optionalId,
});

export const tournamentStatus = z.enum(["UPCOMING", "ONGOING", "COMPLETED"]);

export const tournamentInput = z.object({
  name: z.string().trim().min(1).max(150),
  game: optionalText(100),
  location: optionalText(150),
  description: optionalText(2000),
  status: tournamentStatus.default("UPCOMING"),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullish(),
});

export const datesInOrder = (t: { startDate?: Date; endDate?: Date | null }) =>
  !t.startDate || !t.endDate || t.endDate >= t.startDate;

const count = z.coerce.number().int().min(0).max(100000);

export const playerStatInput = z.object({
  playerId: z.string().min(1),
  teamId: z.string().min(1).optional(),
  kills: count.default(0),
  deaths: count.default(0),
  assists: count.default(0),
  score: count.default(0),
});

export const matchInput = z
  .object({
    tournamentId: z.string().min(1),
    teamAId: z.string().min(1),
    teamBId: z.string().min(1),
    scoreA: count,
    scoreB: count,
    round: optionalText(60),
    notes: optionalText(1000),
    imageUrl,
    playedAt: z.coerce.date().optional(),
    playerStats: z.array(playerStatInput).max(100).default([]),
  })
  .refine((m) => m.teamAId !== m.teamBId, {
    message: "A team cannot play against itself",
    path: ["teamBId"],
  })
  .refine((m) => new Set(m.playerStats.map((p) => p.playerId)).size === m.playerStats.length, {
    message: "Each player can only have one stat line per match",
    path: ["playerStats"],
  });

export const entryInput = z.object({
  teamId: z.string().min(1),
  placement: z.coerce.number().int().min(1).nullish(),
});

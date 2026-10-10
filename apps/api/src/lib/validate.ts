import { z } from "zod";
import { FORMATS } from "./bracket.js";

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
  /** null = no bracket: results are recorded freely. */
  format: z.enum(FORMATS).nullish().transform((v) => v ?? null),
  bestOf: z.coerce.number().int().min(1).max(9).refine((n) => n % 2 === 1, { message: "Best of must be an odd number" }).default(3),
  lateMinutes: z.coerce.number().int().min(0).max(240).default(15),
  rosterMin: z.coerce.number().int().min(1).max(10).default(3),
  rosterMax: z.coerce.number().int().min(1).max(10).default(5),
  maxTeams: z.coerce.number().int().min(2).max(256).nullish().transform((v) => v ?? null),
  registrationOpen: z.boolean().default(false),
  thirdPlaceMatch: z.boolean().default(false),
  grandFinalReset: z.boolean().default(true),
});

export const rosterSizeOk = (t: { rosterMin?: number; rosterMax?: number }) => t.rosterMin === undefined || t.rosterMax === undefined || t.rosterMin <= t.rosterMax;

export const datesInOrder = (t: { startDate?: Date; endDate?: Date | null }) =>
  !t.startDate || !t.endDate || t.endDate >= t.startDate;

const count = z.coerce.number().int().min(0).max(100000);
const optionalCount = z.preprocess((v) => (v === "" || v === null ? undefined : v), count.optional());

/** Lower-cases and drops spaces/punctuation so "EGOIST<1>" and "egoist 1" compare equal. */
export const normaliseName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export const awards = ["MVP", "SVP"] as const;

/** An id that may be left out, null or blank. */
const optionalRef = z.string().trim().nullish().transform((v) => v || undefined);

/** One row of a game's scoreboard. Give playerId, or a name to match (or create) the player. */
export const playerStatInput = z
  .object({
    playerId: optionalRef,
    name: z.string().trim().min(1).max(100).nullish().transform((v) => v ?? undefined),
    side: z.enum(["A", "B"]),
    pts: count.default(0),
    reb: count.default(0),
    blk: count.default(0),
    stl: count.default(0),
    ast: count.default(0),
    lbr: count.default(0),
    rating: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().min(0).max(1000).nullish()).transform((v) => v ?? null),
    award: z.preprocess((v) => (v === "" ? null : v), z.enum(awards).nullish()).transform((v) => v ?? null),
  })
  .refine((p) => p.playerId || p.name, { message: "Give a playerId or a player name", path: ["name"] });

export const gameInput = z.object({
  scoreA: count,
  scoreB: count,
  imageUrl,
  players: z.array(playerStatInput).max(20).default([]),
});

const playerKey = (p: z.infer<typeof playerStatInput>) => p.playerId ?? `name:${normaliseName(p.name ?? "")}`;

/**
 * A series result. Teams are given by id, or by name (an unknown name creates the team).
 * scoreA/scoreB are games won; when left out they are counted from the games.
 */
export const matchInput = z
  .object({
    tournamentId: z.string().min(1),
    teamAId: optionalRef,
    teamAName: z.string().trim().max(100).nullish().transform((v) => v || undefined),
    teamBId: optionalRef,
    teamBName: z.string().trim().max(100).nullish().transform((v) => v || undefined),
    scoreA: optionalCount,
    scoreB: optionalCount,
    round: optionalText(60),
    notes: optionalText(1000),
    imageUrl,
    playedAt: z.coerce.date().optional(),
    source: optionalText(40),
    sourceRef: optionalText(200),
    games: z.array(gameInput).max(9).default([]),
  })
  .refine((m) => m.teamAId || m.teamAName, { message: "Choose team A", path: ["teamAId"] })
  .refine((m) => m.teamBId || m.teamBName, { message: "Choose team B", path: ["teamBId"] })
  .refine(
    (m) =>
      m.teamAId && m.teamBId
        ? m.teamAId !== m.teamBId
        : !(m.teamAName && m.teamBName && normaliseName(m.teamAName) === normaliseName(m.teamBName)),
    { message: "A team cannot play against itself", path: ["teamBId"] },
  )
  .refine((m) => m.games.length > 0 || (m.scoreA !== undefined && m.scoreB !== undefined), {
    message: "Enter the series score or at least one game",
    path: ["scoreA"],
  })
  .refine((m) => m.games.every((g) => new Set(g.players.map(playerKey)).size === g.players.length), {
    message: "Each player can only appear once per game",
    path: ["games"],
  });

export const entryInput = z.object({
  teamId: z.string().min(1),
  placement: z.coerce.number().int().min(1).nullish(),
});

const discordId = z.string().trim().regex(/^\d{5,25}$/, "Must be a Discord user id").nullish().transform((v) => v ?? null);

/** One player on a team's roster: their in-game name, and their Discord account if they have one. */
export const rosterPlayerInput = z.object({
  name: z.string().trim().min(1).max(100),
  discordId,
});

export const rosterInput = z.object({
  players: z.array(rosterPlayerInput).min(1).max(10),
  captainDiscordId: discordId.optional(),
  /** Organizer override: allows changes after the roster lock. */
  override: z.boolean().default(false),
});

export const registrationInput = rosterInput.extend({
  teamName: z.string().trim().min(1).max(100),
  tag: optionalText(12),
});

export const seedingInput = z.object({
  method: z.enum(["rating", "random", "manual"]).default("rating"),
  /** manual: every registered team id, best seed first. */
  order: z.array(z.string()).optional(),
  /** manual, elimination only: the first round as pairs of slots (null = bye). Overrides order. */
  positions: z.array(z.string().nullable()).optional(),
});

/** A bracket match result: the teams come from the bracket slot, side A/B as the slot shows them. */
export const bracketResultInput = z
  .object({
    scoreA: optionalCount,
    scoreB: optionalCount,
    notes: optionalText(1000),
    imageUrl,
    playedAt: z.coerce.date().optional(),
    source: optionalText(40),
    sourceRef: optionalText(200),
    games: z.array(gameInput).max(9).default([]),
    /** Replaces the result of a match that already has one (a correction). */
    replace: z.boolean().default(false),
    /** Allows wiping later results when a corrected result changes the winner. */
    force: z.boolean().default(false),
  })
  .refine((m) => m.games.length > 0 || (m.scoreA !== undefined && m.scoreB !== undefined), {
    message: "Enter the series score or at least one game",
    path: ["scoreA"],
  })
  .refine((m) => m.games.every((g) => new Set(g.players.map(playerKey)).size === g.players.length), {
    message: "Each player can only appear once per game",
    path: ["games"],
  });

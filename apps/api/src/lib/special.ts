/**
 * The special "เล่นเก่งปากเก่ง" events: substitutes who sign up season by season (their details are
 * entered once and kept for the next season), and a separate rating and stats board. Tournaments marked special move only the
 * special MMR (elo.ts) and never the main ranking, team ratings or main stats.
 *
 * Facebook and phone are private: the public list leaves them out, admins and organizers see them.
 */
import { z } from "zod";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { claimByUid, waitingForApproval } from "./members.js";
import { findByUid } from "./players.js";
import { MMR_K, MVP_BONUS, PLACEMENT_K, PLACEMENT_SERIES, START_MMR, SVP_BONUS } from "./mmr.js";
import { MOVEMENT_DAYS, playerBoard, tierCounts, tierInfo, withRanks } from "./leaderboard.js";
import { emptyPlayerStats, statLineSelect, statsByPlayer } from "./stats.js";
import { positionField } from "./validate.js";
import { teamSummary } from "./selects.js";
import { ranksOf } from "./solo.js";
import { currentSeason, forGame, listSeasons, openReserveSeasons, seasonPlayerIds } from "./seasons.js";

const noControl = /^[^\u0000-\u001f\u007f]*$/;
const FACEBOOK_HOSTS = /^(?:[a-z0-9-]+\.)*(?:facebook\.com|fb\.com|fb\.me|m\.me)$/i;

/** A Facebook name or profile link. A link must point at Facebook, so nobody can put another site in front of admins. */
export const facebookField = z
  .string()
  .trim()
  .min(2, "Facebook is too short")
  .max(200)
  .regex(noControl, "Invalid characters")
  .refine(
    (v) => {
      const link = /^[a-z][a-z0-9+.-]*:\S*$|^www\.|^[\w-]+(?:\.[\w-]+)+\//i.test(v);
      if (!link) return true; // a name
      try {
        const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
        return (url.protocol === "https:" || url.protocol === "http:") && FACEBOOK_HOSTS.test(url.hostname);
      } catch {
        return false;
      }
    },
    { message: "Use a Facebook name or a facebook.com link" },
  );

/** An optional phone number: at least 6 digits, with the usual + - ( ) and spaces. */
export const phoneField = z
  .string()
  .trim()
  .max(20)
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || (/^[0-9+\-() ]+$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 6), { message: "Phone must be at least 6 digits" });

const rankField = z.string().trim().max(30).regex(noControl).nullish().transform((v) => v || null);

export const reserveInput = z.object({
  /** One of the member's characters, or uid (+ name for a new one) to link or create it on the way. */
  playerId: z.string().trim().min(1).max(40).optional(),
  uid: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().max(100).regex(noControl).optional(),
  /** The game of a new character signed up by UID (the default: the busiest game). */
  gameId: z.string().trim().min(1).max(40).optional(),
  position: positionField.refine((p) => p !== null, { message: "Choose a position" }),
  facebook: facebookField,
  phone: phoneField,
  /** One of the game's in-game ranks (the same list as solo tournaments). */
  rank: rankField.refine((r) => r !== null, { message: "Choose a rank" }),
  /** The season to sign up for; may be left out while only one season is open. */
  seasonId: z.string().trim().min(1).max(40).optional(),
});

/** Admins may fix any field; leaving one out keeps it. */
export const reserveEdit = z.object({
  position: positionField.optional(),
  facebook: z.union([z.literal(""), facebookField]).nullish().transform((v) => v || null).optional(),
  phone: phoneField.optional(),
  rank: rankField.optional(),
});

const THAI_PROBLEMS: Record<string, string> = {
  playerId: "เลือกตัวละครก่อน",
  uid: "ใส่ UID",
  name: "ชื่อตัวละครยาวเกินไป",
  position: "เลือกตำแหน่ง: บอลหลัก, บอลรอง, เซนเตอร์ หรือ All Around",
  facebook: "ใส่ชื่อ Facebook หรือลิงก์ facebook.com (2-200 ตัวอักษร)",
  phone: "เบอร์โทรต้องเป็นตัวเลขอย่างน้อย 6 หลัก (ไม่ใส่ก็ได้)",
  rank: "เลือกแรงค์ของคุณ",
  seasonId: "เลือกซีซั่นที่จะสมัคร",
};

/** Parses a form, turning the first problem into a Thai message that Discord and the website can show as is. */
function parseThai<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const field = String(issue?.path[0] ?? "");
  throw fail(400, "Validation failed", THAI_PROBLEMS[field] ?? "ข้อมูลไม่ถูกต้อง", { field, fieldErrors: r.error.flatten().fieldErrors });
}

const importInput = z.object({
  players: z
    .array(
      z.object({
        discordId: z.string().regex(/^\d{5,25}$/),
        name: z.string().trim().min(1).max(100),
        uid: z.string().trim().min(1).max(40),
        server: z.string().trim().max(40).optional(),
        rank: rankField,
      }),
    )
    .max(500),
});

const playerSelect = { id: true, name: true, nickname: true, avatarUrl: true, uid: true, server: true, role: true, specialMmr: true, team: teamSummary } as const;

/** The seasons a sign-up is on, newest first. */
const seasonsInclude = { seasons: { select: { season: { select: { id: true, name: true, startDate: true } } } } } as const;
const reserveInclude = { player: { select: playerSelect }, ...seasonsInclude } as const;

type WithSeasons = { seasons: { season: { id: string; name: string; startDate: Date } }[] };
const flatSeasons = <T extends WithSeasons>({ seasons, ...r }: T) => ({
  ...r,
  seasons: seasons.map((x) => ({ id: x.season.id, name: x.season.name, startDate: x.season.startDate })).sort((a, b) => +b.startDate - +a.startDate).map(({ id, name }) => ({ id, name })),
});

/**
 * Everyone on the list, oldest sign-up first; with seasonId only those signed up for that season.
 * The public list leaves out Facebook, phone and the Discord account; withContact (admins only) includes them.
 */
export async function reserveList(withContact = false, gameId?: string | null, seasonId?: string | null) {
  const rows = await prisma.reservePlayer.findMany({
    where: { ...inGame(gameId), ...(seasonId ? { seasons: { some: { seasonId } } } : {}) },
    orderBy: { createdAt: "asc" },
    include: reserveInclude,
  });
  return rows.map((row) => {
    const { facebook, phone, discordId, ...r } = flatSeasons(row);
    return { ...r, ...(withContact ? { facebook, phone, discordId } : {}) };
  });
}

/**
 * The season a sign-up goes to: the one asked for, which must be open and of the character's game,
 * or, when none is named, the only open season. Several open seasons need a choice. Someone already
 * on the list who names no season only edits their details (null).
 */
async function signupSeason(seasonId: string | undefined, gameId: string | null, discordId: string) {
  if (!seasonId && (await prisma.reservePlayer.findFirst({ where: { discordId, ...inGame(gameId) }, select: { id: true } }))) return null;
  if (seasonId) {
    const season = await prisma.specialSeason.findUnique({ where: { id: seasonId }, select: { id: true, name: true, gameId: true, reserveOpen: true } });
    if (!season) throw fail(404, "Season not found", "ไม่พบซีซั่นนี้", { field: "seasonId" });
    if (!season.reserveOpen) throw fail(409, "Sign-ups for this season are closed", `ซีซั่น ${season.name} ปิดรับตัวสำรองแล้ว`, { field: "seasonId" });
    if (season.gameId && gameId && season.gameId !== gameId) throw fail(400, "The season is of another game", `ซีซั่น ${season.name} เป็นของเกมอื่น`, { field: "seasonId" });
    return season;
  }
  const open = await openReserveSeasons(gameId);
  if (!open.length) throw fail(409, "No season is taking substitutes", "ตอนนี้ยังไม่เปิดรับตัวสำรองซีซั่นไหน รอผู้จัดประกาศนะ", { field: "seasonId" });
  if (open.length > 1) throw fail(400, "Choose a season", THAI_PROBLEMS.seasonId, { field: "seasonId", seasons: open.map(({ id, name }) => ({ id, name })) });
  return open[0];
}

async function ownPlayer(discordId: string, playerId: string) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.discordId !== discordId) throw fail(403, "Not your character", "ตัวละครนี้ไม่ใช่ของคุณ");
  return player;
}

/** Each game keeps its own list: UIDs and character names differ between games. */
const inGame = (gameId: string | null | undefined) => (gameId ? { player: { gameId } } : {});

/** The game a sign-up is for: the one asked for, or the default (the busiest game). */
export async function reserveGame(gameId?: string | null) {
  return gameId || (await specialGame());
}

/** The game of the character a form names, before anything is linked or created. */
async function formGame(discordId: string, input: { playerId?: string; uid?: string; gameId?: string }) {
  if (input.playerId) return (await ownPlayer(discordId, input.playerId)).gameId ?? (await reserveGame(input.gameId));
  const owner = input.uid ? await findByUid(prisma, input.uid, null) : null;
  return owner?.gameId ?? (await reserveGame(input.gameId));
}

/** The ranks to pick from: the game's in-game ranks, lowest first (the same list solo tournaments use). */
export async function reserveRanks(gameId?: string | null) {
  return ranksOf({ gameId: gameId ?? (await specialGame()) });
}

async function checkRank(rank: string, gameId: string | null) {
  const ranks = await reserveRanks(gameId);
  if (!ranks.some((r) => r.name === rank)) throw fail(400, "Unknown rank", `ไม่มีแรงค์ "${rank}" เลือกจาก: ${ranks.map((r) => r.name).join(", ")}`, { field: "rank" });
}

/** Checks a member's sign-up form without saving it, rank optional (Discord asks for the rank after the form). */
export async function checkReserve(discordId: string, body: unknown) {
  const input = parseThai(reserveInput.extend({ rank: rankField }), body);
  const game = await formGame(discordId, input);
  if (input.rank) await checkRank(input.rank, game);
  await signupSeason(input.seasonId, game, discordId);
  if (input.playerId) {
    await ownPlayer(discordId, input.playerId);
  } else if (input.uid) {
    const owner = await findByUid(prisma, input.uid, null);
    if (owner?.discordId && owner.discordId !== discordId) throw fail(409, "This player is linked to another Discord account", `UID ${input.uid} ผูกกับบัญชี Discord อื่นอยู่แล้ว ถ้าเป็นของคุณจริงให้ติดต่อผู้จัด`);
    if (!owner && !input.name) throw fail(400, "Send a name for a new character", "ใส่ชื่อตัวละคร");
  } else throw fail(400, "Send playerId or uid", THAI_PROBLEMS.playerId);
}

/**
 * A member signs up for a season (again to change their details or character, or to add another season).
 * Their position becomes their position on the site too.
 */
export async function joinReserve(discordId: string, body: unknown) {
  const input = parseThai(reserveInput, body);
  // Everything is checked before a character is linked or created, so a bad form leaves nothing behind.
  const game = await formGame(discordId, input);
  await checkRank(input.rank!, game);
  const season = await signupSeason(input.seasonId, game, discordId);
  let playerId = input.playerId ?? null;
  if (!playerId && input.uid) {
    const claimed = await claimByUid(discordId, { uid: input.uid, name: input.name || undefined, gameId: input.gameId ?? (await busiestGame()) ?? undefined });
    if (claimed.pending) throw waitingForApproval(input.uid);
    playerId = claimed.player.id;
  }
  if (!playerId) throw fail(400, "Send playerId or uid", THAI_PROBLEMS.playerId);
  const player = await ownPlayer(discordId, playerId);
  const taken = await prisma.reservePlayer.findUnique({ where: { playerId: player.id } });
  if (taken?.discordId && taken.discordId !== discordId) throw fail(409, "Signed up by another account", "ตัวละครนี้ถูกลงชื่อไว้โดยบัญชีอื่นแล้ว");
  const data = { position: input.position, facebook: input.facebook, phone: input.phone, rank: input.rank, discordId };
  await prisma.$transaction(async (tx) => {
    // One sign-up per account in each game: switching to another character of the same game moves it, seasons included.
    const moving = await tx.seasonReserve.findMany({ where: { reserve: { discordId, playerId: { not: player.id }, ...inGame(player.gameId) } }, select: { seasonId: true } });
    await tx.reservePlayer.deleteMany({ where: { discordId, playerId: { not: player.id }, ...inGame(player.gameId) } });
    await tx.reservePlayer.upsert({ where: { playerId: player.id }, create: { playerId: player.id, ...data }, update: data });
    for (const seasonId of new Set([...moving.map((m) => m.seasonId), ...(season ? [season.id] : [])])) {
      await tx.seasonReserve.upsert({ where: { seasonId_playerId: { seasonId, playerId: player.id } }, create: { seasonId, playerId: player.id }, update: {} });
    }
    await tx.player.update({ where: { id: player.id }, data: { role: input.position, inGameRank: input.rank } });
  });
  const row = await prisma.reservePlayer.findUniqueOrThrow({ where: { playerId: player.id }, include: reserveInclude });
  return { ...flatSeasons(row), joinedSeason: season && { id: season.id, name: season.name } };
}

/** With several games, a new character for the special events joins the one most players play. */
async function busiestGame() {
  const games = await prisma.game.findMany({ select: { id: true, _count: { select: { players: true } } } });
  if (games.length < 2) return null;
  return games.sort((a, b) => b._count.players - a._count.players)[0].id;
}

/** The game the special events are played in: the busiest one, or the only one. */
async function specialGame() {
  return (await busiestGame()) ?? (await prisma.game.findFirst({ select: { id: true } }))?.id ?? null;
}

/** The member's own sign-up in one game (the default game when none is given), with their own contact details, or null. */
export async function myReserve(discordId: string, gameId?: string | null) {
  const row = await prisma.reservePlayer.findFirst({ where: { discordId, ...inGame(await reserveGame(gameId)) }, include: reserveInclude });
  return row && flatSeasons(row);
}

/** All the member's sign-ups, one per game at most. */
export async function myReserves(discordId: string) {
  const rows = await prisma.reservePlayer.findMany({ where: { discordId }, orderBy: { createdAt: "asc" }, include: { player: { select: { ...playerSelect, gameId: true } }, ...seasonsInclude } });
  return rows.map(flatSeasons);
}

/** Leaves one season with seasonId (the details stay for the next one), or the whole list without it. */
export async function leaveReserve(discordId: string, gameId?: string | null, seasonId?: string | null) {
  const where = { discordId, ...inGame(await reserveGame(gameId)) };
  const { count } = seasonId
    ? await prisma.seasonReserve.deleteMany({ where: { seasonId, reserve: where } })
    : await prisma.reservePlayer.deleteMany({ where });
  if (!count) throw fail(404, "Not signed up", seasonId ? "คุณยังไม่ได้สมัครซีซั่นนี้" : "คุณยังไม่ได้ลงชื่อ");
}

/** An organizer puts a substitute on a season's list (open or not), or takes them off it. */
export async function setReserveSeason(seasonId: string, playerId: string, on: boolean) {
  const [season, reserve] = await Promise.all([
    prisma.specialSeason.findUnique({ where: { id: seasonId }, select: { id: true, gameId: true } }),
    prisma.reservePlayer.findUnique({ where: { playerId }, select: { playerId: true, player: { select: { gameId: true } } } }),
  ]);
  if (!season) throw notFound("Season");
  if (!reserve) throw notFound("Reserve player");
  if (!on) {
    await prisma.seasonReserve.deleteMany({ where: { seasonId, playerId } });
    return;
  }
  if (season.gameId && reserve.player.gameId && season.gameId !== reserve.player.gameId) throw fail(400, "The season is of another game", "ซีซั่นนี้เป็นของเกมอื่น");
  await prisma.seasonReserve.upsert({ where: { seasonId_playerId: { seasonId, playerId } }, create: { seasonId, playerId }, update: {} });
}

const BACKFILLED = "reserveSeasonsBackfilled";

/**
 * Once, when season sign-ups arrive: everyone already on the list joins the latest season of their game,
 * which opens for sign-ups, so nobody has to sign up again. Returns how many were added.
 */
export async function backfillReserveSeasons() {
  if (await prisma.siteSetting.findUnique({ where: { key: BACKFILLED } })) return 0;
  const reserves = await prisma.reservePlayer.findMany({ select: { playerId: true, player: { select: { gameId: true } } } });
  const latest = new Map<string, string | null>();
  let added = 0;
  await prisma.$transaction(async (tx) => {
    for (const r of reserves) {
      const key = r.player.gameId ?? "";
      if (!latest.has(key)) {
        const season = await tx.specialSeason.findFirst({ where: forGame(r.player.gameId), orderBy: [{ startDate: "desc" }, { createdAt: "desc" }], select: { id: true } });
        latest.set(key, season?.id ?? null);
        if (season) await tx.specialSeason.update({ where: { id: season.id }, data: { reserveOpen: true } });
      }
      const seasonId = latest.get(key);
      if (!seasonId) continue;
      await tx.seasonReserve.upsert({ where: { seasonId_playerId: { seasonId, playerId: r.playerId } }, create: { seasonId, playerId: r.playerId }, update: {} });
      added++;
    }
    await tx.siteSetting.create({ data: { key: BACKFILLED, value: new Date().toISOString() } });
  });
  return added;
}

export async function editReserve(playerId: string, body: unknown) {
  const input = parseThai(reserveEdit, body);
  const row = await prisma.reservePlayer.findUnique({ where: { playerId }, include: { player: { select: { gameId: true } } } });
  if (!row) throw notFound("Reserve player");
  if (input.rank) await checkRank(input.rank, row.player.gameId);
  const saved = await prisma.$transaction(async (tx) => {
    if (input.position || input.rank) await tx.player.update({ where: { id: playerId }, data: { ...(input.position ? { role: input.position } : {}), ...(input.rank ? { inGameRank: input.rank } : {}) } });
    return tx.reservePlayer.update({ where: { playerId }, data: input, include: reserveInclude });
  });
  return flatSeasons(saved);
}

export async function removeReserve(playerId: string) {
  const { count } = await prisma.reservePlayer.deleteMany({ where: { playerId } });
  if (!count) throw notFound("Reserve player");
}

/**
 * Carries the old Discord-only list over: each person is linked to their character by UID (created
 * when new) and keeps their rank. Facebook and position stay empty until they edit their sign-up.
 * People already on the list, or whose UID belongs to another account, are skipped.
 */
export async function importReserve(body: unknown) {
  const { players } = importInput.parse(body);
  let added = 0;
  const skipped: { discordId: string; reason: string }[] = [];
  for (const p of players) {
    if (await prisma.reservePlayer.findFirst({ where: { discordId: p.discordId } })) {
      skipped.push({ discordId: p.discordId, reason: "already signed up" });
      continue;
    }
    try {
      // The organizer's own list: linked straight away.
      const { player } = await claimByUid(p.discordId, { uid: p.uid, server: p.server || undefined, name: p.name }, { trusted: true });
      if (await prisma.reservePlayer.findUnique({ where: { playerId: player.id } })) {
        skipped.push({ discordId: p.discordId, reason: "character already on the list" });
        continue;
      }
      await prisma.reservePlayer.create({ data: { playerId: player.id, discordId: p.discordId, rank: p.rank } });
      added++;
    } catch (e) {
      skipped.push({ discordId: p.discordId, reason: e instanceof Error ? e.message : "failed" });
    }
  }
  return { added, skipped };
}

const specialLines = (where: object = {}, gameId?: string | null, seasonId?: string | null) =>
  prisma.matchPlayerStat.findMany({ where: { ...where, match: { tournament: { special: true, ...(gameId ? { gameId } : {}), ...(seasonId ? { seasonId } : {}) } } }, select: statLineSelect });

/**
 * The special board: MMR ladder, players still placing, per-player stats, the events and the substitutes list.
 * With seasonId it shows one season: the ladder of the players on its list (the MMR carries on across
 * seasons), the stats and events of that season only. seasons lists them all for a picker.
 */
export async function specialBoard(gameId?: string | null, seasonId?: string | null) {
  const season = seasonId ? await prisma.specialSeason.findUnique({ where: { id: seasonId }, select: { id: true, name: true, gameId: true, startDate: true, endDate: true } }) : null;
  if (seasonId && !season) throw notFound("Season");
  const game = gameId ?? season?.gameId ?? null;
  const [board, lines, events, reserve, ranks, seasons, current, roster] = await Promise.all([
    playerBoard(game, new Date(), true),
    specialLines({}, game, seasonId),
    prisma.tournament.findMany({
      where: { special: true, ...(game ? { gameId: game } : {}), ...(seasonId ? { seasonId } : {}) },
      orderBy: { startDate: "desc" },
      include: { _count: { select: { matches: true, entries: true } } },
    }),
    reserveList(false, game, seasonId),
    reserveRanks(game),
    listSeasons(game),
    currentSeason(game),
    seasonPlayerIds(seasonId),
  ]);
  const inSeason = <T extends { id: string }>(rows: T[]) => (roster ? rows.filter((r) => roster.has(r.id)) : rows);
  // A season's ladder ranks its own players; movement is measured on the whole ladder, so it is left out.
  const ranked = roster ? withRanks(inSeason(board.ranked).map(({ rank, ...r }) => ({ ...r, rankChange: null as number | null })), (r) => r.mmr) : board.ranked;
  const stats = statsByPlayer(lines);
  const players = await prisma.player.findMany({ where: { id: { in: [...stats.keys()] } }, select: playerSelect });
  const statRows = withRanks(
    players
      .map((p) => ({ ...p, mmr: p.specialMmr, ...tierInfo(p.specialMmr), stats: stats.get(p.id) ?? emptyPlayerStats() }))
      .sort((a, b) => b.stats.pts - a.stats.pts || b.stats.games - a.stats.games || a.name.localeCompare(b.name)),
    (p) => p.stats.pts,
  );
  return {
    season: season ? { ...season, players: roster!.size } : null,
    seasons,
    currentSeasonId: current?.id ?? null,
    ranked,
    placing: inSeason(board.placing),
    tiers: tierCounts(ranked),
    stats: statRows,
    events: events.map(({ _count, ...t }) => ({ ...t, matches: _count.matches, teamCount: _count.entries })),
    reserve,
    /** Seasons taking substitutes now, for the sign-up forms. */
    reserveSeasons: await openReserveSeasons(game),
    ranks,
    rules: { start: START_MMR, k: MMR_K, placementK: PLACEMENT_K, placementSeries: PLACEMENT_SERIES, mvpBonus: MVP_BONUS, svpBonus: SVP_BONUS, movementDays: MOVEMENT_DAYS },
  };
}

/** A player's special record for their profile, or null when they never played a special event. */
export async function specialSummary(playerId: string) {
  const [player, changes, lines] = await Promise.all([
    prisma.player.findUnique({ where: { id: playerId }, select: { specialMmr: true, specialPeakMmr: true, gameId: true } }),
    prisma.playerMmrChange.count({ where: { playerId, match: { tournament: { special: true } } } }),
    specialLines({ playerId }),
  ]);
  if (!player || (!changes && !lines.length)) return null;
  const board = await playerBoard(player.gameId, new Date(), true);
  const onBoard = board.ranked.find((p) => p.id === playerId);
  return {
    mmr: player.specialMmr,
    peakMmr: player.specialPeakMmr,
    ...tierInfo(player.specialMmr),
    series: changes,
    placed: changes >= PLACEMENT_SERIES,
    rank: onBoard?.rank ?? null,
    rankedPlayers: board.ranked.length,
    stats: statsByPlayer(lines).get(playerId) ?? emptyPlayerStats(),
  };
}

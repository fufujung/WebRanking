/**
 * The special "เล่นเก่งปากเก่ง" events: a standing list of substitutes that is always open and serves
 * every event, and a separate rating and stats board. Tournaments marked special move only the
 * special MMR (elo.ts) and never the main ranking, team ratings or main stats.
 *
 * Facebook and phone are private: the public list leaves them out, admins and organizers see them.
 */
import { z } from "zod";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { claimByUid } from "./members.js";
import { MMR_K, MVP_BONUS, PLACEMENT_K, PLACEMENT_SERIES, START_MMR, SVP_BONUS } from "./mmr.js";
import { MOVEMENT_DAYS, playerBoard, tierCounts, tierInfo, withRanks } from "./leaderboard.js";
import { emptyPlayerStats, statLineSelect, statsByPlayer } from "./stats.js";
import { positionField } from "./validate.js";
import { teamSummary } from "./selects.js";

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
  position: positionField.refine((p) => p !== null, { message: "Choose a position" }),
  facebook: facebookField,
  phone: phoneField,
  rank: rankField,
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
  rank: "แรงค์ไม่ถูกต้อง",
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

/**
 * Everyone on the list, oldest sign-up first. The public list leaves out Facebook, phone and the
 * Discord account; withContact (admins only) includes them.
 */
export async function reserveList(withContact = false) {
  const rows = await prisma.reservePlayer.findMany({ orderBy: { createdAt: "asc" }, include: { player: { select: playerSelect } } });
  return rows.map(({ facebook, phone, discordId, ...r }) => ({ ...r, ...(withContact ? { facebook, phone, discordId } : {}) }));
}

async function ownPlayer(discordId: string, playerId: string) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.discordId !== discordId) throw fail(403, "Not your character", "ตัวละครนี้ไม่ใช่ของคุณ");
  return player;
}

/** A member signs up (again to change their details or character). Their position becomes their position on the site too. */
export async function joinReserve(discordId: string, body: unknown) {
  const input = parseThai(reserveInput, body);
  // Everything is checked before a character is linked or created, so a bad form leaves nothing behind.
  const playerId = input.playerId ?? (input.uid ? (await claimByUid(discordId, { uid: input.uid, server: null, name: input.name || null, gameId: await busiestGame() })).player.id : null);
  if (!playerId) throw fail(400, "Send playerId or uid", THAI_PROBLEMS.playerId);
  const player = await ownPlayer(discordId, playerId);
  const taken = await prisma.reservePlayer.findUnique({ where: { playerId: player.id } });
  if (taken?.discordId && taken.discordId !== discordId) throw fail(409, "Signed up by another account", "ตัวละครนี้ถูกลงชื่อไว้โดยบัญชีอื่นแล้ว");
  const data = { position: input.position, facebook: input.facebook, phone: input.phone, rank: input.rank, discordId };
  await prisma.$transaction(async (tx) => {
    // One sign-up per account: switching character moves it.
    await tx.reservePlayer.deleteMany({ where: { discordId, playerId: { not: player.id } } });
    await tx.reservePlayer.upsert({ where: { playerId: player.id }, create: { playerId: player.id, ...data }, update: data });
    await tx.player.update({ where: { id: player.id }, data: { role: input.position } });
  });
  return myReserve(discordId);
}

/** With several games, a new character for the special events joins the one most players play. */
async function busiestGame() {
  const games = await prisma.game.findMany({ select: { id: true, _count: { select: { players: true } } } });
  if (games.length < 2) return null;
  return games.sort((a, b) => b._count.players - a._count.players)[0].id;
}

/** The member's own sign-up, with their own contact details, or null. */
export async function myReserve(discordId: string) {
  return prisma.reservePlayer.findUnique({ where: { discordId }, include: { player: { select: playerSelect } } });
}

export async function leaveReserve(discordId: string) {
  const { count } = await prisma.reservePlayer.deleteMany({ where: { discordId } });
  if (!count) throw fail(404, "Not signed up", "คุณยังไม่ได้ลงชื่อ");
}

export async function editReserve(playerId: string, body: unknown) {
  const input = parseThai(reserveEdit, body);
  const row = await prisma.reservePlayer.findUnique({ where: { playerId } });
  if (!row) throw notFound("Reserve player");
  return prisma.$transaction(async (tx) => {
    if (input.position) await tx.player.update({ where: { id: playerId }, data: { role: input.position } });
    return tx.reservePlayer.update({ where: { playerId }, data: input, include: { player: { select: playerSelect } } });
  });
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
    if (await prisma.reservePlayer.findUnique({ where: { discordId: p.discordId } })) {
      skipped.push({ discordId: p.discordId, reason: "already signed up" });
      continue;
    }
    try {
      const { player } = await claimByUid(p.discordId, { uid: p.uid, server: p.server || null, name: p.name, gameId: null });
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

const specialLines = (where: object = {}) =>
  prisma.matchPlayerStat.findMany({ where: { ...where, match: { tournament: { special: true } } }, select: statLineSelect });

/** The special board: MMR ladder, players still placing, per-player stats, the events and the substitutes list. */
export async function specialBoard(gameId?: string | null) {
  const [board, lines, events, reserve] = await Promise.all([
    playerBoard(gameId, new Date(), true),
    specialLines(),
    prisma.tournament.findMany({
      where: { special: true },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true, status: true, startDate: true, _count: { select: { matches: true } } },
    }),
    reserveList(),
  ]);
  const stats = statsByPlayer(lines);
  const players = await prisma.player.findMany({ where: { id: { in: [...stats.keys()] } }, select: playerSelect });
  const statRows = withRanks(
    players
      .map((p) => ({ ...p, mmr: p.specialMmr, ...tierInfo(p.specialMmr), stats: stats.get(p.id) ?? emptyPlayerStats() }))
      .sort((a, b) => b.stats.pts - a.stats.pts || b.stats.games - a.stats.games || a.name.localeCompare(b.name)),
    (p) => p.stats.pts,
  );
  return {
    ranked: board.ranked,
    placing: board.placing,
    tiers: tierCounts(board.ranked),
    stats: statRows,
    events: events.map(({ _count, ...t }) => ({ ...t, matches: _count.matches })),
    reserve,
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

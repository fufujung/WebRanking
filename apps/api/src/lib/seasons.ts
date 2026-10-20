/**
 * Seasons of the special "เล่นเก่งปากเก่ง" events. A season belongs to one game and lists the players
 * (name + UID) allowed to play in its events. The special MMR carries on from season to season: a
 * season only groups events, stats and players.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { findByUid } from "./players.js";
import { gameIdOrNull } from "./games.js";
import { teamSummary } from "./selects.js";

type Db = Prisma.TransactionClient | typeof prisma;

const noControl = /^[^\u0000-\u001f\u007f]*$/;
/** One paste may list this many players. */
export const MAX_ROSTER_ROWS = 300;

export const seasonInput = z.object({
  name: z.string().trim().min(1).max(60).regex(noControl),
  gameId: z.string().trim().max(40).nullish().transform((v) => v || null),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullish().transform((v) => v ?? null),
});

const rosterRow = z.object({
  /** A player already on the site, or a UID (+ a name for someone new). */
  playerId: z.string().trim().min(1).max(40).optional(),
  uid: z.string().trim().min(1).max(40).regex(noControl).optional(),
  name: z.string().trim().max(100).regex(noControl).optional(),
});

/** Players to add: rows, or text pasted one player per line ("name UID" or "UID name"). */
export const rosterInput = z.object({
  players: z.array(rosterRow).max(MAX_ROSTER_ROWS).optional(),
  text: z.string().max(30_000).optional(),
});

const THAI: Record<string, string> = {
  name: "ใส่ชื่อซีซั่น (ไม่เกิน 60 ตัวอักษร)",
  gameId: "เลือกเกม",
  startDate: "ใส่วันเริ่มซีซั่น",
  endDate: "วันจบซีซั่นไม่ถูกต้อง",
  players: `เพิ่มได้ครั้งละไม่เกิน ${MAX_ROSTER_ROWS} คน`,
  text: "รายชื่อยาวเกินไป",
};

/** Parses a form, turning the first problem into a Thai message that Discord and the website can show as is. */
function parseThai<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const field = String(r.error.issues[0]?.path[0] ?? "");
  throw fail(400, "Validation failed", THAI[field] ?? "ข้อมูลไม่ถูกต้อง", { field, fieldErrors: r.error.flatten().fieldErrors });
}

const datesOk = (s: { startDate: Date; endDate: Date | null }) => {
  if (s.endDate && s.endDate < s.startDate) throw fail(400, "endDate must be on or after startDate", "วันจบซีซั่นต้องไม่ก่อนวันเริ่ม", { field: "endDate" });
};

const playerSelect = { id: true, name: true, nickname: true, avatarUrl: true, uid: true, server: true, role: true, specialMmr: true, gameId: true, team: teamSummary } as const;

/** Every season (of one game with gameId), newest first, with how many players and events it has. */
export async function listSeasons(gameId?: string | null) {
  const rows = await prisma.specialSeason.findMany({
    where: gameId ? { gameId } : {},
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { players: true, tournaments: true } } },
  });
  return rows.map(({ _count, ...s }) => ({ ...s, players: _count.players, events: _count.tournaments }));
}

/** The season running now: the latest one that has started. An ended season stays current until the next one starts. */
export async function currentSeason(gameId?: string | null, now = new Date()) {
  return prisma.specialSeason.findFirst({
    where: { startDate: { lte: now }, ...(gameId ? { gameId } : {}) },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });
}

/** One season with its players (by name) and its events (newest first). */
export async function seasonView(id: string) {
  const s = await prisma.specialSeason.findUnique({
    where: { id },
    include: {
      game: { select: { id: true, name: true } },
      players: { include: { player: { select: playerSelect } } },
      tournaments: { orderBy: { startDate: "desc" }, select: { id: true, name: true, status: true, startDate: true, _count: { select: { matches: true } } } },
    },
  });
  if (!s) throw notFound("Season");
  const players = s.players
    .map((r) => ({ ...r.player, addedAt: r.createdAt }))
    .sort((a, b) => (a.nickname || a.name).localeCompare(b.nickname || b.name));
  return { ...s, players, tournaments: s.tournaments.map(({ _count, ...t }) => ({ ...t, matches: _count.matches })) };
}

export async function createSeason(body: unknown) {
  const input = parseThai(seasonInput, body);
  datesOk(input);
  const gameId = await gameIdOrNull(prisma, input.gameId);
  return prisma.specialSeason.create({ data: { ...input, gameId } });
}

export async function updateSeason(id: string, body: unknown) {
  const input = parseThai(seasonInput.partial(), body);
  const existing = await prisma.specialSeason.findUnique({ where: { id } });
  if (!existing) throw notFound("Season");
  datesOk({ startDate: input.startDate ?? existing.startDate, endDate: input.endDate !== undefined ? input.endDate : existing.endDate });
  if (input.gameId !== undefined) {
    input.gameId = await gameIdOrNull(prisma, input.gameId);
    if (input.gameId !== existing.gameId) {
      const other = await prisma.tournament.findFirst({ where: { seasonId: id, gameId: { not: input.gameId } }, select: { name: true } });
      if (other && input.gameId) throw fail(409, "The season has events of another game", `ซีซั่นนี้มีรายการ ${other.name} ของเกมเดิมอยู่ เปลี่ยนเกมไม่ได้`);
    }
  }
  return prisma.specialSeason.update({ where: { id }, data: input });
}

/** Deletes a season and its list. Its events stay, without a season. */
export async function deleteSeason(id: string) {
  const { count } = await prisma.specialSeason.deleteMany({ where: { id } });
  if (!count) throw notFound("Season");
}

/**
 * Pasted text, one player per line. The UID is the last number on the line (4 digits or more);
 * the rest is the name. Commas, tabs, "|" and a "UID" label are ignored, so copied tables work too.
 */
export function parseRosterText(text: string) {
  const rows: { line: number; uid?: string; name?: string }[] = [];
  const problems: { line: number; text: string; reason: string }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const tokens = line.split(/[\s,|;\t]+/).filter((t) => t && !/^uid:?$/i.test(t));
    const at = tokens.map((t) => /^\d{4,20}$/.test(t)).lastIndexOf(true);
    if (at < 0) return void problems.push({ line: i + 1, text: line.slice(0, 120), reason: "ไม่พบ UID (ตัวเลข 4 หลักขึ้นไป)" });
    const name = tokens.filter((_, j) => j !== at).join(" ").slice(0, 100);
    rows.push({ line: i + 1, uid: tokens[at], ...(name ? { name } : {}) });
  });
  return { rows, problems };
}

/**
 * Adds players to a season's list. A UID already on the site joins that player (their name stays);
 * a new UID needs a name and creates the player in the season's game.
 * Rows that cannot be added are reported, never half-added.
 */
export async function addSeasonPlayers(seasonId: string, body: unknown) {
  const input = parseThai(rosterInput, body);
  const season = await prisma.specialSeason.findUnique({ where: { id: seasonId } });
  if (!season) throw notFound("Season");
  const parsed = input.text ? parseRosterText(input.text) : { rows: [], problems: [] };
  const rows: { line: number; playerId?: string; uid?: string; name?: string }[] = [...(input.players ?? []).map((p, i) => ({ line: i + 1, ...p })), ...parsed.rows];
  if (rows.length > MAX_ROSTER_ROWS) throw fail(400, "Too many players", THAI.players, { field: "players" });
  if (!rows.length && !parsed.problems.length) throw fail(400, "No players", "ใส่รายชื่ออย่างน้อย 1 คน (ชื่อ + UID บรรทัดละคน)", { field: "players" });

  const problems: { line: number; text: string; reason: string }[] = [...parsed.problems];
  const added: { id: string; name: string; uid: string | null; created: boolean }[] = [];
  let already = 0;
  const otherGame = (gameId: string | null) => Boolean(season.gameId && gameId && gameId !== season.gameId);
  for (const row of rows) {
    const label = [row.name, row.uid ? `UID ${row.uid}` : row.playerId].filter(Boolean).join(" ");
    let player: { id: string; name: string; uid: string | null; gameId: string | null } | null = null;
    let created = false;
    if (row.playerId) {
      player = await prisma.player.findUnique({ where: { id: row.playerId }, select: { id: true, name: true, uid: true, gameId: true } });
      if (!player) {
        problems.push({ line: row.line, text: label, reason: "ไม่พบผู้เล่นนี้" });
        continue;
      }
    } else if (row.uid) {
      player = await findByUid(prisma, row.uid, null);
      if (!player) {
        if (!row.name) {
          problems.push({ line: row.line, text: label, reason: "UID นี้ยังไม่มีในระบบ ใส่ชื่อตัวละครด้วย" });
          continue;
        }
        player = await prisma.player.create({ data: { name: row.name, uid: row.uid, gameId: season.gameId }, select: { id: true, name: true, uid: true, gameId: true } });
        created = true;
      }
    } else {
      problems.push({ line: row.line, text: label, reason: "ใส่ UID" });
      continue;
    }
    if (otherGame(player.gameId)) {
      problems.push({ line: row.line, text: label, reason: `${player.name} เป็นตัวละครของเกมอื่น` });
      continue;
    }
    const exists = await prisma.seasonPlayer.findUnique({ where: { seasonId_playerId: { seasonId, playerId: player.id } } });
    if (exists) {
      already++;
      continue;
    }
    await prisma.seasonPlayer.create({ data: { seasonId, playerId: player.id } });
    // A player without a game takes the season's, so the per-game boards find them.
    if (!player.gameId && season.gameId) await prisma.player.update({ where: { id: player.id }, data: { gameId: season.gameId } });
    added.push({ id: player.id, name: player.name, uid: player.uid, created });
  }
  return { added, already, problems };
}

export async function removeSeasonPlayer(seasonId: string, playerId: string) {
  const { count } = await prisma.seasonPlayer.deleteMany({ where: { seasonId, playerId } });
  if (!count) throw notFound("Season player");
}

/**
 * The season fields of a tournament being saved: a season makes the event special and gives it the
 * season's game when it has none; a season of another game is refused. An event unticked from
 * special (without a new season) leaves its season.
 */
export async function tournamentSeason(db: Db, input: { seasonId?: string | null; special?: boolean; gameId?: string | null }, existing?: { seasonId: string | null; gameId: string | null }) {
  if (!input.seasonId) {
    if (input.seasonId === null || (input.special === false && existing?.seasonId)) return { seasonId: null };
    return {};
  }
  const season = await db.specialSeason.findUnique({ where: { id: input.seasonId } });
  if (!season) throw fail(400, "Unknown season", "ไม่พบซีซั่นนี้", { field: "seasonId" });
  const gameId = input.gameId !== undefined ? input.gameId : (existing?.gameId ?? null);
  if (season.gameId && gameId && season.gameId !== gameId) throw fail(400, "The season is for another game", `${season.name} เป็นซีซั่นของเกมอื่น`, { field: "seasonId" });
  const game = !gameId && season.gameId ? await db.game.findUnique({ where: { id: season.gameId }, select: { id: true, name: true } }) : null;
  return { seasonId: season.id, special: true, ...(game ? { gameId: game.id, game: game.name } : {}) };
}

/**
 * Refuses players who are not on the season's list of a special event that has a season.
 * Called inside the transaction that adds them, so nothing is saved when someone is missing.
 */
export async function assertOnSeason(db: Db, t: { special: boolean; seasonId: string | null }, playerIds: string[]) {
  if (!t.special || !t.seasonId || !playerIds.length) return;
  const on = await db.seasonPlayer.findMany({ where: { seasonId: t.seasonId, playerId: { in: playerIds } }, select: { playerId: true } });
  const ok = new Set(on.map((r) => r.playerId));
  const missing = [...new Set(playerIds.filter((id) => !ok.has(id)))];
  if (!missing.length) return;
  const [season, players] = await Promise.all([
    db.specialSeason.findUnique({ where: { id: t.seasonId }, select: { name: true } }),
    db.player.findMany({ where: { id: { in: missing } }, select: { id: true, name: true, nickname: true, uid: true } }),
  ]);
  const names = players.map((p) => `${p.nickname || p.name}${p.uid ? ` (UID ${p.uid})` : ""}`).join(", ");
  throw fail(403, "Not on the season's list", `${names} ยังไม่มีชื่อในรายชื่อ ${season?.name ?? "ซีซั่น"} จึงลงแข่งรายการนี้ไม่ได้ ติดต่อผู้จัดให้เพิ่มชื่อก่อน`, {
    field: "season",
    missing: players.map((p) => ({ id: p.id, name: p.name, uid: p.uid })),
  });
}

/** The ids of a season's players, or null for no season. */
export async function seasonPlayerIds(seasonId: string | null | undefined) {
  if (!seasonId) return null;
  const rows = await prisma.seasonPlayer.findMany({ where: { seasonId }, select: { playerId: true } });
  return new Set(rows.map((r) => r.playerId));
}

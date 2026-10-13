/**
 * The blacklist: players whose team lost a bracket match by walkover because it did not check in
 * on time, plus anyone an organizer adds. Every standing entry takes BLACKLIST_PENALTY MMR; the
 * MMR replay (elo.ts) applies it, so lifting an entry or overturning the walkover gives it back.
 */
import { z } from "zod";
import { prisma } from "./db.js";
import { recomputeRatings } from "./elo.js";
import { fail, notFound } from "./errors.js";

export const BLACKLIST_PENALTY = 20;
export const WALKOVER_REASON = "แพ้บาย: ไม่มาเช็คอินตามเวลาแข่ง";

const view = {
  id: true,
  playerId: true,
  tournamentId: true,
  slotCode: true,
  matchNumber: true,
  teamName: true,
  source: true,
  reason: true,
  penalty: true,
  createdAt: true,
  liftedAt: true,
  liftNote: true,
  player: { select: { id: true, name: true, nickname: true, avatarUrl: true, uid: true, server: true, discordId: true, mmr: true } },
  tournament: { select: { id: true, name: true } },
} as const;

/** Did this team fail to show up for the match: no check-in, or one after the late allowance? */
function noShow(checkIn: Date | null, scheduledAt: Date | null, lateMinutes: number) {
  if (!checkIn) return true;
  return scheduledAt !== null && checkIn.getTime() > scheduledAt.getTime() + lateMinutes * 60_000;
}

/**
 * Brings a tournament's automatic entries in line with its bracket: one per player on the roster of
 * each team that lost by walkover without checking in on time. Entries for walkovers that were
 * overturned, reopened or reset go away. Lifted entries stay lifted. Replays MMR when anything changed.
 */
export async function syncBlacklist(tournamentId: string) {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true, lateMinutes: true } });
  if (!t) return { added: [], removed: 0 };
  const [rows, entries, existing] = await Promise.all([
    prisma.bracketMatch.findMany({ where: { tournamentId, status: "DONE", outcome: "WALKOVER" } }),
    prisma.tournamentEntry.findMany({
      where: { tournamentId },
      include: { team: { select: { name: true, players: { select: { id: true } } } }, roster: { select: { playerId: true } } },
    }),
    prisma.blacklistEntry.findMany({ where: { tournamentId, source: "AUTO" }, select: { id: true, slotCode: true, playerId: true } }),
  ]);
  const byTeam = new Map(entries.map((e) => [e.teamId, e]));
  const wanted = new Map<string, { slotCode: string; matchNumber: number; teamName: string; playerId: string }>();
  for (const r of rows) {
    if (!r.loserId) continue;
    const checkIn = r.loserId === r.teamAId ? r.checkInA : r.checkInB;
    if (!noShow(checkIn, r.scheduledAt, t.lateMinutes)) continue;
    const entry = byTeam.get(r.loserId);
    if (!entry) continue;
    // The players entered for this tournament; a team added without a roster counts its current players.
    const ids = entry.roster.length ? entry.roster.map((p) => p.playerId) : entry.team.players.map((p) => p.id);
    for (const playerId of ids) wanted.set(`${r.code}:${playerId}`, { slotCode: r.code, matchNumber: r.number, teamName: entry.team.name, playerId });
  }
  const have = new Set(existing.map((e) => `${e.slotCode}:${e.playerId}`));
  const stale = existing.filter((e) => !wanted.has(`${e.slotCode}:${e.playerId}`)).map((e) => e.id);
  const fresh = [...wanted.entries()].filter(([k]) => !have.has(k)).map(([, w]) => w);
  if (!stale.length && !fresh.length) return { added: [], removed: 0 };
  await prisma.$transaction([
    prisma.blacklistEntry.deleteMany({ where: { id: { in: stale } } }),
    ...fresh.map((w) => prisma.blacklistEntry.create({ data: { ...w, tournamentId, source: "AUTO", reason: WALKOVER_REASON, penalty: BLACKLIST_PENALTY } })),
  ]);
  await recomputeRatings();
  return { added: fresh, removed: stale.length };
}

const listQuery = z.object({
  status: z.enum(["active", "lifted", "all"]).default("active"),
  playerId: z.string().optional(),
  tournamentId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export async function listBlacklist(query: unknown) {
  const q = listQuery.parse(query);
  const where = {
    ...(q.status === "active" ? { liftedAt: null } : q.status === "lifted" ? { liftedAt: { not: null } } : {}),
    ...(q.playerId ? { playerId: q.playerId } : {}),
    ...(q.tournamentId ? { tournamentId: q.tournamentId } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.blacklistEntry.findMany({ where, orderBy: { createdAt: "desc" }, take: q.limit, select: view }),
    prisma.blacklistEntry.count({ where }),
  ]);
  return { data, total };
}

/** Standing entries of one player, for the player page. */
export async function blacklistOf(playerId: string) {
  const data = await prisma.blacklistEntry.findMany({ where: { playerId }, orderBy: { createdAt: "desc" }, select: view });
  const active = data.filter((e) => !e.liftedAt);
  return { active: active.length > 0, penalty: active.reduce((n, e) => n + e.penalty, 0), entries: data };
}

/** Player ids with at least one standing entry (for badges on lists). */
export async function blacklistedIds(playerIds?: string[]) {
  const rows = await prisma.blacklistEntry.findMany({
    where: { liftedAt: null, ...(playerIds ? { playerId: { in: playerIds } } : {}) },
    select: { playerId: true },
    distinct: ["playerId"],
  });
  return new Set(rows.map((r) => r.playerId));
}

const addInput = z.object({
  playerId: z.string().min(1),
  reason: z.string().trim().min(1).max(300),
  penalty: z.coerce.number().int().min(0).max(500).default(BLACKLIST_PENALTY),
});

/** An organizer puts a player on the blacklist by hand. */
export async function addToBlacklist(body: unknown) {
  const input = addInput.parse(body);
  const player = await prisma.player.findUnique({ where: { id: input.playerId }, select: { id: true } });
  if (!player) throw notFound("Player");
  const e = await prisma.blacklistEntry.create({ data: { ...input, source: "ADMIN" }, select: view });
  await recomputeRatings();
  return prisma.blacklistEntry.findUniqueOrThrow({ where: { id: e.id }, select: view });
}

const updateInput = z.object({
  lifted: z.boolean().optional(),
  note: z.string().trim().max(300).optional(),
  reason: z.string().trim().min(1).max(300).optional(),
  penalty: z.coerce.number().int().min(0).max(500).optional(),
});

/** Lift an entry (MMR back) or put it back; organizers may also change the reason or the penalty. */
export async function updateBlacklist(id: string, body: unknown) {
  const input = updateInput.parse(body);
  const cur = await prisma.blacklistEntry.findUnique({ where: { id } });
  if (!cur) throw fail(404, "Blacklist entry not found", "ไม่พบรายการนี้ใน Blacklist");
  await prisma.blacklistEntry.update({
    where: { id },
    data: {
      ...(input.lifted === undefined ? {} : input.lifted ? { liftedAt: cur.liftedAt ?? new Date(), liftNote: input.note ?? cur.liftNote } : { liftedAt: null, liftNote: null }),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.penalty === undefined ? {} : { penalty: input.penalty }),
    },
  });
  await recomputeRatings();
  return prisma.blacklistEntry.findUniqueOrThrow({ where: { id }, select: view });
}

/** Deletes an entry an organizer added. Automatic ones are lifted instead, so the walkover doesn't add them again. */
export async function deleteBlacklist(id: string) {
  const cur = await prisma.blacklistEntry.findUnique({ where: { id } });
  if (!cur) throw fail(404, "Blacklist entry not found", "ไม่พบรายการนี้ใน Blacklist");
  if (cur.source === "AUTO") throw fail(409, "Lift an automatic entry instead", "รายการจากการแพ้บายลบไม่ได้ ให้กดยกเลิกโทษแทน");
  await prisma.blacklistEntry.delete({ where: { id } });
  await recomputeRatings();
}

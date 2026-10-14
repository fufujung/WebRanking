/**
 * Player identity: the in-game UID (+ server) is the same person whatever name they use today.
 * A rename keeps the old name in PlayerName, so old scoreboards and searches still find them.
 */
import type { Player, Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { z } from "zod";
import { fail, HttpError, notFound } from "./errors.js";
import { recomputeRatings } from "./elo.js";
import { normaliseName, POSITIONS, toPosition } from "./validate.js";

type Tx = Prisma.TransactionClient;

const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** Both UIDs are known and they are not the same: two different characters. */
export const differentUid = (a: string | null | undefined, b: string | null | undefined) => Boolean(a?.trim() && b?.trim() && !sameText(a, b));

/**
 * The player who owns this UID. A blank server on either side matches any server, but
 * when several players share the UID on different servers, the server must match.
 */
export async function findByUid(tx: Tx, uid: string | null | undefined, server: string | null | undefined, exceptId?: string) {
  if (!uid?.trim()) return null;
  const rows = await tx.player.findMany({ where: { uid: { not: null }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  const same = rows.filter((p) => sameText(p.uid, uid));
  const exact = same.find((p) => sameText(p.server, server));
  if (exact) return exact;
  const loose = same.filter((p) => !p.server || !server?.trim());
  return loose.length === 1 ? loose[0] : null;
}

/** Fails when the UID already belongs to someone else. */
export async function assertUidFree(tx: Tx, uid: string | null | undefined, server: string | null | undefined, exceptId?: string) {
  const owner = await findByUid(tx, uid, server, exceptId);
  if (owner) {
    throw new HttpError(409, "This UID belongs to another player", {
      th: `UID ${uid}${server ? ` (${server})` : ""} เป็นของผู้เล่น ${owner.name} อยู่แล้ว ถ้าเป็นคนเดียวกันให้ใช้ "รวมผู้เล่น" แทน`,
      playerId: owner.id,
      playerName: owner.name,
    });
  }
}

/** Searches the current name, nickname, UID and every name the player used before. */
export const playerSearch = (search: string) => ({
  OR: [
    { name: { contains: search } },
    { nickname: { contains: search } },
    { uid: { contains: search } },
    { names: { some: { name: { contains: search } } } },
  ],
});

/** Keeps a name the player used to have. */
export async function rememberName(tx: Tx, playerId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const now = new Date();
  await tx.playerName.upsert({
    where: { playerId_name: { playerId, name: trimmed } },
    create: { playerId, name: trimmed, lastSeen: now },
    update: { lastSeen: now },
  });
}

/** Renames a player and keeps the old name in their history. Spelling-only changes are not history. */
export async function renamePlayer(tx: Tx, player: Pick<Player, "id" | "name">, name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === player.name) return;
  if (normaliseName(trimmed) !== normaliseName(player.name)) await rememberName(tx, player.id, player.name);
  await tx.player.update({ where: { id: player.id }, data: { name: trimmed } });
}

/** Every player with each name they are known by: current name, nickname and past names, normalised. */
export async function knownNames(tx: Tx) {
  const rows = await tx.player.findMany({ select: { id: true, name: true, nickname: true, teamId: true, uid: true, names: { select: { name: true } } } });
  return rows.map((p) => ({
    id: p.id,
    teamId: p.teamId,
    uid: p.uid,
    current: [p.name, p.nickname].filter((x): x is string => Boolean(x)).map(normaliseName),
    past: p.names.map((n) => normaliseName(n.name)),
  }));
}

/**
 * Moves everything of player `fromId` onto `intoId` and deletes `fromId`: scoreboards, rosters,
 * names, and any profile fields the kept player is missing. Stats and MMR then count as one player.
 */
export async function mergePlayers(intoId: string, fromId: string) {
  if (intoId === fromId) throw new HttpError(400, "Choose two different players", { th: "เลือกผู้เล่นสองคนที่ต่างกัน" });
  await prisma.$transaction(async (tx) => {
    const [into, from] = await Promise.all([
      tx.player.findUnique({ where: { id: intoId } }),
      tx.player.findUnique({ where: { id: fromId }, include: { names: true } }),
    ]);
    if (!into || !from) throw notFound("Player");
    if (into.uid && from.uid && !(sameText(into.uid, from.uid) && (!into.server || !from.server || sameText(into.server, from.server)))) {
      throw new HttpError(409, "The players have different UIDs", { th: `ผู้เล่นสองคนนี้มี UID ต่างกัน (${into.uid} กับ ${from.uid}) จึงไม่ใช่คนเดียวกัน` });
    }

    const fromLines = await tx.matchPlayerStat.findMany({ where: { playerId: from.id }, select: { id: true, gameId: true } });
    const clash = await tx.matchPlayerStat.findFirst({ where: { playerId: into.id, gameId: { in: fromLines.map((l) => l.gameId) } } });
    if (clash) throw new HttpError(409, "Both players are on the same game's scoreboard", { th: "ผู้เล่นสองคนนี้อยู่ในสกอร์บอร์ดเกมเดียวกัน จึงไม่ใช่คนเดียวกัน", matchId: clash.matchId });
    await tx.matchPlayerStat.updateMany({ where: { playerId: from.id }, data: { playerId: into.id } });

    const fromRosters = await tx.rosterPlayer.findMany({ where: { playerId: from.id } });
    for (const r of fromRosters) {
      const both = await tx.rosterPlayer.findFirst({ where: { entryId: r.entryId, playerId: into.id } });
      if (both) await tx.rosterPlayer.delete({ where: { id: r.id } });
      else await tx.rosterPlayer.update({ where: { id: r.id }, data: { playerId: into.id } });
    }

    for (const n of from.names) {
      await tx.playerName.upsert({
        where: { playerId_name: { playerId: into.id, name: n.name } },
        create: { playerId: into.id, name: n.name, firstSeen: n.firstSeen, lastSeen: n.lastSeen },
        update: {},
      });
    }
    if (normaliseName(from.name) !== normaliseName(into.name)) await rememberName(tx, into.id, from.name);

    // Blacklist entries follow the person; one walkover counts once even if both characters were on that roster.
    for (const b of await tx.blacklistEntry.findMany({ where: { playerId: from.id } })) {
      const both = b.slotCode ? await tx.blacklistEntry.findFirst({ where: { tournamentId: b.tournamentId, slotCode: b.slotCode, playerId: into.id } }) : null;
      if (both) await tx.blacklistEntry.delete({ where: { id: b.id } });
      else await tx.blacklistEntry.update({ where: { id: b.id }, data: { playerId: into.id } });
    }

    const guildId = into.guildId ?? from.guildId;
    if (guildId) await tx.guild.updateMany({ where: { id: guildId, leaderId: from.id }, data: { leaderId: into.id } });
    await tx.player.delete({ where: { id: from.id } });
    await tx.player.update({
      where: { id: into.id },
      data: {
        uid: into.uid ?? from.uid,
        server: into.uid ? into.server : (from.server ?? into.server),
        nickname: into.nickname ?? from.nickname,
        avatarUrl: into.avatarUrl ?? from.avatarUrl,
        teamId: into.teamId ?? from.teamId,
        guildId,
        role: into.role ?? from.role,
        country: into.country ?? from.country,
        discordId: into.discordId ?? from.discordId,
      },
    });
  });
  await recomputeRatings();
}

/**
 * Gives players a UID from the tournament rosters they were registered on, for data saved
 * before players carried their own UID. Skips UIDs another player already owns.
 */
export async function backfillPlayerUids() {
  const rows = await prisma.rosterPlayer.findMany({
    where: { uid: { not: null }, player: { uid: null } },
    orderBy: { id: "desc" },
    select: { playerId: true, uid: true, server: true },
  });
  let filled = 0;
  for (const r of rows) {
    const done = await prisma.$transaction(async (tx) => {
      const p = await tx.player.findUnique({ where: { id: r.playerId }, select: { uid: true } });
      if (!p || p.uid || (await findByUid(tx, r.uid, r.server, r.playerId))) return false;
      await tx.player.update({ where: { id: r.playerId }, data: { uid: r.uid, server: r.server } });
      return true;
    });
    if (done) filled++;
  }
  return filled;
}

/**
 * Positions saved before they were a fixed choice: "Center" or "เซ็นเตอร์" becomes CENTER, and a
 * player with none takes the position of their latest solo sign-up. Other text is left as it is.
 */
export async function backfillPositions() {
  const players = await prisma.player.findMany({
    where: { OR: [{ role: null }, { role: { notIn: [...POSITIONS] } }] },
    select: { id: true, role: true, soloSignups: { orderBy: { createdAt: "desc" }, take: 1, select: { position: true } } },
  });
  let changed = 0;
  for (const p of players) {
    const role = toPosition(p.role) ?? (p.role ? null : (toPosition(p.soloSignups[0]?.position) ?? null));
    if (role && role !== p.role) {
      await prisma.player.update({ where: { id: p.id }, data: { role } });
      changed++;
    }
  }
  return changed;
}

/**
 * A member sets the position of the characters linked to their Discord account (or of one, by playerId).
 * Returns the characters changed.
 */
export async function setOwnPosition(discordId: string, body: unknown) {
  const input = z.object({ position: z.enum(POSITIONS), playerId: z.string().trim().min(1).optional() }).parse(body);
  const mine = await prisma.player.findMany({ where: { discordId, ...(input.playerId ? { id: input.playerId } : {}) }, select: { id: true, name: true } });
  if (!mine.length) throw fail(404, "No character is linked to this Discord account", "บัญชี Discord นี้ยังไม่ได้ผูกกับตัวละคร (เข้าสู่ระบบที่เว็บด้วย Discord แล้วผูกตัวละครก่อน)");
  await prisma.player.updateMany({ where: { id: { in: mine.map((p) => p.id) } }, data: { role: input.position } });
  return { position: input.position, players: mine };
}

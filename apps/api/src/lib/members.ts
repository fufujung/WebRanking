import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { findByUid } from "./players.js";
import { teamSummary } from "./selects.js";

/** A Discord user id (a "snowflake"): digits only. */
export const discordId = z.string().regex(/^\d{5,25}$/, "Invalid Discord id");

export const claimInput = z.object({
  uid: z.string().trim().min(1).max(40),
  server: z.string().trim().max(40).optional().transform((s) => s || null),
  /** Needed only when no player has this UID yet: the new player's in-game name. */
  name: z.string().trim().max(100).optional().transform((s) => s || null),
  /** The game this character plays; may be left out when the site has only one game. */
  gameId: z.string().trim().max(40).optional().transform((s) => s || null),
  /** The account's Discord name, shown to the organizer who approves the link. */
  discordName: z.string().trim().max(100).optional().transform((s) => s || null),
});

/**
 * The players a Discord account plays as. Players the bot put on a roster with this account
 * are linked on the way, unless someone else already linked them.
 */
export async function playersOfDiscord(id: string) {
  const rosters = await prisma.rosterPlayer.findMany({ where: { discordId: id }, select: { playerId: true } });
  if (rosters.length) {
    await prisma.player.updateMany({ where: { id: { in: [...new Set(rosters.map((r) => r.playerId))] }, discordId: null }, data: { discordId: id } });
  }
  return prisma.player.findMany({ where: { discordId: id }, include: { team: teamSummary }, orderBy: { name: "asc" } });
}

/**
 * Links the player with this UID to the account, or creates them when the UID is new. UIDs are public,
 * so linking a character that already exists waits for an organizer (pending), unless the account is
 * already on a roster with that character or the caller is the organizer (trusted).
 */
export async function claimByUid(id: string, input: z.input<typeof claimInput>, opts: { trusted?: boolean } = {}) {
  const parsed = claimInput.parse(input);
  return prisma.$transaction(async (tx) => {
    const owner = await findByUid(tx, parsed.uid, parsed.server);
    if (owner) {
      if (owner.discordId && owner.discordId !== id) {
        throw fail(409, "This player is linked to another Discord account", `UID ${parsed.uid} ผูกกับบัญชี Discord อื่นอยู่แล้ว ถ้าเป็นของคุณจริงให้ติดต่อผู้จัด`);
      }
      const proven = opts.trusted || owner.discordId === id || (await tx.rosterPlayer.count({ where: { playerId: owner.id, discordId: id } })) > 0;
      if (!proven) {
        await tx.playerLinkRequest.upsert({
          where: { playerId_discordId: { playerId: owner.id, discordId: id } },
          create: { playerId: owner.id, discordId: id, name: parsed.discordName },
          update: parsed.discordName ? { name: parsed.discordName } : {},
        });
        const player = await tx.player.findUniqueOrThrow({ where: { id: owner.id }, include: { team: teamSummary } });
        return { player, created: false, pending: true };
      }
      const player = await tx.player.update({
        where: { id: owner.id },
        data: { discordId: id, ...(owner.gameId ? {} : { gameId: await gameFor(tx, parsed.gameId) }) },
        include: { team: teamSummary },
      });
      await tx.playerLinkRequest.deleteMany({ where: { playerId: owner.id } });
      return { player, created: false, pending: false };
    }
    if (!parsed.name) throw fail(400, "No player has this UID yet; send a name to create one", `ยังไม่มีผู้เล่น UID ${parsed.uid} ในระบบ ใส่ชื่อในเกมเพื่อสร้างโปรไฟล์ใหม่`, { needsName: true });
    const player = await tx.player.create({
      data: { name: parsed.name, uid: parsed.uid, server: parsed.server, discordId: id, gameId: await gameFor(tx, parsed.gameId) },
      include: { team: teamSummary },
    });
    return { player, created: true, pending: false };
  });
}

/** Thrown where a character must already be the account's own, but its link still waits for approval. */
export const waitingForApproval = (uid: string) =>
  fail(409, "The link to this character waits for an organizer", `ส่งคำขอผูกตัวละคร UID ${uid} แล้ว รอผู้จัดอนุมัติก่อน แล้วค่อยทำรายการนี้อีกครั้ง`, { pending: true });

/** Links waiting for an organizer, oldest first. */
export async function linkRequests() {
  const rows = await prisma.playerLinkRequest.findMany({
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { player: { select: { id: true, name: true, nickname: true, uid: true, server: true, discordId: true, avatarUrl: true, team: teamSummary } } },
  });
  return rows;
}

/** The organizer lets the account act as the character; other requests for it are dropped. */
export async function approveLink(requestId: string) {
  return prisma.$transaction(async (tx) => {
    const req = await tx.playerLinkRequest.findUnique({ where: { id: requestId }, include: { player: true } });
    if (!req) throw notFound("Link request");
    if (req.player.discordId && req.player.discordId !== req.discordId) {
      throw fail(409, "This player is linked to another Discord account", "ตัวละครนี้ผูกกับบัญชี Discord อื่นไปแล้ว ยกเลิกการผูกเดิมก่อน");
    }
    const player = await tx.player.update({ where: { id: req.playerId }, data: { discordId: req.discordId }, include: { team: teamSummary } });
    const others = await tx.playerLinkRequest.findMany({ where: { playerId: req.playerId, id: { not: req.id } }, select: { discordId: true } });
    await tx.playerLinkRequest.deleteMany({ where: { playerId: req.playerId } });
    return { player, discordId: req.discordId, denied: others.map((o) => o.discordId) };
  });
}

/** The organizer turns a request down. */
export async function denyLink(requestId: string) {
  const req = await prisma.playerLinkRequest.findUnique({ where: { id: requestId }, include: { player: { select: { name: true, uid: true } } } });
  if (!req) throw notFound("Link request");
  await prisma.playerLinkRequest.delete({ where: { id: requestId } });
  return { discordId: req.discordId, player: req.player };
}

/** Characters this account asked for and that still wait for an organizer. */
export function pendingLinksOf(id: string) {
  return prisma.playerLinkRequest.findMany({ where: { discordId: id }, include: { player: { select: { id: true, name: true, uid: true } } }, orderBy: { createdAt: "asc" } });
}

/** The chosen game, or the only game when the site has just one. */
async function gameFor(tx: Prisma.TransactionClient, gameId: string | null) {
  const games = await tx.game.findMany({ select: { id: true } });
  if (gameId) {
    if (!games.some((g) => g.id === gameId)) throw fail(400, "Unknown game", "ไม่พบเกมนี้");
    return gameId;
  }
  if (games.length > 1) throw fail(400, "Choose the game", "เลือกเกมของตัวละครนี้ก่อน", { needsGame: true });
  return games[0]?.id ?? null;
}

export async function unlinkDiscord(playerId: string) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) throw notFound("Player");
  return prisma.player.update({ where: { id: playerId }, data: { discordId: null }, include: { team: teamSummary } });
}

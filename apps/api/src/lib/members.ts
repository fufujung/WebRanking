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

/** Links the player with this UID to the account, or creates them when the UID is new. */
export async function claimByUid(id: string, input: z.infer<typeof claimInput>) {
  return prisma.$transaction(async (tx) => {
    const owner = await findByUid(tx, input.uid, input.server);
    if (owner) {
      if (owner.discordId && owner.discordId !== id) {
        throw fail(409, "This player is linked to another Discord account", `UID ${input.uid} ผูกกับบัญชี Discord อื่นอยู่แล้ว ถ้าเป็นของคุณจริงให้ติดต่อผู้จัด`);
      }
      const player = await tx.player.update({ where: { id: owner.id }, data: { discordId: id }, include: { team: teamSummary } });
      return { player, created: false };
    }
    if (!input.name) throw fail(400, "No player has this UID yet; send a name to create one", `ยังไม่มีผู้เล่น UID ${input.uid} ในระบบ ใส่ชื่อในเกมเพื่อสร้างโปรไฟล์ใหม่`, { needsName: true });
    const player = await tx.player.create({
      data: { name: input.name, uid: input.uid, server: input.server, discordId: id },
      include: { team: teamSummary },
    });
    return { player, created: true };
  });
}

export async function unlinkDiscord(playerId: string) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) throw notFound("Player");
  return prisma.player.update({ where: { id: playerId }, data: { discordId: null }, include: { team: teamSummary } });
}

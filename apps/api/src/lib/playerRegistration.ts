import { z } from "zod";
import { prisma } from "./db.js";
import { fail } from "./errors.js";
import { gameIdOrNull } from "./games.js";
import { POSITIONS, ranksOf } from "./solo.js";

/** A character's reusable registration details. The public leaderboard rank is unrelated. */
export async function saveRegistrationProfile(discordId: string, body: unknown) {
  const input = z.object({ playerId: z.string().min(1), position: z.enum(POSITIONS), inGameRank: z.string().trim().min(1).max(30), gameId: z.string().min(1).optional() }).parse(body);
  const player = await prisma.player.findUnique({ where: { id: input.playerId } });
  if (!player || player.discordId !== discordId) throw fail(403, "Not your character", "ตัวละครนี้ไม่ได้ผูกกับบัญชีของคุณ");
  if (player.gameId && input.gameId && player.gameId !== input.gameId) throw fail(400, "Different game", "ตัวละครนี้อยู่คนละเกม");
  const gameId = player.gameId ?? await gameIdOrNull(prisma, input.gameId);
  if (!(await ranksOf({ gameId })).some((r) => r.name === input.inGameRank)) throw fail(400, "Unknown rank", "เลือกแรงค์จากรายการของเกมนี้");
  const updated = await prisma.player.updateMany({ where: { id: player.id, discordId, gameId: player.gameId }, data: { role: input.position, inGameRank: input.inGameRank, gameId } });
  if (!updated.count) throw fail(409, "Profile changed", "ข้อมูลตัวละครเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่");
  return { playerId: player.id, position: input.position, inGameRank: input.inGameRank };
}

/** Safe to rerun: only fills missing profile ranks from valid history in the same game. */
export async function backfillPlayerRanks() {
  const players = await prisma.player.findMany({ where: { inGameRank: null }, include: { reserve: true, soloSignups: { include: { tournament: { select: { gameId: true } } } } } });
  for (const p of players) {
    const ranks = new Set((await ranksOf(p)).map((r) => r.name));
    const history = [
      ...(p.reserve?.rank ? [{ rank: p.reserve.rank, position: p.reserve.position, at: p.reserve.updatedAt }] : []),
      ...p.soloSignups.filter((s) => s.tournament.gameId === p.gameId).map((s) => ({ rank: s.rank, position: s.position, at: s.createdAt })),
    ].filter((s) => ranks.has(s.rank) && POSITIONS.some((v) => v === s.position)).sort((a, b) => b.at.getTime() - a.at.getTime());
    const latest = history[0];
    if (latest) await prisma.player.updateMany({ where: { id: p.id, inGameRank: null }, data: { inGameRank: latest.rank, ...(!POSITIONS.some((v) => v === p.role) ? { role: latest.position } : {}) } });
  }
}

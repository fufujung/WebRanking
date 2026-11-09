import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { normaliseName } from "./validate.js";
import { assertOnSeason } from "./seasons.js";

export async function assertTwoTeamCapacity(tx: Prisma.TransactionClient, tournamentId: string, teamIds: string[]) {
  const t = await tx.tournament.findUnique({ where: { id: tournamentId }, select: { special: true } });
  if (!t?.special) return;
  const entries = await tx.tournamentEntry.findMany({ where: { tournamentId }, select: { teamId: true } });
  if (new Set([...entries.map((e) => e.teamId), ...teamIds]).size > 2) throw fail(409, "Special events have two teams", "เล่นเก่งปากเก่งมีได้ 2 ทีมเท่านั้น");
}

const slotInput = z.union([
  z.object({ playerId: z.string().min(1) }),
  z.object({ name: z.string().trim().min(1).max(100) }),
]).nullable();
const inputSchema = z.object({ teams: z.array(z.object({ teamId: z.string().optional(), name: z.string().trim().min(1).max(100), slots: z.array(slotInput).min(1).max(10) })).length(2) });

export async function specialTeamsView(tournamentId: string) {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, include: { entries: { orderBy: { createdAt: "asc" }, include: { team: true, roster: { orderBy: { order: "asc" }, include: { player: true } } } }, _count: { select: { matches: true } } } });
  if (!t) throw notFound("Tournament");
  const size = Math.max(Math.min(t.teamSize, t.rosterMax), ...t.entries.flatMap((e) => e.roster.map((r) => r.order + 1)));
  return { size, locked: t.status === "COMPLETED" || t.bracketStatus === "LIVE" || t.bracketStatus === "DONE" || t._count.matches > 0, teams: t.entries.map((e) => ({ teamId: e.teamId, name: e.team.name, slots: Array.from({ length: size }, (_, i) => { const r = e.roster.find((r) => r.order === i); return r ? { playerId: r.playerId, name: r.player.name } : null; }) })) };
}

/** Both sides are saved atomically; blank slots are a draft, never fabricated players. */
export async function saveSpecialTeams(tournamentId: string, body: unknown) {
  const input = inputSchema.parse(body);
  await prisma.$transaction(async (tx) => {
    const t = await tx.tournament.findUnique({ where: { id: tournamentId }, include: { entries: true, _count: { select: { matches: true } } } });
    if (!t) throw notFound("Tournament");
    if (!t.special) throw fail(400, "Special events only", "ใช้ได้เฉพาะรายการเล่นเก่งปากเก่ง");
    if (t.entries.length > 2) throw fail(409, "Too many existing teams", "รายการเดิมมีมากกว่า 2 ทีม กรุณาถอนทีมส่วนเกินก่อน");
    if (t.status === "COMPLETED" || t.bracketStatus === "LIVE" || t.bracketStatus === "DONE" || t._count.matches > 0) throw fail(409, "Teams are locked", "เริ่มแข่ง จบรายการ หรือมีผลแล้ว แก้ทีมไม่ได้");
    if (await tx.market.count({ where: { tournamentId, status: { not: "REFUNDED" }, bets: { some: {} } } })) throw fail(409, "Predictions already placed", "มีคนทายผลแล้ว กรุณายกเลิกคู่ทายและคืนเหรียญก่อนเปลี่ยนรายชื่อทีม");
    const size = input.teams[0].slots.length;
    if (size > t.rosterMax || input.teams[1].slots.length !== size) throw fail(400, "Invalid slots", `ทั้งสองทีมต้องมีจำนวนช่องเท่ากันและไม่เกิน ${t.rosterMax} ช่อง`);
    const keys = input.teams.map((s) => normaliseName(s.name));
    if (keys.some((k) => !k) || keys[0] === keys[1]) throw fail(400, "Duplicate team names", "ตั้งชื่อทีมทั้งสองฝั่งให้ต่างกัน และมีตัวอักษรหรือตัวเลข");
    const ids = input.teams.flatMap((s) => s.teamId ? [s.teamId] : []);
    if (new Set(ids).size !== ids.length || t.entries.some((e) => !ids.includes(e.teamId)) || ids.some((id) => !t.entries.some((e) => e.teamId === id))) throw fail(409, "Teams changed", "ทีมในรายการเปลี่ยนแล้ว กรุณารีเฟรชหน้า");
    const usedPlayers = new Set<string>(), usedDiscord = new Set<string>(), usedNames = new Set<string>(), usedUids = new Set<string>();
    for (const side of input.teams) {
      let teamId = side.teamId;
      if (teamId) {
        const team = await tx.team.findUniqueOrThrow({ where: { id: teamId } });
        if (team.name !== side.name) {
          if (await tx.tournamentEntry.count({ where: { teamId, tournamentId: { not: tournamentId } } })) throw fail(409, "Shared team", "ทีมนี้ใช้ในรายการอื่นด้วย กรุณาเปลี่ยนชื่อที่หน้าจัดการทีม");
          await tx.team.update({ where: { id: teamId }, data: { name: side.name } });
        }
      } else {
        if (await tx.team.findUnique({ where: { name: side.name } })) throw fail(409, "Team name exists", "ชื่อทีมนี้มีในระบบแล้ว กรุณาใช้ชื่ออื่น");
        teamId = (await tx.team.create({ data: { name: side.name, gameId: t.gameId } })).id;
      }
      const entry = await tx.tournamentEntry.upsert({ where: { tournamentId_teamId: { tournamentId, teamId } }, create: { tournamentId, teamId }, update: {} });
      await tx.rosterPlayer.deleteMany({ where: { entryId: entry.id } });
      for (const [order, slot] of side.slots.entries()) {
        if (!slot) continue;
        let player;
        if ("playerId" in slot) {
          player = await tx.player.findUnique({ where: { id: slot.playerId } });
          if (!player) throw notFound("Player");
        } else {
          const key = normaliseName(slot.name);
          if (!key) throw fail(400, "Invalid name", "ชื่อผู้เล่นต้องมีตัวอักษรหรือตัวเลข");
          const matches = (await tx.player.findMany({ where: { gameId: t.gameId } })).filter((p) => normaliseName(p.name) === key);
          if (matches.length > 1) throw fail(409, "Ambiguous player", "มีผู้เล่นชื่อนี้หลายคน กรุณาเลือกจากรายชื่อ");
          player = matches[0] ?? await tx.player.create({ data: { name: slot.name, gameId: t.gameId } });
        }
        if (player.gameId !== t.gameId) throw fail(409, "Wrong game", "ผู้เล่นต้องอยู่ในเกมเดียวกับรายการ");
        const nameKey = normaliseName(player.name);
        const uidKey = player.uid ? `${player.uid.toLowerCase()}@${(player.server ?? "").toLowerCase()}` : null;
        if (usedPlayers.has(player.id) || usedNames.has(nameKey) || (player.discordId && usedDiscord.has(player.discordId)) || (uidKey && usedUids.has(uidKey))) throw fail(409, "Duplicate player", "ผู้เล่นซ้ำในสองทีม กรุณาเลือกคนอื่น");
        usedPlayers.add(player.id); usedNames.add(nameKey); if (player.discordId) usedDiscord.add(player.discordId);
        if (uidKey) usedUids.add(uidKey);
        await assertOnSeason(tx, t, [player.id]);
        await tx.rosterPlayer.create({ data: { entryId: entry.id, playerId: player.id, discordId: player.discordId, uid: player.uid, server: player.server, order } });
      }
      const captain = await tx.rosterPlayer.findFirst({ where: { entryId: entry.id, discordId: { not: null } }, orderBy: { order: "asc" } });
      await tx.tournamentEntry.update({ where: { id: entry.id }, data: { captainDiscordId: captain?.discordId ?? null, memberDiscordIds: "[]" } });
    }
    if (t.bracketStatus === "DRAFT") {
      await tx.bracketMatch.deleteMany({ where: { tournamentId } });
      await tx.tournamentEntry.updateMany({ where: { tournamentId }, data: { seed: null } });
    }
    await tx.tournament.update({ where: { id: tournamentId }, data: { maxTeams: 2, teamSize: size, bracketStatus: "NONE" } });
  }, { timeout: 15000 });
  return specialTeamsView(tournamentId);
}

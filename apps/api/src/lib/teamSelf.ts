/**
 * Teams run by their own players (from the website, logged in with Discord): create a team,
 * join it with the invite code, leave it, and for the captain kick members or hand over the lead.
 * Every call names the Discord account and which of its characters acts, and is checked against both.
 */
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { imageUrl, normaliseName } from "./validate.js";
import { playerBoard, tierInfo } from "./leaderboard.js";
import { PLACEMENT_SERIES } from "./mmr.js";
import { playersOfDiscord } from "./members.js";
import { guildsForMember } from "./guilds.js";

type Tx = Prisma.TransactionClient;

/** Max members a team can have through invites (organizers can add more by hand). */
export const TEAM_LIMIT = 15;

export const actingInput = z.object({ playerId: z.string().trim().min(1) });
export const createTeamInput = actingInput.extend({
  name: z.string().trim().min(1).max(100),
  tag: z.string().trim().max(12).optional().transform((s) => s || null),
  logoUrl: imageUrl,
});
export const joinInput = actingInput.extend({ code: z.string().trim().min(4).max(40) });
export const memberInput = actingInput.extend({ memberId: z.string().trim().min(1) });

/** Easy to read out loud: no 0/O or 1/I/L. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const newCode = () => [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join("");

async function own(tx: Tx, discordId: string, playerId: string) {
  const p = await tx.player.findUnique({ where: { id: playerId } });
  if (!p || p.discordId !== discordId) throw fail(403, "This character is not yours", "ตัวละครนี้ไม่ได้ผูกกับบัญชี Discord ของคุณ");
  return p;
}

async function asCaptain(tx: Tx, discordId: string, playerId: string) {
  const p = await own(tx, discordId, playerId);
  const team = p.teamId ? await tx.team.findUnique({ where: { id: p.teamId } }) : null;
  if (!team) throw fail(409, "Not in a team", "ตัวละครนี้ยังไม่มีทีม");
  if (team.captainId !== p.id) throw fail(403, "Only the captain can do this", "เฉพาะหัวหน้าทีมเท่านั้น");
  return { player: p, team };
}

async function codeFor(tx: Tx, teamId: string, fresh = false) {
  const current = await tx.teamInvite.findUnique({ where: { teamId } });
  if (current && !fresh) return current.code;
  const code = newCode();
  await tx.teamInvite.upsert({ where: { teamId }, create: { teamId, code }, update: { code, createdAt: new Date() } });
  return code;
}

export function createTeam(discordId: string, body: unknown) {
  const input = createTeamInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const p = await own(tx, discordId, input.playerId);
    if (p.teamId) throw fail(409, "Leave your team first", "ตัวละครนี้อยู่ในทีมอื่นแล้ว ต้องออกจากทีมเดิมก่อน");
    const key = normaliseName(input.name);
    if (!key) throw fail(400, "Team names must contain letters or numbers", "ชื่อทีมต้องมีตัวอักษรหรือตัวเลข");
    const taken = (await tx.team.findMany({ select: { name: true } })).some((t) => normaliseName(t.name) === key);
    if (taken) throw fail(409, "A team with this name exists", `มีทีมชื่อ ${input.name} อยู่แล้ว ลองใช้ชื่ออื่น`);
    const team = await tx.team.create({ data: { name: input.name, tag: input.tag, logoUrl: input.logoUrl, gameId: p.gameId, captainId: p.id } });
    await tx.player.update({ where: { id: p.id }, data: { teamId: team.id } });
    await codeFor(tx, team.id);
    return team;
  });
}

export function joinTeam(discordId: string, body: unknown) {
  const input = joinInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const p = await own(tx, discordId, input.playerId);
    const invite = await tx.teamInvite.findUnique({ where: { code: input.code.toUpperCase() }, include: { team: true } });
    if (!invite) throw fail(404, "Invite not found", "ไม่พบลิงก์เชิญนี้ อาจถูกเปลี่ยนแล้ว ขอลิงก์ใหม่จากหัวหน้าทีม");
    const team = invite.team;
    if (p.teamId === team.id) throw fail(409, "Already in this team", `คุณอยู่ในทีม ${team.name} อยู่แล้ว`);
    if (p.teamId) throw fail(409, "Leave your team first", "ตัวละครนี้อยู่ในทีมอื่นแล้ว ต้องออกจากทีมเดิมก่อน");
    if (team.gameId && p.gameId && team.gameId !== p.gameId) throw fail(400, "This team plays another game", `ทีม ${team.name} แข่งคนละเกมกับตัวละครนี้`);
    if ((await tx.player.count({ where: { teamId: team.id } })) >= TEAM_LIMIT) throw fail(409, "The team is full", `ทีมเต็มแล้ว (${TEAM_LIMIT} คน)`);
    await tx.player.update({ where: { id: p.id }, data: { teamId: team.id, ...(p.gameId ? {} : { gameId: team.gameId }) } });
    // A team an organizer made has no captain yet: the first player to join through the link leads it.
    if (!team.captainId) await tx.team.update({ where: { id: team.id }, data: { captainId: p.id } });
    return team;
  });
}

/** Leaving as captain hands the lead to another member (one who logs in with Discord first). */
export function leaveTeam(discordId: string, body: unknown) {
  const input = actingInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const p = await own(tx, discordId, input.playerId);
    if (!p.teamId) throw fail(409, "Not in a team", "ตัวละครนี้ยังไม่มีทีม");
    const team = await tx.team.findUnique({ where: { id: p.teamId } });
    await tx.player.update({ where: { id: p.id }, data: { teamId: null } });
    if (team?.captainId === p.id) {
      const others = await tx.player.findMany({ where: { teamId: team.id }, orderBy: { name: "asc" }, select: { id: true, discordId: true } });
      const next = others.find((o) => o.discordId) ?? others[0] ?? null;
      await tx.team.update({ where: { id: team.id }, data: { captainId: next?.id ?? null } });
    }
    return { left: team?.name ?? null };
  });
}

export function kickMember(discordId: string, body: unknown) {
  const input = memberInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const { team } = await asCaptain(tx, discordId, input.playerId);
    if (input.memberId === input.playerId) throw fail(400, "Use leave instead", "ใช้ปุ่มออกจากทีมแทน");
    const member = await tx.player.findUnique({ where: { id: input.memberId } });
    if (!member || member.teamId !== team.id) throw notFound("Member");
    await tx.player.update({ where: { id: member.id }, data: { teamId: null } });
    return { kicked: member.name };
  });
}

export function makeCaptain(discordId: string, body: unknown) {
  const input = memberInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const { team } = await asCaptain(tx, discordId, input.playerId);
    const member = await tx.player.findUnique({ where: { id: input.memberId } });
    if (!member || member.teamId !== team.id) throw notFound("Member");
    await tx.team.update({ where: { id: team.id }, data: { captainId: member.id } });
    return { captain: member.name };
  });
}

export function resetInvite(discordId: string, body: unknown) {
  const input = actingInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const { team } = await asCaptain(tx, discordId, input.playerId);
    return { code: await codeFor(tx, team.id, true) };
  });
}

/** What the "my profile" page shows: each character with its game, rank in that game and team. */
export async function memberView(discordId: string) {
  const players = await playersOfDiscord(discordId);
  const gameIds = [...new Set(players.map((p) => p.gameId))];
  const boards = new Map(await Promise.all(gameIds.map(async (g) => [g, await playerBoard(g)] as const)));
  const teamIds = [...new Set(players.map((p) => p.teamId).filter((x): x is string => Boolean(x)))];
  const [teams, games, guilds] = await Promise.all([
    prisma.team.findMany({
      where: { id: { in: teamIds } },
      include: { players: { select: { id: true, name: true, nickname: true, avatarUrl: true, discordId: true, mmr: true }, orderBy: { name: "asc" } }, invite: true },
    }),
    prisma.game.findMany({ where: { id: { in: gameIds.filter((g): g is string => Boolean(g)) } } }),
    guildsForMember(players),
  ]);
  const gameName = new Map(games.map((g) => [g.id, g.name]));
  return players.map((p) => {
    const board = boards.get(p.gameId)!;
    const ranked = board.ranked.find((r) => r.id === p.id);
    const placing = board.placing.find((r) => r.id === p.id);
    const team = teams.find((t) => t.id === p.teamId);
    const captain = team?.captainId === p.id;
    return {
      ...p,
      ...tierInfo(p.mmr),
      game: p.gameId ? { id: p.gameId, name: gameName.get(p.gameId) ?? "" } : null,
      rank: ranked?.rank ?? null,
      rankedPlayers: board.ranked.length,
      series: ranked?.series ?? placing?.series ?? 0,
      seriesToPlace: ranked ? 0 : Math.max(0, PLACEMENT_SERIES - (placing?.series ?? 0)),
      ...guilds.get(p.id)!,
      team: team
        ? {
            id: team.id, name: team.name, tag: team.tag, logoUrl: team.logoUrl, rating: team.rating, captainId: team.captainId,
            isCaptain: captain,
            inviteCode: captain ? (team.invite?.code ?? null) : null,
            members: team.players.map(({ discordId: d, ...m }) => ({ ...m, linked: Boolean(d), captain: m.id === team.captainId })),
          }
        : null,
    };
  });
}

/** The team behind an invite code, for the join page. */
export async function inviteInfo(code: string) {
  const invite = await prisma.teamInvite.findUnique({
    where: { code: code.toUpperCase() },
    include: { team: { include: { game: { select: { id: true, name: true } }, _count: { select: { players: true } } } } },
  });
  if (!invite) throw notFound("Invite");
  const { _count, ...team } = invite.team;
  return { ...team, memberCount: _count.players, full: _count.players >= TEAM_LIMIT };
}

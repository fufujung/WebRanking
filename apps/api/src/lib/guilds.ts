/**
 * Guilds (clubs): a home for players outside of tournament teams. A character belongs to at most
 * one guild. Anyone can start one from "my profile" and leads it; only the leader invites (by UID),
 * and the invited player accepts on their own profile. Organizers can change the leader and size.
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { imageUrl, normaliseName } from "./validate.js";
import { playerBoard, tierInfo, withRanks } from "./leaderboard.js";
import { findByUid } from "./players.js";

type Tx = Prisma.TransactionClient;

/** How many members a new guild can hold; organizers can raise it per guild. */
export const GUILD_CAPACITY = 200;
export const GUILD_CAPACITY_MAX = 10000;

const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

const guildFields = {
  name: z.string().trim().min(1).max(60),
  tag: text(12),
  logoUrl: imageUrl,
  description: text(500),
};

export const actingInput = z.object({ playerId: z.string().trim().min(1) });
export const createGuildInput = actingInput.extend(guildFields);
export const editGuildInput = actingInput.extend(z.object(guildFields).partial().shape);
export const inviteInput = actingInput.extend({
  uid: z.string().trim().min(1).max(40),
  server: z.string().trim().max(40).optional().transform((s) => s || null),
});
export const inviteIdInput = actingInput.extend({ inviteId: z.string().trim().min(1) });
export const memberInput = actingInput.extend({ memberId: z.string().trim().min(1) });
export const adminGuildInput = z
  .object({
    ...guildFields,
    capacity: z.coerce.number().int().min(1).max(GUILD_CAPACITY_MAX),
    leaderId: z.string().trim().min(1),
  })
  .partial();

async function own(tx: Tx, discordId: string, playerId: string) {
  const p = await tx.player.findUnique({ where: { id: playerId } });
  if (!p || p.discordId !== discordId) throw fail(403, "This character is not yours", "ตัวละครนี้ไม่ได้ผูกกับบัญชี Discord ของคุณ");
  return p;
}

async function asLeader(tx: Tx, discordId: string, playerId: string) {
  const player = await own(tx, discordId, playerId);
  const guild = player.guildId ? await tx.guild.findUnique({ where: { id: player.guildId } }) : null;
  if (!guild) throw fail(409, "Not in a guild", "ตัวละครนี้ยังไม่มีกิลด์");
  if (guild.leaderId !== player.id) throw fail(403, "Only the guild leader can do this", "เฉพาะหัวหน้ากิลด์เท่านั้น");
  return { player, guild };
}

async function assertNameFree(tx: Tx, name: string, exceptId?: string) {
  const key = normaliseName(name);
  if (!key) throw fail(400, "Guild names must contain letters or numbers", "ชื่อกิลด์ต้องมีตัวอักษรหรือตัวเลข");
  const rows = await tx.guild.findMany({ where: exceptId ? { id: { not: exceptId } } : {}, select: { name: true } });
  if (rows.some((g) => normaliseName(g.name) === key)) throw fail(409, "A guild with this name exists", `มีกิลด์ชื่อ ${name} อยู่แล้ว ลองใช้ชื่ออื่น`);
}

const full = (count: number, capacity: number) => count >= capacity;

/**
 * Who leads once the leader goes: the member with the highest MMR who logs in with Discord,
 * else anyone left. Null when the guild is empty.
 */
async function heirOf(tx: Tx, guildId: string, exceptId: string) {
  const left = await tx.player.findMany({ where: { guildId, id: { not: exceptId } }, orderBy: [{ mmr: "desc" }, { name: "asc" }], select: { id: true, discordId: true } });
  return left.find((p) => p.discordId) ?? left[0] ?? null;
}

/** Takes a member out; a leaderless guild passes to its heir, an empty one is closed. */
async function removeFromGuild(tx: Tx, guildId: string, playerId: string) {
  await tx.player.update({ where: { id: playerId }, data: { guildId: null } });
  const guild = await tx.guild.findUnique({ where: { id: guildId } });
  if (!guild || guild.leaderId !== playerId) return { closed: false, leader: null };
  const heir = await heirOf(tx, guildId, playerId);
  if (!heir) {
    await tx.guild.delete({ where: { id: guildId } });
    return { closed: true, leader: null };
  }
  await tx.guild.update({ where: { id: guildId }, data: { leaderId: heir.id } });
  return { closed: false, leader: heir.id };
}

export function createGuild(discordId: string, body: unknown) {
  const input = createGuildInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const p = await own(tx, discordId, input.playerId);
    if (p.guildId) throw fail(409, "Leave your guild first", "ตัวละครนี้อยู่ในกิลด์อื่นแล้ว ต้องออกจากกิลด์เดิมก่อน");
    await assertNameFree(tx, input.name);
    const { playerId, ...fields } = input;
    const guild = await tx.guild.create({ data: { ...fields, gameId: p.gameId, leaderId: p.id, capacity: GUILD_CAPACITY } });
    await tx.player.update({ where: { id: playerId }, data: { guildId: guild.id } });
    await tx.guildInvite.deleteMany({ where: { playerId } });
    return guild;
  });
}

export function editGuild(discordId: string, body: unknown) {
  const { playerId, ...fields } = editGuildInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const { guild } = await asLeader(tx, discordId, playerId);
    if (fields.name !== undefined) await assertNameFree(tx, fields.name, guild.id);
    return tx.guild.update({ where: { id: guild.id }, data: fields });
  });
}

/** The leader invites a character by its in-game UID. Inviting again keeps the one invite. */
export function inviteToGuild(discordId: string, body: unknown) {
  const input = inviteInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const { guild } = await asLeader(tx, discordId, input.playerId);
    const target = await findByUid(tx, input.uid, input.server);
    if (!target) throw fail(404, "No player has this UID", `ไม่พบผู้เล่น UID ${input.uid} ให้เพื่อนผูก UID ที่หน้าโปรไฟล์ของฉันก่อน`);
    if (target.guildId === guild.id) throw fail(409, "Already a member", `${target.name} อยู่ในกิลด์นี้แล้ว`);
    if (guild.gameId && target.gameId && guild.gameId !== target.gameId) throw fail(400, "This player plays another game", `${target.name} เล่นคนละเกมกับกิลด์นี้`);
    const count = await tx.player.count({ where: { guildId: guild.id } });
    if (full(count, guild.capacity)) throw fail(409, "The guild is full", `กิลด์เต็มแล้ว (${guild.capacity} คน)`);
    const invite = await tx.guildInvite.upsert({
      where: { guildId_playerId: { guildId: guild.id, playerId: target.id } },
      create: { guildId: guild.id, playerId: target.id },
      update: {},
    });
    return { id: invite.id, player: { id: target.id, name: target.name, linked: Boolean(target.discordId), inGuild: Boolean(target.guildId) } };
  });
}

export function cancelInvite(discordId: string, body: unknown) {
  const input = inviteIdInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const { guild } = await asLeader(tx, discordId, input.playerId);
    const invite = await tx.guildInvite.findUnique({ where: { id: input.inviteId } });
    if (!invite || invite.guildId !== guild.id) throw notFound("Invite");
    await tx.guildInvite.delete({ where: { id: invite.id } });
    return { cancelled: true };
  });
}

async function ownInvite(tx: Tx, discordId: string, playerId: string, inviteId: string) {
  const player = await own(tx, discordId, playerId);
  const invite = await tx.guildInvite.findUnique({ where: { id: inviteId }, include: { guild: true } });
  if (!invite || invite.playerId !== player.id) throw fail(404, "Invite not found", "ไม่พบคำเชิญนี้ หัวหน้ากิลด์อาจยกเลิกไปแล้ว");
  return { player, invite };
}

export function acceptInvite(discordId: string, body: unknown) {
  const input = inviteIdInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const { player, invite } = await ownInvite(tx, discordId, input.playerId, input.inviteId);
    const guild = invite.guild;
    if (player.guildId) throw fail(409, "Leave your guild first", "ตัวละครนี้อยู่ในกิลด์อื่นแล้ว ต้องออกจากกิลด์เดิมก่อน");
    const count = await tx.player.count({ where: { guildId: guild.id } });
    if (full(count, guild.capacity)) throw fail(409, "The guild is full", `กิลด์ ${guild.name} เต็มแล้ว (${guild.capacity} คน)`);
    await tx.player.update({ where: { id: player.id }, data: { guildId: guild.id, ...(player.gameId ? {} : { gameId: guild.gameId }) } });
    await tx.guildInvite.deleteMany({ where: { playerId: player.id } });
    if (!guild.leaderId) await tx.guild.update({ where: { id: guild.id }, data: { leaderId: player.id } });
    return { id: guild.id, name: guild.name };
  });
}

export function declineInvite(discordId: string, body: unknown) {
  const input = inviteIdInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const { invite } = await ownInvite(tx, discordId, input.playerId, input.inviteId);
    await tx.guildInvite.delete({ where: { id: invite.id } });
    return { declined: invite.guild.name };
  });
}

/** Leaving as leader hands the lead on; the last member leaving closes the guild. */
export function leaveGuild(discordId: string, body: unknown) {
  const input = actingInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const p = await own(tx, discordId, input.playerId);
    if (!p.guildId) throw fail(409, "Not in a guild", "ตัวละครนี้ยังไม่มีกิลด์");
    return removeFromGuild(tx, p.guildId, p.id);
  });
}

export function kickFromGuild(discordId: string, body: unknown) {
  const input = memberInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const { guild } = await asLeader(tx, discordId, input.playerId);
    if (input.memberId === input.playerId) throw fail(400, "Use leave instead", "ใช้ปุ่มออกจากกิลด์แทน");
    const member = await tx.player.findUnique({ where: { id: input.memberId } });
    if (!member || member.guildId !== guild.id) throw notFound("Member");
    await tx.player.update({ where: { id: member.id }, data: { guildId: null } });
    return { kicked: member.name };
  });
}

export function passLeader(discordId: string, body: unknown) {
  const input = memberInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const { guild } = await asLeader(tx, discordId, input.playerId);
    const member = await tx.player.findUnique({ where: { id: input.memberId } });
    if (!member || member.guildId !== guild.id) throw notFound("Member");
    await tx.guild.update({ where: { id: guild.id }, data: { leaderId: member.id } });
    return { leader: member.name };
  });
}

// ---- Organizers -------------------------------------------------------------

/** Organizers edit any guild, including its size and leader (who must be a member). */
export function adminUpdateGuild(id: string, body: unknown) {
  const input = adminGuildInput.parse(body);
  return prisma.$transaction(async (tx) => {
    const guild = await tx.guild.findUnique({ where: { id } });
    if (!guild) throw notFound("Guild");
    if (input.name !== undefined) await assertNameFree(tx, input.name, id);
    if (input.leaderId !== undefined) {
      const member = await tx.player.findUnique({ where: { id: input.leaderId }, select: { guildId: true } });
      if (member?.guildId !== id) throw fail(400, "The leader must be a member", "หัวหน้ากิลด์ต้องเป็นสมาชิกของกิลด์นี้");
    }
    if (input.capacity !== undefined) {
      const count = await tx.player.count({ where: { guildId: id } });
      if (input.capacity < count) throw fail(400, "Fewer slots than members", `กิลด์นี้มีสมาชิก ${count} คนแล้ว ตั้งจำนวนรับต่ำกว่านั้นไม่ได้`);
    }
    return tx.guild.update({ where: { id }, data: input });
  });
}

export function adminRemoveMember(id: string, playerId: string) {
  return prisma.$transaction(async (tx) => {
    const member = await tx.player.findUnique({ where: { id: playerId }, select: { guildId: true } });
    if (!member || member.guildId !== id) throw notFound("Member");
    return removeFromGuild(tx, id, playerId);
  });
}

export async function adminDeleteGuild(id: string) {
  if (!(await prisma.guild.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Guild");
  await prisma.guild.delete({ where: { id } });
}

// ---- Reading ----------------------------------------------------------------

const memberSelect = { id: true, name: true, nickname: true, avatarUrl: true, mmr: true, role: true, discordId: true, _count: { select: { mmrLog: true } } } as const;

type MemberRow = Prisma.PlayerGetPayload<{ select: typeof memberSelect }>;

/**
 * Members in guild order: everyone who has played ranks by MMR (#1 is the guild's best),
 * players with no series yet follow, unranked.
 */
function rankMembers(members: MemberRow[], leaderId: string | null) {
  const order = (a: MemberRow, b: MemberRow) => b.mmr - a.mmr || b._count.mmrLog - a._count.mmrLog || a.name.localeCompare(b.name);
  const played = members.filter((m) => m._count.mmrLog > 0).sort(order);
  const fresh = members.filter((m) => m._count.mmrLog === 0).sort((a, b) => a.name.localeCompare(b.name));
  const view = ({ _count, discordId, ...m }: MemberRow) => ({ ...m, ...tierInfo(m.mmr), series: _count.mmrLog, linked: Boolean(discordId), leader: m.id === leaderId });
  return [
    ...withRanks(played.map(view), (m) => m.mmr).map(({ rank, ...m }) => ({ ...m, guildRank: rank as number | null })),
    ...fresh.map((m) => ({ ...view(m), guildRank: null as number | null })),
  ];
}

export const guildQuery = z.object({
  search: z.string().trim().max(100).optional(),
  gameId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

/** A guild's score is the average MMR of its best SCORE_TOP members who have played. */
export const SCORE_TOP = 5;

function guildScore(members: MemberRow[]) {
  const best = members.filter((m) => m._count.mmrLog > 0).map((m) => m.mmr).sort((a, b) => b - a).slice(0, SCORE_TOP);
  return best.length ? Math.round(best.reduce((n, x) => n + x, 0) / best.length) : null;
}

/**
 * Every guild of a game ranked by score (ties share a rank); guilds where nobody has played yet
 * follow, unranked. Ranks are across all guilds, so a search keeps each guild's real place.
 */
async function rankedGuilds(gameId?: string) {
  const rows = await prisma.guild.findMany({
    where: gameId ? { gameId } : {},
    include: { game: { select: { id: true, name: true } }, members: { select: memberSelect } },
  });
  const scored = rows.map((g) => ({ g, score: guildScore(g.members) }));
  scored.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.g.members.length - a.g.members.length || a.g.name.localeCompare(b.g.name));
  const withScore = withRanks(scored.filter((x) => x.score !== null), (x) => x.score!);
  const rank = new Map(withScore.map((x) => [x.g.id, x.rank]));
  return scored.map(({ g, score }) => ({ g, score, rank: rank.get(g.id) ?? null }));
}

/** Guilds in ranking order, each with its score, rank, leader and its #1 player. */
export async function listGuilds(query: unknown) {
  const q = guildQuery.parse(query);
  const needle = q.search?.toLowerCase();
  const all = (await rankedGuilds(q.gameId)).filter(({ g }) => !needle || g.name.toLowerCase().includes(needle) || (g.tag ?? "").toLowerCase().includes(needle));
  const data = all.slice(q.offset, q.offset + q.limit).map(({ g: { members, ...g }, score, rank }) => {
    const ranked = rankMembers(members, g.leaderId);
    const short = (m: (typeof ranked)[number] | undefined) => (m ? { id: m.id, name: m.name, nickname: m.nickname, avatarUrl: m.avatarUrl, mmr: m.mmr, tier: m.tier } : null);
    return {
      ...g,
      score,
      rank,
      memberCount: members.length,
      leader: short(ranked.find((m) => m.leader)),
      top: short(ranked.find((m) => m.guildRank === 1)),
    };
  });
  return { data, total: all.length, limit: q.limit, offset: q.offset };
}

/** A guild page: its members ranked inside the guild, with their place on the whole game's board. */
export async function guildDetail(id: string) {
  const guild = await prisma.guild.findUnique({
    where: { id },
    include: { game: { select: { id: true, name: true } }, members: { select: { ...memberSelect, team: { select: { id: true, name: true, tag: true, logoUrl: true } } } } },
  });
  if (!guild) throw notFound("Guild");
  const [board, standings] = await Promise.all([playerBoard(guild.gameId), rankedGuilds(guild.gameId ?? undefined)]);
  const standing = standings.find((x) => x.g.id === guild.id);
  const boardRank = new Map(board.ranked.map((r) => [r.id, r.rank]));
  const team = new Map(guild.members.map((m) => [m.id, m.team]));
  const { members, ...rest } = guild;
  const ranked = rankMembers(members, guild.leaderId).map((m) => ({ ...m, team: team.get(m.id) ?? null, mmrRank: boardRank.get(m.id) ?? null }));
  return {
    ...rest,
    memberCount: members.length,
    score: standing?.score ?? null,
    rank: standing?.rank ?? null,
    guilds: standings.length,
    full: full(members.length, guild.capacity),
    leader: ranked.find((m) => m.leader) ?? null,
    top: ranked.find((m) => m.guildRank === 1) ?? null,
    members: ranked,
  };
}

/** What "my profile" needs about one character: its guild (with invites sent, for the leader) and invites received. */
export async function guildsForMember(players: { id: string; guildId: string | null }[]) {
  const guildIds = [...new Set(players.map((p) => p.guildId).filter((x): x is string => Boolean(x)))];
  const [guilds, received] = await Promise.all([
    prisma.guild.findMany({
      where: { id: { in: guildIds } },
      include: {
        members: { select: memberSelect },
        invites: { include: { player: { select: { id: true, name: true, uid: true, server: true, discordId: true, guildId: true } } }, orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.guildInvite.findMany({
      where: { playerId: { in: players.map((p) => p.id) } },
      include: { guild: { include: { _count: { select: { members: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return new Map(
    players.map((p) => {
      const g = guilds.find((x) => x.id === p.guildId);
      const leader = g?.leaderId === p.id;
      const members = g ? rankMembers(g.members, g.leaderId) : [];
      return [
        p.id,
        {
          guild: g
            ? {
                id: g.id, name: g.name, tag: g.tag, logoUrl: g.logoUrl, description: g.description, capacity: g.capacity, leaderId: g.leaderId,
                memberCount: g.members.length,
                isLeader: leader,
                myRank: members.find((m) => m.id === p.id)?.guildRank ?? null,
                members,
                invites: leader
                  ? g.invites.map((i) => ({ id: i.id, createdAt: i.createdAt, player: { id: i.player.id, name: i.player.name, uid: i.player.uid, server: i.player.server, linked: Boolean(i.player.discordId), inGuild: Boolean(i.player.guildId) } }))
                  : [],
              }
            : null,
          guildInvites: received
            .filter((i) => i.playerId === p.id)
            .map((i) => ({ id: i.id, createdAt: i.createdAt, guild: { id: i.guild.id, name: i.guild.name, tag: i.guild.tag, logoUrl: i.guild.logoUrl, capacity: i.guild.capacity, memberCount: i.guild._count.members } })),
        },
      ] as const;
    }),
  );
}

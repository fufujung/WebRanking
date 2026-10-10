/**
 * Running a tournament: registrations and rosters, seeding, the live bracket, check-ins,
 * walkovers, disputes and results. Bracket rules live in bracket.ts; this file loads
 * and saves them.
 */
import { randomInt } from "node:crypto";
import type { BracketMatch, Prisma, Tournament } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { recomputeRatings } from "./elo.js";
import { getMatch, saveMatch } from "./matchWrite.js";
import {
  affectedBy,
  buildBracket,
  complete,
  firstRoundPositions,
  isFinished,
  placements,
  positionsProblem,
  reopen,
  roundLabel,
  roundRobinTable,
  type Format,
  type Outcome,
  type Side,
  type Slot,
  type SlotStatus,
  type Stage,
} from "./bracket.js";
import { bracketResultInput, matchInput, normaliseName, registrationInput, rosterInput, seedingInput } from "./validate.js";
import { teamSummary } from "./selects.js";

type Tx = Prisma.TransactionClient;

// ---------- Serialising writes ----------

let queue: Promise<unknown> = Promise.resolve();
/** Bracket changes run one at a time, so two people reporting at once can't both advance a team. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// ---------- Loading ----------

async function tournamentOr404(id: string) {
  const t = await prisma.tournament.findUnique({ where: { id } });
  if (!t) throw notFound("Tournament");
  return t;
}

const toSlot = (r: BracketMatch): Slot => ({
  code: r.code,
  stage: r.stage as Stage,
  round: r.round,
  position: r.position,
  number: r.number,
  teamAId: r.teamAId,
  teamBId: r.teamBId,
  byeA: r.byeA,
  byeB: r.byeB,
  winnerTo: r.winnerTo,
  winnerSide: r.winnerSide as Side | null,
  loserTo: r.loserTo,
  loserSide: r.loserSide as Side | null,
  status: r.status as SlotStatus,
  outcome: r.outcome as Outcome | null,
  winnerId: r.winnerId,
  loserId: r.loserId,
  scoreA: r.scoreA,
  scoreB: r.scoreB,
});

async function loadRows(tournamentId: string) {
  return prisma.bracketMatch.findMany({ where: { tournamentId }, orderBy: { number: "asc" } });
}

/** Finds a slot by id, code (W1-0) or match number (12 or M12). */
function findRow(rows: BracketMatch[], ref: string) {
  const byNumber = /^m?(\d+)$/i.exec(ref.trim());
  const row = rows.find((r) => r.id === ref) ?? rows.find((r) => r.code === ref) ?? (byNumber ? rows.find((r) => r.number === Number(byNumber[1])) : undefined);
  if (!row) throw fail(404, "Bracket match not found", "ไม่พบแมตช์นี้ในสาย");
  return row;
}

const SLOT_FIELDS = ["teamAId", "teamBId", "byeA", "byeB", "status", "outcome", "winnerId", "loserId", "scoreA", "scoreB"] as const;

/** Writes back the slots the bracket logic changed, clearing check-ins where the teams changed. */
async function writeSlots(tx: Tx, rows: BracketMatch[], slots: Slot[], extra: Map<string, Prisma.BracketMatchUpdateInput> = new Map()) {
  const now = new Date();
  for (const row of rows) {
    const s = slots.find((x) => x.code === row.code)!;
    const data: Prisma.BracketMatchUpdateInput = { ...extra.get(row.code) };
    let changed = Boolean(extra.get(row.code));
    for (const f of SLOT_FIELDS) {
      if (row[f] !== s[f]) {
        (data as Record<string, unknown>)[f] = s[f];
        changed = true;
      }
    }
    if (!changed) continue;
    if (row.teamAId !== s.teamAId) data.checkInA = null;
    if (row.teamBId !== s.teamBId) data.checkInB = null;
    if (row.status === "DONE" && s.status !== "DONE") {
      Object.assign(data, { completedAt: null, disputed: false, disputeNote: null, checkInA: null, checkInB: null });
      if (!("match" in data)) data.match = { disconnect: true };
    }
    if (row.status !== "DONE" && s.status === "DONE") data.completedAt = now;
    await tx.bracketMatch.update({ where: { id: row.id }, data });
  }
}

/** After a change: finishes the tournament when the last match is done, or reopens it. */
async function syncFinish(tx: Tx, t: Tournament, slots: Slot[]) {
  if (t.bracketStatus === "DRAFT" || t.bracketStatus === "NONE") return;
  const entries = await tx.tournamentEntry.findMany({ where: { tournamentId: t.id }, select: { teamId: true } });
  if (isFinished(slots)) {
    const places = placements(t.format as Format, slots, entries.map((e) => e.teamId));
    for (const e of entries) {
      await tx.tournamentEntry.update({ where: { tournamentId_teamId: { tournamentId: t.id, teamId: e.teamId } }, data: { placement: places.get(e.teamId) ?? null } });
    }
    await tx.tournament.update({ where: { id: t.id }, data: { bracketStatus: "DONE", status: "COMPLETED", endDate: t.endDate ?? new Date() } });
  } else if (t.bracketStatus === "DONE") {
    await tx.tournamentEntry.updateMany({ where: { tournamentId: t.id }, data: { placement: null } });
    await tx.tournament.update({ where: { id: t.id }, data: { bracketStatus: "LIVE", status: "ONGOING" } });
  }
}

// ---------- Rosters ----------

export function rosterLock(t: Pick<Tournament, "bracketStatus">, rows: Pick<BracketMatch, "scheduledAt" | "outcome">[], now = new Date()) {
  if (t.bracketStatus === "DONE") return { locked: true, lockAt: null as Date | null };
  if (t.bracketStatus !== "LIVE") return { locked: false, lockAt: null as Date | null };
  const times = rows.map((r) => r.scheduledAt?.getTime()).filter((x): x is number => x !== undefined);
  const lockAt = times.length ? new Date(Math.min(...times)) : null;
  const started = rows.some((r) => r.outcome === "PLAYED" || r.outcome === "WALKOVER");
  return { locked: started || (lockAt !== null && lockAt <= now), lockAt };
}

type RosterIn = z.infer<typeof rosterInput>;

function checkRosterShape(t: Tournament, players: RosterIn["players"]) {
  if (players.length < t.rosterMin || players.length > t.rosterMax) {
    throw fail(400, `A roster needs ${t.rosterMin}-${t.rosterMax} players`, `รายชื่อต้องมี ${t.rosterMin}-${t.rosterMax} คน (ส่งมา ${players.length} คน)`);
  }
  const names = players.map((p) => normaliseName(p.name));
  if (names.some((n) => !n)) throw fail(400, "Player names must contain letters or numbers", "ชื่อผู้เล่นต้องมีตัวอักษรหรือตัวเลข");
  if (new Set(names).size !== names.length) throw fail(400, "A player is listed twice", "มีชื่อผู้เล่นซ้ำในรายชื่อ");
  const ids = players.map((p) => p.discordId).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw fail(400, "A Discord account is listed twice", "มีบัญชี Discord ซ้ำในรายชื่อ");
  const uids = players.filter((p) => p.uid).map(uidKey);
  if (new Set(uids).size !== uids.length) throw fail(400, "A UID is listed twice", "มี UID ซ้ำในรายชื่อ");
}

/** The same character: UID plus server (servers may reuse UIDs), compared without case. */
const uidKey = (p: { uid: string | null; server: string | null }) => `${(p.uid ?? "").toLowerCase()}@${(p.server ?? "").toLowerCase()}`;

export function parseMemberIds(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Discord accounts or characters already on another team in this tournament (one account, one character, one team). */
async function rosterClash(tx: Tx, tournamentId: string, entryId: string | null, discordIds: string[], players: RosterIn["players"]) {
  const others = await tx.tournamentEntry.findMany({
    where: { tournamentId, ...(entryId ? { id: { not: entryId } } : {}) },
    include: { team: { select: { name: true } }, roster: { select: { discordId: true, uid: true, server: true, player: { select: { name: true } } } } },
  });
  const wanted = new Set(discordIds);
  for (const e of others) {
    const theirs = [e.captainDiscordId, ...e.roster.map((r) => r.discordId), ...parseMemberIds(e.memberDiscordIds)];
    const clash = theirs.find((id): id is string => Boolean(id && wanted.has(id)));
    if (clash) throw fail(409, "A player is already on another team in this tournament", `<@${clash}> อยู่ในทีม ${e.team.name} แล้ว (หนึ่งคนลงได้ทีมเดียว)`, { discordId: clash });
    for (const p of players) {
      if (!p.uid) continue;
      const same = e.roster.find((r) => r.uid && uidKey(r) === uidKey(p));
      if (same) throw fail(409, "This character is already on another team in this tournament", `UID ${p.uid}${p.server ? ` (${p.server})` : ""} อยู่ในทีม ${e.team.name} แล้ว`, { uid: p.uid });
    }
  }
}

type RosterRow = { playerId: string; discordId: string | null; uid: string | null; server: string | null };

/** Finds or creates each roster player, preferring the same character (UID), then the same Discord account, then the same name on this team. */
async function resolveRoster(tx: Tx, teamId: string, players: RosterIn["players"]) {
  const out: RosterRow[] = [];
  for (const p of players) {
    const key = normaliseName(p.name);
    let playerId: string | null = null;
    const known =
      (p.uid ? await tx.rosterPlayer.findFirst({ where: { uid: p.uid, server: p.server }, orderBy: { id: "desc" }, include: { player: true } }) : null) ??
      (p.discordId ? await tx.rosterPlayer.findFirst({ where: { discordId: p.discordId }, orderBy: { id: "desc" }, include: { player: true } }) : null);
    if (known) {
      playerId = known.playerId;
      const pl = known.player;
      const sameName = normaliseName(pl.name) === key || (pl.nickname !== null && normaliseName(pl.nickname) === key);
      await tx.player.update({
        where: { id: pl.id },
        data: { teamId, ...(sameName ? {} : { name: p.name, nickname: pl.nickname ?? pl.name }) },
      });
    }
    if (!playerId) {
      const candidates = await tx.player.findMany({ where: { OR: [{ teamId }, { teamId: null }] }, select: { id: true, name: true, nickname: true, teamId: true } });
      const same = (x: (typeof candidates)[number]) => normaliseName(x.name) === key || (x.nickname !== null && normaliseName(x.nickname) === key);
      const found = candidates.find((x) => x.teamId === teamId && same(x)) ?? candidates.find(same);
      if (found) {
        playerId = found.id;
        if (found.teamId !== teamId) await tx.player.update({ where: { id: found.id }, data: { teamId } });
      } else {
        playerId = (await tx.player.create({ data: { name: p.name, teamId } })).id;
      }
    }
    if (out.some((o) => o.playerId === playerId)) throw fail(400, "A player is listed twice", "มีผู้เล่นซ้ำในรายชื่อ");
    out.push({ playerId, discordId: p.discordId, uid: p.uid, server: p.server });
  }
  return out;
}

async function replaceRoster(tx: Tx, entryId: string, roster: RosterRow[]) {
  await tx.rosterPlayer.deleteMany({ where: { entryId } });
  for (const [order, r] of roster.entries()) await tx.rosterPlayer.create({ data: { entryId, ...r, order } });
}

/** Every Discord account a roster change brings onto the team. */
const teamDiscordIds = (captain: string | null | undefined, input: RosterIn, members: string[]) =>
  [...new Set([captain, ...input.players.map((p) => p.discordId), ...members].filter((x): x is string => Boolean(x)))];

/** Extra Discord accounts, without the captain or anyone already on a roster line. */
const extraMembers = (captain: string | null | undefined, input: RosterIn, members: string[]) =>
  [...new Set(members)].filter((id) => id !== captain && !input.players.some((p) => p.discordId === id));

/** A team signs up (from Discord, or added by an organizer with override). */
export function register(tournamentId: string, body: unknown) {
  const input = registrationInput.parse(body);
  return serial(async () => {
    const t = await tournamentOr404(tournamentId);
    if (!input.override && !t.registrationOpen) throw fail(409, "Registration is closed", "ปิดรับสมัครแล้ว");
    if (t.bracketStatus === "LIVE" || t.bracketStatus === "DONE") throw fail(409, "The tournament has already started", "ทัวร์นาเมนต์เริ่มแข่งแล้ว สมัครเพิ่มไม่ได้");
    checkRosterShape(t, input.players);
    const count = await prisma.tournamentEntry.count({ where: { tournamentId } });
    if (t.maxTeams && count >= t.maxTeams) throw fail(409, "The tournament is full", `ทีมเต็มแล้ว (${t.maxTeams} ทีม)`);

    const teamId = await prisma.$transaction(async (tx) => {
      const key = normaliseName(input.teamName);
      if (!key) throw fail(400, "Team names must contain letters or numbers", "ชื่อทีมต้องมีตัวอักษรหรือตัวเลข");
      const teams = await tx.team.findMany({ select: { id: true, name: true, tag: true } });
      let team = teams.find((x) => normaliseName(x.name) === key);
      if (!team) team = await tx.team.create({ data: { name: input.teamName, tag: input.tag } });
      else if (input.tag && !team.tag) await tx.team.update({ where: { id: team.id }, data: { tag: input.tag } });
      const existing = await tx.tournamentEntry.findUnique({ where: { tournamentId_teamId: { tournamentId, teamId: team.id } } });
      if (existing) throw fail(409, "This team is already registered", `ทีม ${team.name} สมัครไว้แล้ว`);
      const members = extraMembers(input.captainDiscordId, input, input.memberDiscordIds ?? []);
      await rosterClash(tx, tournamentId, null, teamDiscordIds(input.captainDiscordId, input, members), input.players);
      if (input.captainDiscordId) {
        const captainElsewhere = await tx.tournamentEntry.findFirst({ where: { tournamentId, captainDiscordId: input.captainDiscordId }, include: { team: true } });
        if (captainElsewhere) throw fail(409, "This captain already leads another team", `คุณเป็นหัวหน้าทีม ${captainElsewhere.team.name} อยู่แล้ว`);
      }
      const entry = await tx.tournamentEntry.create({ data: { tournamentId, teamId: team.id, captainDiscordId: input.captainDiscordId ?? null, memberDiscordIds: JSON.stringify(members) } });
      await replaceRoster(tx, entry.id, await resolveRoster(tx, team.id, input.players));
      // A new team invalidates a seeded-but-not-started bracket.
      if (t.bracketStatus === "DRAFT") await dropDraft(tx, tournamentId);
      return team.id;
    });
    return entryView(tournamentId, teamId);
  });
}

/** Replaces a team's roster (and optionally its captain). Locked once the first match starts, unless override. */
export function setRoster(tournamentId: string, teamId: string, body: unknown) {
  const input = rosterInput.parse(body);
  return serial(async () => {
    const t = await tournamentOr404(tournamentId);
    const entry = await prisma.tournamentEntry.findUnique({ where: { tournamentId_teamId: { tournamentId, teamId } } });
    if (!entry) throw fail(404, "This team is not in the tournament", "ทีมนี้ไม่ได้อยู่ในทัวร์นาเมนต์");
    const lock = rosterLock(t, await loadRows(tournamentId));
    if (lock.locked && !input.override) throw fail(409, "Rosters are locked: the first match has started", "เปลี่ยนรายชื่อไม่ได้แล้ว เพราะแมตช์แรกเริ่มไปแล้ว (ติดต่อผู้จัด)");
    checkRosterShape(t, input.players);
    await prisma.$transaction(async (tx) => {
      const captain = input.captainDiscordId !== undefined ? input.captainDiscordId : entry.captainDiscordId;
      const members = extraMembers(captain, input, input.memberDiscordIds ?? parseMemberIds(entry.memberDiscordIds));
      await rosterClash(tx, tournamentId, entry.id, teamDiscordIds(captain, input, members), input.players);
      await tx.tournamentEntry.update({ where: { id: entry.id }, data: { memberDiscordIds: JSON.stringify(members) } });
      if (input.captainDiscordId !== undefined) {
        if (input.captainDiscordId) {
          const other = await tx.tournamentEntry.findFirst({ where: { tournamentId, captainDiscordId: input.captainDiscordId, id: { not: entry.id } }, include: { team: true } });
          if (other) throw fail(409, "This captain already leads another team", `คนนี้เป็นหัวหน้าทีม ${other.team.name} อยู่แล้ว`);
        }
        await tx.tournamentEntry.update({ where: { id: entry.id }, data: { captainDiscordId: input.captainDiscordId } });
      }
      await replaceRoster(tx, entry.id, await resolveRoster(tx, teamId, input.players));
    });
    return entryView(tournamentId, teamId);
  });
}

/** Takes a team out before the bracket starts. */
export function withdraw(tournamentId: string, teamId: string) {
  return serial(async () => {
    const t = await tournamentOr404(tournamentId);
    if (t.bracketStatus === "LIVE" || t.bracketStatus === "DONE") {
      throw fail(409, "The bracket has started; give the team's matches to their opponents instead", "เริ่มแข่งแล้ว เอาทีมออกไม่ได้ ให้ตัดสินแพ้บายแทน");
    }
    const played = await prisma.match.count({ where: { tournamentId, OR: [{ teamAId: teamId }, { teamBId: teamId }] } });
    if (played) throw fail(409, "Team has matches in this tournament; delete those matches first", "ทีมนี้มีแมตช์ในรายการแล้ว ต้องลบแมตช์ก่อน");
    await prisma.$transaction(async (tx) => {
      await tx.tournamentEntry.delete({ where: { tournamentId_teamId: { tournamentId, teamId } } });
      if (t.bracketStatus === "DRAFT") await dropDraft(tx, tournamentId);
    });
  });
}

const entryInclude = {
  team: teamSummary,
  roster: { orderBy: { order: "asc" as const }, include: { player: { select: { id: true, name: true, nickname: true } } } },
} satisfies Prisma.TournamentEntryInclude;

type EntryRow = Prisma.TournamentEntryGetPayload<{ include: typeof entryInclude }>;

const shapeEntry = (e: EntryRow) => ({
  ...e.team,
  seed: e.seed,
  placement: e.placement,
  captainDiscordId: e.captainDiscordId,
  memberDiscordIds: parseMemberIds(e.memberDiscordIds),
  registeredAt: e.createdAt,
  roster: e.roster.map((r) => ({ playerId: r.playerId, name: r.player.name, discordId: r.discordId, uid: r.uid, server: r.server })),
});

export async function entryView(tournamentId: string, teamId: string) {
  const e = await prisma.tournamentEntry.findUniqueOrThrow({ where: { tournamentId_teamId: { tournamentId, teamId } }, include: entryInclude });
  return shapeEntry(e);
}

export async function entriesView(tournamentId: string) {
  const entries = await prisma.tournamentEntry.findMany({ where: { tournamentId }, include: entryInclude, orderBy: [{ seed: "asc" }, { createdAt: "asc" }] });
  return entries.map(shapeEntry);
}

// ---------- Seeding and starting ----------

async function dropDraft(tx: Tx, tournamentId: string) {
  await tx.bracketMatch.deleteMany({ where: { tournamentId } });
  await tx.tournamentEntry.updateMany({ where: { tournamentId }, data: { seed: null } });
  await tx.tournament.update({ where: { id: tournamentId }, data: { bracketStatus: "NONE" } });
}

function shuffle<T>(list: T[]) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Seeds the registered teams and builds a bracket to review. Nothing is played until start(). */
export function seed(tournamentId: string, body: unknown) {
  const input = seedingInput.parse(body);
  return serial(async () => {
    const t = await tournamentOr404(tournamentId);
    if (!t.format) throw fail(409, "Choose a format first", "ยังไม่ได้เลือกรูปแบบการแข่ง (Single / Double Elimination / Round Robin)");
    if (t.bracketStatus === "LIVE" || t.bracketStatus === "DONE") throw fail(409, "The bracket has already started", "เริ่มแข่งไปแล้ว จัดสายใหม่ไม่ได้ (ต้องรีเซ็ตสายก่อน)");
    const entries = await prisma.tournamentEntry.findMany({ where: { tournamentId }, include: { team: true }, orderBy: { createdAt: "asc" } });
    if (entries.length < 2) throw fail(409, "At least 2 teams are needed", "ต้องมีอย่างน้อย 2 ทีมจึงจะจัดสายได้");
    const ids = entries.map((e) => e.teamId);
    let order: string[];
    let positions: (string | null)[] | undefined;
    if (input.method === "random") order = shuffle(ids);
    else if (input.method === "rating") order = [...entries].sort((a, b) => b.team.rating - a.team.rating).map((e) => e.teamId);
    else if (input.positions) {
      if (t.format === "ROUND_ROBIN") throw fail(400, "Round robin has no positions; send order instead", "Round Robin ไม่มีตำแหน่งในสาย ให้ส่งลำดับทีมแทน");
      const problem = positionsProblem(input.positions, ids);
      if (problem) throw fail(400, "Invalid bracket positions", problem);
      positions = input.positions;
      order = input.positions.filter((p): p is string => p !== null);
    } else if (input.order) {
      const valid = input.order.length === ids.length && new Set(input.order).size === ids.length && input.order.every((id) => ids.includes(id));
      if (!valid) throw fail(400, "order must list every registered team once", "ลำดับต้องมีทุกทีมที่สมัคร ทีมละครั้ง");
      order = input.order;
    } else throw fail(400, "Send order or positions for manual seeding", "จัดเองต้องส่งลำดับทีมหรือตำแหน่งในสาย");

    const slots = buildBracket(t.format as Format, order, { thirdPlaceMatch: t.thirdPlaceMatch, grandFinalReset: t.grandFinalReset }, positions);
    await prisma.$transaction(async (tx) => {
      await tx.bracketMatch.deleteMany({ where: { tournamentId } });
      for (const [i, teamId] of order.entries()) {
        await tx.tournamentEntry.update({ where: { tournamentId_teamId: { tournamentId, teamId } }, data: { seed: i + 1 } });
      }
      for (const s of slots) await tx.bracketMatch.create({ data: { tournamentId, ...s } });
      await tx.tournament.update({ where: { id: tournamentId }, data: { bracketStatus: "DRAFT" } });
    });
    return bracketView(tournamentId);
  });
}

/** Locks the reviewed bracket and starts the tournament. Registration closes. */
export function start(tournamentId: string) {
  return serial(async () => {
    const t = await tournamentOr404(tournamentId);
    if (t.bracketStatus !== "DRAFT") throw fail(409, "Seed the bracket first", t.bracketStatus === "NONE" ? "ยังไม่ได้จัดสาย" : "ทัวร์นาเมนต์เริ่มไปแล้ว");
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      // Matches ready at the start are played at the tournament's start time, unless set otherwise.
      if (t.startDate > now) {
        await tx.bracketMatch.updateMany({ where: { tournamentId, status: "READY", scheduledAt: null }, data: { scheduledAt: t.startDate } });
      }
      await tx.tournament.update({ where: { id: tournamentId }, data: { bracketStatus: "LIVE", status: "ONGOING", registrationOpen: false } });
    });
    return bracketView(tournamentId);
  });
}

/** Removes the bracket. A started bracket needs force; recorded series stay as plain results. */
export function resetBracket(tournamentId: string, force: boolean) {
  return serial(async () => {
    const t = await tournamentOr404(tournamentId);
    if ((t.bracketStatus === "LIVE" || t.bracketStatus === "DONE") && !force) {
      throw fail(409, "The bracket has started; pass force=true to delete it", "สายนี้เริ่มแข่งแล้ว ต้องยืนยันการลบ (ผลที่บันทึกไว้จะยังอยู่)");
    }
    await prisma.$transaction(async (tx) => {
      await dropDraft(tx, tournamentId);
      await tx.tournamentEntry.updateMany({ where: { tournamentId }, data: { placement: null } });
      if (t.status === "COMPLETED" || t.status === "ONGOING") await tx.tournament.update({ where: { id: tournamentId }, data: { status: "UPCOMING" } });
    });
  });
}

// ---------- Live bracket ----------

async function liveContext(tournamentId: string, ref: string, allowDone = false) {
  const t = await tournamentOr404(tournamentId);
  if (t.bracketStatus !== "LIVE" && !(allowDone && t.bracketStatus === "DONE")) {
    throw fail(409, "The bracket is not running", t.bracketStatus === "DONE" ? "ทัวร์นาเมนต์จบแล้ว" : "ยังไม่ได้เริ่มแข่ง (ต้องยืนยันสายก่อน)");
  }
  const rows = await loadRows(tournamentId);
  const row = findRow(rows, ref);
  return { t, rows, row, slots: rows.map(toSlot) };
}

const wins = (bestOf: number) => Math.ceil(bestOf / 2);

/** Undoes results and deletes the series behind them (other than `keep`). */
async function undo(slots: Slot[], rows: BracketMatch[], code: string, keep?: string | null) {
  const undone = reopen(slots, code);
  const matchIds = rows.filter((r) => undone.includes(r.code) && r.matchId && r.matchId !== keep).map((r) => r.matchId!);
  return matchIds;
}

function needForce(slots: Slot[], code: string, force: boolean) {
  const affected = affectedBy(slots, code);
  if (affected.length && !force) {
    throw fail(409, "Later matches already have results", `ต้องล้างผลของแมตช์ที่แข่งต่อจากนี้ด้วย: ${affected.map((s) => `M${s.number}`).join(", ")}`, {
      affected: affected.map((s) => ({ code: s.code, number: s.number })),
    });
  }
}

async function deleteSeries(matchIds: string[]) {
  if (!matchIds.length) return;
  await prisma.bracketMatch.updateMany({ where: { matchId: { in: matchIds } }, data: { matchId: null } });
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await recomputeRatings();
}

/** Records a played series on a bracket match (or corrects one) and moves the teams on. */
export function recordResult(tournamentId: string, ref: string, body: unknown) {
  const input = bracketResultInput.parse(body);
  return serial(async () => {
    const { t, rows, row, slots } = await liveContext(tournamentId, ref, true);
    if (row.status !== "READY" && !(row.status === "DONE" && row.outcome !== "BYE")) {
      throw fail(409, "This match is not ready to be played", "แมตช์นี้ยังไม่พร้อมแข่ง (รอทีมจากรอบก่อน)");
    }
    if (input.sourceRef && row.matchId) {
      const same = await prisma.match.findUnique({ where: { id: row.matchId }, select: { sourceRef: true } });
      if (same?.sourceRef === input.sourceRef) return slotView(tournamentId, row.id);
    }
    if (row.status === "DONE" && !input.replace) throw fail(409, "This match already has a result", "แมตช์นี้มีผลแล้ว (ถ้าจะแก้ผล ให้ผู้จัดแก้ในเว็บ หรือกดยกเลิกผลก่อน)");
    const scoreA = input.scoreA ?? input.games.filter((g) => g.scoreA > g.scoreB).length;
    const scoreB = input.scoreB ?? input.games.filter((g) => g.scoreB > g.scoreA).length;
    const winnerId = scoreA > scoreB ? row.teamAId : scoreB > scoreA ? row.teamBId : null;
    if (!winnerId && row.stage !== "RR") throw fail(400, "Knockout matches need a winner", `ผล ${scoreA}-${scoreB} ไม่มีผู้ชนะ รอบน็อคเอาท์ต้องมีทีมชนะ`);

    const changesWinner = row.status === "DONE" && row.winnerId !== winnerId;
    if (changesWinner) needForce(slots, row.code, input.force);
    const series = matchInput.parse({
      tournamentId,
      teamAId: row.teamAId,
      teamBId: row.teamBId,
      scoreA: input.scoreA,
      scoreB: input.scoreB,
      round: `M${row.number} · ${roundLabel(t.format as Format, row as Slot, slots)}`,
      notes: input.notes,
      imageUrl: input.imageUrl,
      playedAt: input.playedAt,
      source: input.source,
      sourceRef: input.sourceRef,
      games: input.games,
    });
    const existing = row.matchId ? await prisma.match.findUnique({ where: { id: row.matchId }, select: { id: true } }) : null;
    const saved = await saveMatch(series, existing?.id);

    let doomed: string[] = [];
    if (row.status === "DONE" && !changesWinner) {
      // Same winner: only the score and the series change, later matches stay as they are.
      const s = slots.find((x) => x.code === row.code)!;
      Object.assign(s, { scoreA, scoreB, outcome: "PLAYED" });
    } else {
      if (row.status === "DONE") doomed = await undo(slots, rows, row.code, saved.id);
      complete(slots, row.code, { winnerId, scoreA, scoreB, outcome: "PLAYED" });
    }
    await prisma.$transaction(async (tx) => {
      await writeSlots(tx, rows, slots, new Map([[row.code, { match: { connect: { id: saved.id } }, disputed: false, disputeNote: null }]]));
      await syncFinish(tx, t, slots);
    });
    await deleteSeries(doomed);
    return slotView(tournamentId, row.id);
  });
}

/**
 * Gives a match to one team without playing it. A team claims it themselves when they
 * checked in and the other team did not arrive within the late allowance; an organizer
 * can decide any match (overturning a result needs force when later matches were played).
 */
export function walkover(tournamentId: string, ref: string, body: unknown) {
  const input = z.object({ teamId: z.string().min(1), mode: z.enum(["claim", "organizer"]), force: z.boolean().default(false), note: z.string().trim().max(500).optional() }).parse(body);
  return serial(async () => {
    const { t, rows, row, slots } = await liveContext(tournamentId, ref, input.mode === "organizer");
    if (input.teamId !== row.teamAId && input.teamId !== row.teamBId) throw fail(400, "That team is not in this match", "ทีมนี้ไม่ได้อยู่ในแมตช์นี้");
    const side: Side = input.teamId === row.teamAId ? "A" : "B";
    if (input.mode === "claim") {
      if (row.status !== "READY") throw fail(409, "This match is already decided", "แมตช์นี้มีผลแล้ว");
      if (!row.scheduledAt) throw fail(409, "This match has no start time", "แมตช์นี้ยังไม่ได้กำหนดเวลาแข่ง จึงขอชนะบายไม่ได้ ให้ติดต่อผู้จัด");
      const deadline = new Date(row.scheduledAt.getTime() + t.lateMinutes * 60_000);
      if (Date.now() < deadline.getTime()) {
        throw fail(409, "The other team still has time to arrive", `อีกทีมยังมาได้ถึง ${thaiTime(deadline)} (เลทได้ ${t.lateMinutes} นาที)`, { deadline });
      }
      const mine = side === "A" ? row.checkInA : row.checkInB;
      const theirs = side === "A" ? row.checkInB : row.checkInA;
      if (!mine) throw fail(409, "Check in first", "ทีมคุณต้องกดเช็คอินก่อน จึงจะขอชนะบายได้");
      if (theirs && theirs <= deadline) throw fail(409, "The other team checked in on time", "อีกทีมเช็คอินทันเวลา ต้องแข่งกันตามปกติ");
    } else if (row.status === "DONE") {
      if (row.outcome === "BYE") throw fail(409, "This match was a bye", "แมตช์นี้เป็นบายอัตโนมัติ");
      if (row.winnerId === input.teamId) return slotView(tournamentId, row.id);
      needForce(slots, row.code, input.force);
    } else if (row.status !== "READY") {
      throw fail(409, "This match is not ready", "แมตช์นี้ยังไม่พร้อม (รอทีมจากรอบก่อน)");
    }

    const doomed = row.status === "DONE" ? await undo(slots, rows, row.code) : [];
    const w = wins(t.bestOf);
    complete(slots, row.code, { winnerId: input.teamId, scoreA: side === "A" ? w : 0, scoreB: side === "B" ? w : 0, outcome: "WALKOVER" });
    await prisma.$transaction(async (tx) => {
      const note = input.note ?? (input.mode === "claim" ? "อีกทีมมาไม่ทันเวลา" : "ผู้จัดตัดสิน");
      await writeSlots(tx, rows, slots, new Map([[row.code, { disputed: false, disputeNote: note, match: { disconnect: true } }]]));
      await syncFinish(tx, t, slots);
    });
    await deleteSeries(doomed);
    return slotView(tournamentId, row.id);
  });
}

/** Clears a match's result so it can be played again (and every later result that depended on it). */
export function reopenMatch(tournamentId: string, ref: string, force: boolean) {
  return serial(async () => {
    const { t, rows, row, slots } = await liveContext(tournamentId, ref, true);
    if (row.status !== "DONE" || row.outcome === "BYE") throw fail(409, "This match has no result to clear", "แมตช์นี้ยังไม่มีผลให้ยกเลิก");
    needForce(slots, row.code, force);
    const doomed = await undo(slots, rows, row.code);
    await prisma.$transaction(async (tx) => {
      await writeSlots(tx, rows, slots);
      await syncFinish(tx, t, slots);
    });
    await deleteSeries(doomed);
    return slotView(tournamentId, row.id);
  });
}

/** A team says it is here. Late check-ins are kept but don't stop a walkover claim. */
export function checkIn(tournamentId: string, ref: string, body: unknown) {
  const input = z.object({ teamId: z.string().min(1) }).parse(body);
  return serial(async () => {
    const { row } = await liveContext(tournamentId, ref);
    if (row.status !== "READY") throw fail(409, "This match is not waiting to be played", row.status === "DONE" ? "แมตช์นี้มีผลแล้ว" : "แมตช์นี้ยังไม่พร้อม (รอทีมจากรอบก่อน)");
    if (input.teamId !== row.teamAId && input.teamId !== row.teamBId) throw fail(400, "That team is not in this match", "ทีมนี้ไม่ได้อยู่ในแมตช์นี้");
    const field = input.teamId === row.teamAId ? "checkInA" : "checkInB";
    if (!row[field]) await prisma.bracketMatch.update({ where: { id: row.id }, data: { [field]: new Date() } });
    return slotView(tournamentId, row.id);
  });
}

/** Sets the start time of one match, or of every match in a round. null clears it. */
export function schedule(tournamentId: string, body: unknown) {
  const input = z
    .object({
      match: z.string().optional(),
      stage: z.enum(["W", "L", "GF", "P3", "RR"]).optional(),
      round: z.coerce.number().int().min(1).optional(),
      scheduledAt: z.coerce.date().nullable(),
    })
    .refine((x) => x.match || (x.stage && x.round), { message: "Give a match, or a stage and round" })
    .parse(body);
  return serial(async () => {
    const t = await tournamentOr404(tournamentId);
    if (t.bracketStatus === "NONE") throw fail(409, "There is no bracket yet", "ยังไม่ได้จัดสาย");
    const rows = await loadRows(tournamentId);
    const targets = input.match ? [findRow(rows, input.match)] : rows.filter((r) => r.stage === input.stage && r.round === input.round);
    if (!targets.length) throw fail(404, "No matches in that round", "ไม่พบแมตช์ในรอบนี้");
    await prisma.bracketMatch.updateMany({ where: { id: { in: targets.map((r) => r.id) } }, data: { scheduledAt: input.scheduledAt } });
    return { updated: targets.map((r) => r.number) };
  });
}

/** A team disputes a result (or a walkover). Organizers see the flag until they decide. */
export function dispute(tournamentId: string, ref: string, body: unknown) {
  const input = z.object({ note: z.string().trim().max(500).default(""), resolved: z.boolean().default(false) }).parse(body);
  return serial(async () => {
    const { row } = await liveContext(tournamentId, ref, true);
    await prisma.bracketMatch.update({ where: { id: row.id }, data: input.resolved ? { disputed: false } : { disputed: true, disputeNote: input.note || row.disputeNote } });
    return slotView(tournamentId, row.id);
  });
}

// ---------- Views ----------

export function thaiTime(d: Date) {
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d) + " น.";
}

type TeamInfo = Awaited<ReturnType<typeof entriesView>>[number];

function shapeSlot(t: Tournament, r: BracketMatch, rows: BracketMatch[], teams: Map<string, TeamInfo>) {
  const slots = rows as unknown as Slot[];
  const feeder = (side: Side) => {
    const w = rows.find((x) => x.winnerTo === r.code && x.winnerSide === side);
    if (w) return `ผู้ชนะ M${w.number}`;
    const l = rows.find((x) => x.loserTo === r.code && x.loserSide === side);
    if (l) return `ผู้แพ้ M${l.number}`;
    if (r.code === "GF2") return side === "A" ? "ผู้ชนะสายบน" : "ผู้ชนะสายล่าง";
    return null;
  };
  const team = (id: string | null) => (id ? (teams.get(id) ?? null) : null);
  return {
    id: r.id,
    code: r.code,
    number: r.number,
    stage: r.stage,
    round: r.round,
    position: r.position,
    label: roundLabel(t.format as Format, r as unknown as Slot, slots),
    teamA: team(r.teamAId),
    teamB: team(r.teamBId),
    byeA: r.byeA,
    byeB: r.byeB,
    sourceA: feeder("A"),
    sourceB: feeder("B"),
    status: r.status,
    outcome: r.outcome,
    winnerId: r.winnerId,
    loserId: r.loserId,
    scoreA: r.scoreA,
    scoreB: r.scoreB,
    matchId: r.matchId,
    scheduledAt: r.scheduledAt,
    deadline: r.scheduledAt ? new Date(r.scheduledAt.getTime() + t.lateMinutes * 60_000) : null,
    checkInA: r.checkInA,
    checkInB: r.checkInB,
    disputed: r.disputed,
    disputeNote: r.disputeNote,
    winnerTo: r.winnerTo,
    loserTo: r.loserTo,
    completedAt: r.completedAt,
  };
}

export async function bracketView(tournamentId: string) {
  const t = await tournamentOr404(tournamentId);
  const [rows, entries] = await Promise.all([loadRows(tournamentId), entriesView(tournamentId)]);
  const teams = new Map(entries.map((e) => [e.id, e]));
  const lock = rosterLock(t, rows);
  const slots = rows.map(toSlot);
  return {
    tournamentId: t.id,
    name: t.name,
    format: t.format,
    status: t.bracketStatus,
    bestOf: t.bestOf,
    lateMinutes: t.lateMinutes,
    rosterMin: t.rosterMin,
    rosterMax: t.rosterMax,
    maxTeams: t.maxTeams,
    registrationOpen: t.registrationOpen,
    startDate: t.startDate,
    rosterLocked: lock.locked,
    rosterLockAt: lock.lockAt,
    teams: entries,
    positions: t.format && t.format !== "ROUND_ROBIN" && rows.length ? firstRoundPositions(slots) : null,
    matches: rows.map((r) => shapeSlot(t, r, rows, teams)),
    standings:
      t.format === "ROUND_ROBIN" && rows.length
        ? roundRobinTable(slots, entries.map((e) => e.id)).map((s, i) => ({ position: i + 1, ...s, team: teams.get(s.teamId) ?? null }))
        : null,
    placements: entries
      .filter((e) => e.placement !== null)
      .sort((a, b) => a.placement! - b.placement!)
      .map((e) => ({ placement: e.placement!, team: e })),
  };
}

export async function slotView(tournamentId: string, id: string) {
  const view = await bracketView(tournamentId);
  const match = view.matches.find((m) => m.id === id)!;
  return { ...match, tournament: { id: view.tournamentId, name: view.name, status: view.status, format: view.format, bestOf: view.bestOf } };
}

/** The bracket slot (if any) a recorded series belongs to. */
export async function slotOfMatch(matchId: string) {
  return prisma.bracketMatch.findUnique({ where: { matchId } });
}

export { getMatch };

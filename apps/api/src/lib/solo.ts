/**
 * SOLO tournaments: players sign up alone with the position they play and their in-game rank,
 * then the organizer draws them into teams that mix strong and weaker ranks and cover
 * Guard, Forward and Center (All Around fills any spot). The drawn teams then play a normal bracket.
 */
import { randomInt } from "node:crypto";
import type { Tournament } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { normaliseName } from "./validate.js";

/** The in-game ranks used by the Discord bot's player pool, lowest first. */
export const DEFAULT_SOLO_RANKS = ["ฟ้า", "ทอง", "แดง", "โซน"];
export const POSITIONS = ["GUARD", "FORWARD", "CENTER", "ALL"] as const;
export type Position = (typeof POSITIONS)[number];
const ROLES = ["GUARD", "FORWARD", "CENTER"] as const;

export function ranksOf(t: Pick<Tournament, "soloRanks">): string[] {
  try {
    const v = JSON.parse(t.soloRanks);
    if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")) return v;
  } catch {}
  return DEFAULT_SOLO_RANKS;
}

/** A tournament row as API clients see it: soloRanks as a list. */
export const withRanks = <T extends Pick<Tournament, "soloRanks">>(t: T) => ({ ...t, soloRanks: ranksOf(t) });

export const signupInput = z.object({
  playerId: z.string().trim().min(1),
  position: z.enum(POSITIONS),
  rank: z.string().trim().min(1).max(30),
});

const confirmInput = z.object({
  teams: z.array(z.array(z.string().min(1)).min(1)).min(1),
  /** Replace teams drawn earlier (only before any match is played). */
  replace: z.boolean().default(false),
});

async function soloTournament(id: string) {
  const t = await prisma.tournament.findUnique({ where: { id } });
  if (!t) throw notFound("Tournament");
  if (t.entryMode !== "SOLO") throw fail(409, "This tournament takes teams, not solo sign-ups", "ทัวร์นี้สมัครเป็นทีม ไม่ใช่ลงเดี่ยว");
  return t;
}

/** Everyone signed up, oldest first, with what the draw needs. */
export async function soloView(tournamentId: string) {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!t) throw notFound("Tournament");
  const [rows, teams] = await Promise.all([
    prisma.soloSignup.findMany({
      where: { tournamentId },
      orderBy: { createdAt: "asc" },
      include: { player: { select: { id: true, name: true, nickname: true, avatarUrl: true, uid: true, server: true, mmr: true } } },
    }),
    prisma.tournamentEntry.count({ where: { tournamentId } }),
  ]);
  return {
    entryMode: t.entryMode,
    teamSize: t.teamSize,
    ranks: ranksOf(t),
    registrationOpen: t.registrationOpen,
    /** Teams have been drawn: sign-ups are closed. */
    drawn: teams > 0,
    signups: rows.map((r) => ({ ...r.player, playerId: r.player.id, discordId: r.discordId, position: r.position, rank: r.rank, signedUpAt: r.createdAt })),
  };
}

/** A member signs up (or changes position, rank or character). One character per Discord account. */
export async function signUp(discordId: string, tournamentId: string, body: unknown) {
  const input = signupInput.parse(body);
  const t = await soloTournament(tournamentId);
  if (!t.registrationOpen) throw fail(409, "Registration is closed", "ปิดรับสมัครแล้ว");
  if (t.bracketStatus === "LIVE" || t.bracketStatus === "DONE") throw fail(409, "The tournament has started", "ทัวร์นาเมนต์เริ่มแข่งแล้ว");
  if (await prisma.tournamentEntry.count({ where: { tournamentId } })) throw fail(409, "Teams have been drawn", "ผู้จัดสุ่มทีมไปแล้ว ลงทะเบียนเพิ่มไม่ได้ (ติดต่อผู้จัด)");
  if (!ranksOf(t).includes(input.rank)) throw fail(400, "Unknown rank", "เลือกแรงค์จากรายการ");
  const player = await prisma.player.findUnique({ where: { id: input.playerId } });
  if (!player || player.discordId !== discordId) throw fail(403, "Not your character", "ตัวละครนี้ไม่ใช่ของคุณ");
  if (t.gameId && player.gameId && player.gameId !== t.gameId) throw fail(400, "This character plays another game", "ตัวละครนี้อยู่คนละเกมกับทัวร์นาเมนต์");
  await prisma.$transaction(async (tx) => {
    // Switching character replaces the earlier sign-up of this account.
    await tx.soloSignup.deleteMany({ where: { tournamentId, discordId, playerId: { not: player.id } } });
    const data = { position: input.position, rank: input.rank, discordId };
    await tx.soloSignup.upsert({
      where: { tournamentId_playerId: { tournamentId, playerId: player.id } },
      create: { tournamentId, playerId: player.id, ...data },
      update: data,
    });
    if (t.gameId && !player.gameId) await tx.player.update({ where: { id: player.id }, data: { gameId: t.gameId } });
  });
  return soloView(tournamentId);
}

/** A member takes their name off the list (before the draw). */
export async function leaveSolo(discordId: string, tournamentId: string) {
  const t = await soloTournament(tournamentId);
  if (await prisma.tournamentEntry.count({ where: { tournamentId: t.id } })) throw fail(409, "Teams have been drawn", "ผู้จัดสุ่มทีมไปแล้ว ถอนชื่อไม่ได้ (ติดต่อผู้จัด)");
  await prisma.soloSignup.deleteMany({ where: { tournamentId, discordId } });
  return soloView(tournamentId);
}

/** An organizer removes one sign-up. */
export async function removeSignup(tournamentId: string, playerId: string) {
  await soloTournament(tournamentId);
  await prisma.soloSignup.deleteMany({ where: { tournamentId, playerId } });
  return soloView(tournamentId);
}

// ---------- The draw ----------

export interface DrawPlayer {
  id: string;
  /** Index in the rank list: higher is stronger. */
  rank: number;
  mmr: number;
  position: Position;
}

/** How many of Guard / Forward / Center a team is missing that its All Around players can't fill. */
export function positionGap(team: DrawPlayer[]) {
  const needed = Math.min(team.length, ROLES.length);
  const covered = ROLES.filter((r) => team.some((p) => p.position === r)).length;
  const flexible = team.filter((p) => p.position === "ALL").length;
  return Math.max(0, needed - covered - flexible);
}

function cost(teams: DrawPlayer[][]) {
  const ranks = teams.map((t) => t.reduce((n, p) => n + p.rank, 0));
  const mmrs = teams.map((t) => t.reduce((n, p) => n + p.mmr, 0));
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const mr = mean(ranks);
  const mm = mean(mmrs);
  return (
    1000 * teams.reduce((n, t) => n + positionGap(t), 0) +
    10 * ranks.reduce((n, r) => n + (r - mr) ** 2, 0) +
    mmrs.reduce((n, m) => n + (m - mm) ** 2, 0) / 2500
  );
}

function shuffle<T>(list: T[], rand: (n: number) => number) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Splits players into teams of `size`: first every team covers the three positions where it can,
 * then rank totals (and MMR) are as even as possible. Random restarts make each draw different.
 */
export function balanceTeams(players: DrawPlayer[], size: number, rand: (n: number) => number = randomInt) {
  const count = Math.floor(players.length / size);
  if (count < 1) return [];
  let best: DrawPlayer[][] = [];
  let bestCost = Infinity;
  for (let restart = 0; restart < 24; restart++) {
    const order = shuffle(players, rand);
    const teams = Array.from({ length: count }, (_, i) => order.slice(i * size, (i + 1) * size));
    let current = cost(teams);
    // Swap players between teams while it helps.
    for (let improved = true; improved; ) {
      improved = false;
      for (let a = 0; a < count; a++) {
        for (let b = a + 1; b < count; b++) {
          for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
              [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]];
              const next = cost(teams);
              if (next < current - 1e-9) {
                current = next;
                improved = true;
              } else {
                [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]];
              }
            }
          }
        }
      }
    }
    if (current < bestCost - 1e-9 || (Math.abs(current - bestCost) < 1e-9 && rand(2) === 0)) {
      best = teams.map((t) => [...t]);
      bestCost = current;
    }
  }
  // Strongest player first in each team; strongest team first.
  return best
    .map((t) => [...t].sort((x, y) => y.rank - x.rank || y.mmr - x.mmr))
    .sort((x, y) => y.reduce((n, p) => n + p.rank, 0) - x.reduce((n, p) => n + p.rank, 0));
}

/** Proposes teams from the sign-ups. Nothing is saved: send the teams to confirmTeams. */
export async function drawTeams(tournamentId: string) {
  const t = await soloTournament(tournamentId);
  const view = await soloView(tournamentId);
  const ranks = ranksOf(t);
  if (view.signups.length < t.teamSize * 2) {
    throw fail(409, "Not enough players for two teams", `ต้องมีผู้ลงทะเบียนอย่างน้อย ${t.teamSize * 2} คน (ตอนนี้ ${view.signups.length} คน)`);
  }
  const playing = view.signups.length - (view.signups.length % t.teamSize);
  // The latest sign-ups are reserves when the numbers don't divide evenly.
  const pool = view.signups.slice(0, playing);
  const reserves = view.signups.slice(playing);
  const byId = new Map(view.signups.map((s) => [s.playerId, s]));
  const teams = balanceTeams(
    pool.map((s) => ({ id: s.playerId, rank: Math.max(0, ranks.indexOf(s.rank)), mmr: s.mmr, position: s.position as Position })),
    t.teamSize,
  );
  return {
    teams: teams.map((team) => ({
      players: team.map((p) => byId.get(p.id)!),
      rankTotal: team.reduce((n, p) => n + p.rank + 1, 0),
      mmrAverage: Math.round(team.reduce((n, p) => n + p.mmr, 0) / team.length),
      positionsOk: positionGap(team) === 0,
    })),
    reserves,
  };
}

/** Saves drawn teams: each becomes a team registered in the tournament with its roster. */
export async function confirmTeams(tournamentId: string, body: unknown) {
  const input = confirmInput.parse(body);
  const t = await soloTournament(tournamentId);
  if (t.bracketStatus === "LIVE" || t.bracketStatus === "DONE") throw fail(409, "The tournament has started", "เริ่มแข่งแล้ว เปลี่ยนทีมไม่ได้ (ต้องรีเซ็ตสายก่อน)");
  const signups = await prisma.soloSignup.findMany({ where: { tournamentId }, include: { player: true }, orderBy: { createdAt: "asc" } });
  const byId = new Map(signups.map((s) => [s.playerId, s]));
  const all = input.teams.flat();
  if (new Set(all).size !== all.length) throw fail(400, "A player is in two teams", "มีผู้เล่นอยู่สองทีม");
  if (input.teams.some((team) => team.length !== t.teamSize)) throw fail(400, `Every team needs ${t.teamSize} players`, `ทุกทีมต้องมี ${t.teamSize} คน`);
  if (all.some((id) => !byId.has(id))) throw fail(400, "A player has not signed up", "มีผู้เล่นที่ไม่ได้ลงทะเบียน");
  if (input.teams.length < 2) throw fail(400, "At least two teams are needed", "ต้องมีอย่างน้อย 2 ทีม");

  await prisma.$transaction(async (tx) => {
    const existing = await tx.tournamentEntry.findMany({ where: { tournamentId } });
    if (existing.length) {
      if (!input.replace) throw fail(409, "Teams were drawn already", "สุ่มทีมไว้แล้ว ต้องการแทนที่ทีมเดิมไหม", { needsReplace: true });
      if (await tx.match.count({ where: { tournamentId } })) throw fail(409, "Matches have been played", "มีผลการแข่งแล้ว เปลี่ยนทีมไม่ได้");
      await tx.bracketMatch.deleteMany({ where: { tournamentId } });
      await tx.tournamentEntry.deleteMany({ where: { tournamentId } });
      // Teams made only for this draw go too.
      for (const e of existing) {
        const used = (await tx.tournamentEntry.count({ where: { teamId: e.teamId } })) + (await tx.player.count({ where: { teamId: e.teamId } })) + (await tx.match.count({ where: { OR: [{ teamAId: e.teamId }, { teamBId: e.teamId }] } }));
        if (!used) await tx.team.delete({ where: { id: e.teamId } });
      }
      await tx.tournament.update({ where: { id: tournamentId }, data: { bracketStatus: "NONE" } });
    }
    const taken = new Set((await tx.team.findMany({ select: { name: true } })).map((x) => normaliseName(x.name)));
    for (const [i, team] of input.teams.entries()) {
      let name = `${t.name} ทีม ${i + 1}`;
      for (let n = 2; taken.has(normaliseName(name)); n++) name = `${t.name} ทีม ${i + 1} (${n})`;
      taken.add(normaliseName(name));
      const created = await tx.team.create({ data: { name, gameId: t.gameId } });
      const rows = team.map((id) => byId.get(id)!);
      const entry = await tx.tournamentEntry.create({
        data: { tournamentId, teamId: created.id, captainDiscordId: rows.find((r) => r.discordId)?.discordId ?? null },
      });
      for (const [order, r] of rows.entries()) {
        await tx.rosterPlayer.create({ data: { entryId: entry.id, playerId: r.playerId, discordId: r.discordId, uid: r.player.uid, server: r.player.server, order } });
      }
    }
  });
  return soloView(tournamentId);
}

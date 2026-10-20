/**
 * The prediction game (ทายผล): free coins, Twitch style. Everyone with a Discord account gets coins for
 * logging in each day and for watching while a tournament is live, and stakes them on who wins a bracket
 * match or the whole tournament. Winners share the losers' coins in proportion to their stake.
 *
 * Coins are never sold, bought or exchanged for money: they only rank predictors. Prizes (shop codes,
 * gear) go to the top of a leaderboard and are handed out by organizers (rewards.ts).
 *
 * Markets follow the bracket: syncPredictions() opens one per match that has both teams and settles,
 * refunds or reopens it whenever the bracket changes, so an overturned result moves the coins back.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { bestOfFor } from "./competition.js";
import type { Slot } from "./bracket.js";

type Tx = Prisma.TransactionClient;

export const COINS = {
  /** Given once, the first time someone plays. */
  welcome: 100,
  /** Each Thai day, plus streakStep for every day in a row (up to streakMax extra days). */
  daily: 20,
  streakStep: 2,
  streakMax: 5,
  /** For watching while a tournament is live: every watchEveryMinutes, at most watchPerDay times a day. */
  watch: 2,
  watchEveryMinutes: 5,
  watchPerDay: 10,
};

const BKK_MS = 7 * 3600_000;
/** The Thai calendar day (yyyy-mm-dd) of a moment. */
export const thaiDay = (d = new Date()) => new Date(d.getTime() + BKK_MS).toISOString().slice(0, 10);
const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);

// Everything that moves coins runs one at a time, so two clicks can never spend the same coins twice.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

const noControl = /^[^\u0000-\u001f\u007f]*$/;
/** Who is playing: the Discord name and avatar, kept fresh for the leaderboards. */
export const profileInput = z.object({
  name: z.string().trim().min(1).max(100).regex(noControl).optional(),
  avatarUrl: z.string().trim().url().max(500).nullish(),
});

const parseIds = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

async function addCoins(tx: Tx, discordId: string, amount: number, kind: string, extra: { marketId?: string; note?: string } = {}) {
  if (!amount) return;
  await tx.predictor.update({ where: { discordId }, data: { coins: { increment: amount } } });
  await tx.coinTx.create({ data: { discordId, amount, kind, marketId: extra.marketId ?? null, note: extra.note ?? null } });
}

/** The predictor's wallet, made (with the welcome coins) the first time they play. */
async function predictor(tx: Tx, discordId: string, profile: z.infer<typeof profileInput>) {
  const found = await tx.predictor.findUnique({ where: { discordId } });
  if (found) {
    const data = { ...(profile.name && profile.name !== found.name ? { name: profile.name } : {}), ...(profile.avatarUrl !== undefined && profile.avatarUrl !== found.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}) };
    return Object.keys(data).length ? tx.predictor.update({ where: { discordId }, data }) : found;
  }
  await tx.predictor.create({ data: { discordId, name: profile.name ?? "ผู้เล่น", avatarUrl: profile.avatarUrl ?? null } });
  await addCoins(tx, discordId, COINS.welcome, "WELCOME", { note: "เหรียญต้อนรับ" });
  return tx.predictor.findUniqueOrThrow({ where: { discordId } });
}

/** How many coins today's login gives after `streak` days in a row (counting today). */
export const dailyAmount = (streak: number) => COINS.daily + Math.min(Math.max(streak - 1, 0), COINS.streakMax) * COINS.streakStep;

/** The daily coins, once per Thai day. Coming back the next day keeps the streak going. */
export function claimDaily(discordId: string, body: unknown, now = new Date()) {
  const profile = profileInput.parse(body ?? {});
  return serial(() =>
    prisma.$transaction(async (tx) => {
      const welcome = (await tx.predictor.count({ where: { discordId } })) ? 0 : COINS.welcome;
      const p = await predictor(tx, discordId, profile);
      const today = thaiDay(now);
      if (p.lastDaily === today) throw fail(409, "Already claimed today", "วันนี้รับเหรียญไปแล้ว พรุ่งนี้มารับใหม่นะ", { coins: p.coins, streak: p.streak });
      const streak = p.lastDaily === dayBefore(today) ? p.streak + 1 : 1;
      const amount = dailyAmount(streak);
      await tx.predictor.update({ where: { discordId }, data: { streak, lastDaily: today } });
      await addCoins(tx, discordId, amount, "DAILY", { note: `เข้าเว็บต่อเนื่อง ${streak} วัน` });
      return { amount, welcome, streak, coins: p.coins + amount };
    }),
  );
}

/**
 * Coins for watching: the website asks every few minutes while the page is open. They are only given while
 * a tournament is being played, at most every watchEveryMinutes and watchPerDay times a day.
 */
export function watchCoins(discordId: string, body: unknown, now = new Date()) {
  const profile = profileInput.parse(body ?? {});
  return serial(() =>
    prisma.$transaction(async (tx) => {
      const live = await tx.tournament.count({ where: { bracketStatus: "LIVE" } });
      const p = await predictor(tx, discordId, profile);
      const today = thaiDay(now);
      const count = p.watchDay === today ? p.watchToday : 0;
      const tooSoon = p.lastWatch && now.getTime() - p.lastWatch.getTime() < (COINS.watchEveryMinutes * 60 - 20) * 1000;
      if (!live || tooSoon || count >= COINS.watchPerDay) return { amount: 0, coins: p.coins, live: live > 0, watchedToday: count, max: COINS.watchPerDay };
      await tx.predictor.update({ where: { discordId }, data: { watchDay: today, watchToday: count + 1, lastWatch: now } });
      await addCoins(tx, discordId, COINS.watch, "WATCH", { note: "ดูการแข่งสด" });
      return { amount: COINS.watch, coins: p.coins + COINS.watch, live: true, watchedToday: count + 1, max: COINS.watchPerDay };
    }),
  );
}

// ---------- Markets ----------

type Outcome = { kind: "none" } | { kind: "refund" } | { kind: "winner"; teamId: string };

/**
 * Brings every bet of a market to what its outcome pays: nothing yet, the stake back (refund), or the
 * winners' share of the pool. Only the difference from what was already paid moves, so it can run again
 * and again, and a reopened or overturned result takes the coins back.
 */
async function applyOutcome(tx: Tx, marketId: string, outcome: Outcome) {
  const bets = await tx.bet.findMany({ where: { marketId } });
  const winners = outcome.kind === "winner" ? bets.filter((b) => b.teamId === outcome.teamId) : [];
  const pool = bets.reduce((n, b) => n + b.amount, 0);
  const winPool = winners.reduce((n, b) => n + b.amount, 0);
  // Nobody picked the winner: everyone gets their coins back.
  const refundAll = outcome.kind === "refund" || (outcome.kind === "winner" && winPool === 0);
  for (const b of bets) {
    const target = outcome.kind === "none" ? null : refundAll ? b.amount : b.teamId === (outcome as { teamId: string }).teamId ? b.amount + Math.floor(((pool - winPool) * b.amount) / winPool) : 0;
    const diff = (target ?? 0) - (b.payout ?? 0);
    if (diff) await addCoins(tx, b.discordId, diff, diff > 0 ? (refundAll ? "REFUND" : "PAYOUT") : "ADJUST", { marketId, note: diff < 0 ? "ผลการแข่งถูกแก้ไข" : undefined });
    if (target !== b.payout) await tx.bet.update({ where: { id: b.id }, data: { payout: target } });
  }
  const status = outcome.kind === "none" ? undefined : refundAll ? "REFUNDED" : "SETTLED";
  const m = await tx.market.findUniqueOrThrow({ where: { id: marketId } });
  const data =
    outcome.kind === "none"
      ? m.status === "SETTLED" || m.status === "REFUNDED"
        ? { status: "OPEN", winnerTeamId: null, settledAt: null }
        : null
      : { status: status!, winnerTeamId: outcome.kind === "winner" ? outcome.teamId : null, settledAt: m.settledAt ?? new Date() };
  if (data) await tx.market.update({ where: { id: marketId }, data });
}

/** Gives every stake back and forgets the picks: the teams of the match changed. */
async function clearBets(tx: Tx, marketId: string) {
  await applyOutcome(tx, marketId, { kind: "none" });
  const bets = await tx.bet.findMany({ where: { marketId } });
  for (const b of bets) await addCoins(tx, b.discordId, b.amount, "REFUND", { marketId, note: "ทีมในแมตช์เปลี่ยน" });
  await tx.bet.deleteMany({ where: { marketId } });
}

const sameTeams = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

async function syncTournament(tx: Tx, tournamentId: string) {
  const t = await tx.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, format: true, bestOf: true, finalBestOf: true, bracketStatus: true, entries: { select: { teamId: true, placement: true } }, bracketMatches: true, markets: true },
  });
  if (!t) return;
  const markets = new Map(t.markets.map((m) => [m.key, m]));
  const live = new Set<string>();
  /** The market of a match (or of one game in it), made or brought up to date with its teams and start time. */
  const ensure = async (kind: "MATCH" | "GAME", key: string, teams: string[], locksAt: Date | null) => {
    live.add(key);
    let m = markets.get(key);
    if (!m) return tx.market.create({ data: { tournamentId, kind, key, teamIds: JSON.stringify(teams), locksAt } });
    if (!sameTeams(parseIds(m.teamIds), teams)) {
      await clearBets(tx, m.id);
      m = await tx.market.update({ where: { id: m.id }, data: { teamIds: JSON.stringify(teams), status: "OPEN", winnerTeamId: null, settledAt: null } });
    }
    if ((m.locksAt?.getTime() ?? null) !== (locksAt?.getTime() ?? null)) m = await tx.market.update({ where: { id: m.id }, data: { locksAt } });
    return m;
  };
  for (const slot of t.bracketMatches) {
    if (!slot.teamAId || !slot.teamBId) continue;
    const teams = [slot.teamAId, slot.teamBId];
    const m = await ensure("MATCH", slot.code, teams, slot.scheduledAt);
    const played = slot.status === "DONE" && slot.outcome === "PLAYED";
    const outcome: Outcome = slot.status !== "DONE" ? { kind: "none" } : played && slot.winnerId && teams.includes(slot.winnerId) ? { kind: "winner", teamId: slot.winnerId } : { kind: "refund" };
    await applyOutcome(tx, m.id, outcome);

    // Each game of a series (BO3 = 3 games, BO5 = 5) is predicted on its own. Games that were not
    // played (a 3-0 in a BO5) or a series recorded without game scores give the coins back.
    const bestOf = bestOfFor(t, slot as Pick<Slot, "stage" | "round">, t.bracketMatches as Pick<Slot, "stage" | "round">[]);
    if (bestOf < 3) continue;
    const match = played && slot.matchId ? await tx.match.findUnique({ where: { id: slot.matchId }, select: { teamAId: true, teamBId: true, games: { select: { number: true, scoreA: true, scoreB: true } } } }) : null;
    for (let n = 1; n <= bestOf; n++) {
      const g = await ensure("GAME", `${slot.code}#${n}`, teams, slot.scheduledAt);
      const game = match?.games.find((x) => x.number === n);
      const winner = game && game.scoreA !== game.scoreB ? (game.scoreA > game.scoreB ? match!.teamAId : match!.teamBId) : null;
      await applyOutcome(tx, g.id, slot.status !== "DONE" ? { kind: "none" } : winner && teams.includes(winner) ? { kind: "winner", teamId: winner } : { kind: "refund" });
    }
  }
  // Matches and games gone from the bracket (reset, a team moved out, fewer games): everyone gets their coins back.
  for (const m of t.markets) if (m.kind !== "CHAMPION" && !live.has(m.key) && m.status !== "REFUNDED") await applyOutcome(tx, m.id, { kind: "refund" });

  // The champion: open while teams sign up and the bracket is drafted, closed once play starts.
  const teams = t.entries.map((e) => e.teamId);
  let champ = markets.get("CHAMPION");
  if (t.format && teams.length >= 2) {
    const first = t.bracketMatches.map((s) => s.scheduledAt?.getTime()).filter((x): x is number => x !== undefined).sort((a, b) => a - b)[0];
    const locksAt = first !== undefined ? new Date(first) : null;
    if (!champ) champ = await tx.market.create({ data: { tournamentId, kind: "CHAMPION", key: "CHAMPION", teamIds: JSON.stringify(teams), locksAt } });
    else {
      const was = parseIds(champ.teamIds);
      if (!sameTeams(was, teams)) {
        // Picks of a team that left get their coins back; the rest stay.
        const gone = await tx.bet.findMany({ where: { marketId: champ.id, teamId: { notIn: teams } } });
        for (const b of gone) await addCoins(tx, b.discordId, b.amount - (b.payout ?? 0), "REFUND", { marketId: champ.id, note: "ทีมที่ทายถอนตัว" });
        await tx.bet.deleteMany({ where: { id: { in: gone.map((b) => b.id) } } });
        champ = await tx.market.update({ where: { id: champ.id }, data: { teamIds: JSON.stringify(teams) } });
      }
      if ((champ.locksAt?.getTime() ?? null) !== (locksAt?.getTime() ?? null)) champ = await tx.market.update({ where: { id: champ.id }, data: { locksAt } });
    }
    const winner = t.bracketStatus === "DONE" ? t.entries.find((e) => e.placement === 1)?.teamId : undefined;
    await applyOutcome(tx, champ.id, t.bracketStatus !== "DONE" ? { kind: "none" } : winner ? { kind: "winner", teamId: winner } : { kind: "refund" });
  } else if (champ && champ.status !== "REFUNDED") await applyOutcome(tx, champ.id, { kind: "refund" });
}

/** Opens, settles, refunds or reopens a tournament's markets to match its bracket. Safe to call any time. */
export function syncPredictions(tournamentId: string) {
  return serial(() => prisma.$transaction((tx) => syncTournament(tx, tournamentId), { timeout: 30_000 }));
}

/** Can people still pick in this market right now? */
export function marketOpen(m: { kind: string; status: string; locksAt: Date | null }, t: { bracketStatus: string }, now = new Date()) {
  if (m.status !== "OPEN") return false;
  if (m.locksAt && now >= m.locksAt) return false;
  if (m.kind === "CHAMPION") return t.bracketStatus === "NONE" || t.bracketStatus === "DRAFT";
  // A match opens once it has a start time, so nobody picks while watching it.
  return m.locksAt !== null;
}

/** Discord accounts that play in the tournament for these teams: they may not predict their own games. */
async function playersOf(tx: Tx, tournamentId: string, teamIds: string[]) {
  const entries = await tx.tournamentEntry.findMany({
    where: { tournamentId, teamId: { in: teamIds } },
    select: { captainDiscordId: true, memberDiscordIds: true, roster: { select: { discordId: true, player: { select: { discordId: true } } } } },
  });
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.captainDiscordId) ids.add(e.captainDiscordId);
    for (const x of parseIds(e.memberDiscordIds)) ids.add(x);
    for (const r of e.roster) {
      if (r.discordId) ids.add(r.discordId);
      if (r.player.discordId) ids.add(r.player.discordId);
    }
  }
  return ids;
}

export const betInput = profileInput.extend({
  marketId: z.string().trim().min(1).max(40),
  teamId: z.string().trim().min(1).max(40),
  amount: z.coerce.number().int().min(1).max(1_000_000),
});

const BET_PROBLEMS: Record<string, string> = { marketId: "เลือกแมตช์ที่จะทาย", teamId: "เลือกทีมที่จะทาย", amount: "ใส่จำนวนเหรียญเป็นตัวเลขตั้งแต่ 1 ขึ้นไป" };

/** Places or changes a pick (team and coins) until the market locks. */
export async function placeBet(discordId: string, body: unknown, now = new Date()) {
  const parsed = betInput.safeParse(body);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    throw fail(400, "Validation failed", BET_PROBLEMS[field] ?? "ข้อมูลไม่ถูกต้อง", { field });
  }
  const input = parsed.data;
  const market = await prisma.market.findUnique({ where: { id: input.marketId }, select: { tournamentId: true } });
  if (!market) throw notFound("Market");
  await syncPredictions(market.tournamentId);
  return serial(() =>
    prisma.$transaction(async (tx) => {
      const m = await tx.market.findUniqueOrThrow({ where: { id: input.marketId }, include: { tournament: { select: { bracketStatus: true } } } });
      if (!marketOpen(m, m.tournament, now)) {
        const why = m.kind !== "CHAMPION" && !m.locksAt && m.status === "OPEN" ? "แมตช์นี้ยังไม่ได้ตั้งเวลาแข่ง ยังทายไม่ได้" : "ปิดทายแมตช์นี้แล้ว";
        throw fail(409, "Predictions are closed", why);
      }
      const teams = parseIds(m.teamIds);
      if (!teams.includes(input.teamId)) throw fail(400, "Pick one of the teams", "เลือกทีมที่อยู่ในแมตช์นี้", { field: "teamId" });
      if ((await playersOf(tx, m.tournamentId, teams)).has(discordId)) {
        throw fail(403, "Players cannot predict their own games", m.kind === "CHAMPION" ? "คุณลงแข่งรายการนี้ ทายแชมป์ไม่ได้" : "คุณลงแข่งแมตช์นี้ ทายแมตช์ของตัวเองไม่ได้");
      }
      const p = await predictor(tx, discordId, input);
      const old = await tx.bet.findUnique({ where: { marketId_discordId: { marketId: m.id, discordId } } });
      const spendable = p.coins + (old?.amount ?? 0);
      if (input.amount > spendable) throw fail(400, "Not enough coins", `เหรียญไม่พอ มี ${spendable} เหรียญ`, { field: "amount", coins: spendable });
      if (old) await addCoins(tx, discordId, old.amount, "BET", { marketId: m.id, note: "เปลี่ยนคำทาย คืนเหรียญเดิม" });
      await addCoins(tx, discordId, -input.amount, "BET", { marketId: m.id });
      const bet = await tx.bet.upsert({
        where: { marketId_discordId: { marketId: m.id, discordId } },
        create: { marketId: m.id, discordId, teamId: input.teamId, amount: input.amount },
        update: { teamId: input.teamId, amount: input.amount },
      });
      return { bet, coins: spendable - input.amount };
    }),
  );
}

/** Takes a pick back (coins returned) before the market locks. */
export async function cancelBet(discordId: string, marketId: string, now = new Date()) {
  return serial(() =>
    prisma.$transaction(async (tx) => {
      const m = await tx.market.findUnique({ where: { id: marketId }, include: { tournament: { select: { bracketStatus: true } } } });
      if (!m) throw notFound("Market");
      if (!marketOpen(m, m.tournament, now)) throw fail(409, "Predictions are closed", "ปิดทายแล้ว ยกเลิกไม่ได้");
      const bet = await tx.bet.findUnique({ where: { marketId_discordId: { marketId, discordId } } });
      if (!bet) throw fail(404, "No prediction", "คุณยังไม่ได้ทายแมตช์นี้");
      await addCoins(tx, discordId, bet.amount, "BET", { marketId, note: "ยกเลิกคำทาย" });
      await tx.bet.delete({ where: { id: bet.id } });
    }),
  );
}

/** Organizers close a market early, or open it again. */
export async function setMarketStatus(marketId: string, body: unknown) {
  const { status } = z.object({ status: z.enum(["OPEN", "CLOSED"]) }).parse(body);
  const m = await prisma.market.findUnique({ where: { id: marketId } });
  if (!m) throw notFound("Market");
  if (m.status === "SETTLED" || m.status === "REFUNDED") throw fail(409, "The market is settled", "แมตช์นี้มีผลแล้ว");
  return prisma.market.update({ where: { id: marketId }, data: { status } });
}

/**
 * A tournament's markets for the website and Discord: the teams, how the coins are split (counts and
 * percentages only, never who picked what) and, once settled, the best payouts.
 * With discordId, each market also carries that account's own pick.
 */
export async function tournamentMarkets(tournamentId: string, discordId?: string | null, now = new Date()) {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true, name: true, bracketStatus: true } });
  if (!t) throw notFound("Tournament");
  await syncPredictions(tournamentId);
  const [markets, slots] = await Promise.all([
    prisma.market.findMany({ where: { tournamentId }, include: { bets: { include: { predictor: { select: { name: true, avatarUrl: true } } } } } }),
    prisma.bracketMatch.findMany({ where: { tournamentId }, select: { code: true, number: true, stage: true, round: true, scheduledAt: true, status: true, scoreA: true, scoreB: true } }),
  ]);
  const teamIds = [...new Set(markets.flatMap((m) => parseIds(m.teamIds)))];
  const teams = new Map((await prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true, tag: true, logoUrl: true } })).map((x) => [x.id, x]));
  const slotByCode = new Map(slots.map((s) => [s.code, s]));
  const rows = markets
    .filter((m) => m.status !== "REFUNDED" || m.bets.length)
    .map((m) => {
      const pool = m.bets.reduce((n, b) => n + b.amount, 0);
      const [code, game] = m.kind === "GAME" ? m.key.split("#") : [m.key, null];
      const slot = m.kind !== "CHAMPION" ? slotByCode.get(code) : undefined;
      const options = parseIds(m.teamIds).map((id) => {
        const on = m.bets.filter((b) => b.teamId === id);
        const coins = on.reduce((n, b) => n + b.amount, 0);
        return { team: teams.get(id) ?? { id, name: "ทีม", tag: null, logoUrl: null }, coins, people: on.length, percent: pool ? Math.round((coins / pool) * 100) : 0 };
      });
      const mine = discordId ? m.bets.find((b) => b.discordId === discordId) : undefined;
      const settled = m.status === "SETTLED";
      return {
        id: m.id,
        kind: m.kind,
        key: m.key,
        /** The game in the series (1..BO) for a per-game market; the series market itself has none. */
        game: game ? Number(game) : null,
        match: m.kind === "GAME" ? code : null,
        number: slot?.number ?? null,
        stage: slot?.stage ?? null,
        round: slot?.round ?? null,
        status: m.status,
        open: marketOpen(m, t, now),
        locksAt: m.locksAt,
        winnerTeamId: m.winnerTeamId,
        score: m.kind === "MATCH" && slot && slot.status === "DONE" ? { a: slot.scoreA, b: slot.scoreB } : null,
        pool,
        people: m.bets.length,
        options,
        mine: mine ? { teamId: mine.teamId, amount: mine.amount, payout: mine.payout } : null,
        topWinners: settled
          ? m.bets
              .filter((b) => (b.payout ?? 0) > b.amount)
              .sort((a, b) => (b.payout ?? 0) - b.amount - ((a.payout ?? 0) - a.amount))
              .slice(0, 5)
              .map((b) => ({ discordId: b.discordId, name: b.predictor.name, avatarUrl: b.predictor.avatarUrl, won: (b.payout ?? 0) - b.amount }))
          : [],
      };
    })
    .sort((a, b) => Number(b.kind === "CHAMPION") - Number(a.kind === "CHAMPION") || (a.number ?? 0) - (b.number ?? 0) || (a.game ?? 0) - (b.game ?? 0));
  return { tournament: t, markets: rows };
}

/**
 * The best predictors. For a tournament or a season: coins won minus coins staked on settled markets.
 * Overall: coins in hand.
 */
export async function leaderboard(scope: { tournamentId?: string; seasonId?: string }, limit = 50) {
  if (!scope.tournamentId && !scope.seasonId) {
    const rows = await prisma.predictor.findMany({ orderBy: [{ coins: "desc" }, { createdAt: "asc" }], take: limit, select: { discordId: true, name: true, avatarUrl: true, coins: true } });
    return rows.map((r, i) => ({ rank: i + 1, ...r, net: null as number | null, correct: null as number | null, picks: null as number | null }));
  }
  const where = scope.tournamentId ? { tournamentId: scope.tournamentId } : { tournament: { seasonId: scope.seasonId } };
  const bets = await prisma.bet.findMany({
    where: { market: { ...where, status: "SETTLED" } },
    select: { discordId: true, amount: true, payout: true, createdAt: true, predictor: { select: { name: true, avatarUrl: true, coins: true } } },
  });
  const by = new Map<string, { discordId: string; name: string; avatarUrl: string | null; coins: number; net: number; correct: number; picks: number; first: number }>();
  for (const b of bets) {
    const row = by.get(b.discordId) ?? { discordId: b.discordId, name: b.predictor.name, avatarUrl: b.predictor.avatarUrl, coins: b.predictor.coins, net: 0, correct: 0, picks: 0, first: b.createdAt.getTime() };
    row.net += (b.payout ?? 0) - b.amount;
    row.picks++;
    if ((b.payout ?? 0) > b.amount) row.correct++;
    row.first = Math.min(row.first, b.createdAt.getTime());
    by.set(b.discordId, row);
  }
  return [...by.values()]
    .sort((a, b) => b.net - a.net || b.correct - a.correct || a.first - b.first)
    .slice(0, limit)
    .map(({ first, ...r }, i) => ({ rank: i + 1, ...r }));
}

/** A member's own wallet: coins, today's daily coins, recent picks and their prizes (with codes). */
export async function wallet(discordId: string, now = new Date()) {
  const p = await prisma.predictor.findUnique({ where: { discordId } });
  const today = thaiDay(now);
  const streakNow = p?.lastDaily === today || p?.lastDaily === dayBefore(today) ? (p?.streak ?? 0) : 0;
  const [bets, rewards] = await Promise.all([
    prisma.bet.findMany({
      where: { discordId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { market: { select: { id: true, kind: true, key: true, status: true, winnerTeamId: true, tournament: { select: { id: true, name: true } } } } },
    }),
    prisma.reward.findMany({ where: { discordId }, orderBy: { createdAt: "desc" }, include: { code: { select: { code: true, label: true } } } }),
  ]);
  const teams = new Map((await prisma.team.findMany({ where: { id: { in: bets.map((b) => b.teamId) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  const slots = await prisma.bracketMatch.findMany({ where: { tournamentId: { in: [...new Set(bets.map((b) => b.market.tournament.id))] } }, select: { tournamentId: true, code: true, number: true } });
  const numberOf = new Map(slots.map((s) => [`${s.tournamentId}/${s.code}`, s.number]));
  /** "แชมป์", "คู่ที่ 3" or "คู่ที่ 3 · เกม 2". */
  const label = (m: (typeof bets)[number]["market"]) => {
    if (m.kind === "CHAMPION") return "แชมป์";
    const [code, game] = m.key.split("#");
    return `คู่ที่ ${numberOf.get(`${m.tournament.id}/${code}`) ?? code}${game ? ` · เกม ${game}` : ""}`;
  };
  return {
    discordId,
    name: p?.name ?? null,
    coins: p?.coins ?? 0,
    joined: Boolean(p),
    streak: streakNow,
    dailyClaimed: p?.lastDaily === today,
    nextDaily: dailyAmount(streakNow + 1),
    welcome: p ? 0 : COINS.welcome,
    watchedToday: p?.watchDay === today ? p.watchToday : 0,
    rules: COINS,
    bets: bets.map((b) => ({ ...b, market: { ...b.market, label: label(b.market) }, teamName: teams.get(b.teamId) ?? "ทีม" })),
    rewards: rewards.map(({ code, ...r }) => ({ ...r, code: code?.code ?? null, codeLabel: code?.label ?? null })),
  };
}

/** Before a tournament is deleted: every stake goes back, and won coins are taken back, as if it never ran. */
export function refundTournament(tournamentId: string) {
  return serial(() =>
    prisma.$transaction(async (tx) => {
      const markets = await tx.market.findMany({ where: { tournamentId }, select: { id: true } });
      for (const m of markets) await applyOutcome(tx, m.id, { kind: "refund" });
    }),
  );
}

/**
 * Tournaments to predict: the ones being signed up for or played (with at least two teams), and the ones
 * that ended in the last two weeks with picks to look back on. Open markets are counted for each.
 */
export async function predictionTournaments(now = new Date()) {
  const recent = new Date(now.getTime() - 14 * 86400_000);
  const list = await prisma.tournament.findMany({
    where: {
      format: { not: null },
      OR: [{ bracketStatus: { in: ["NONE", "DRAFT", "LIVE"] }, status: { not: "COMPLETED" } }, { bracketStatus: "DONE", updatedAt: { gte: recent }, markets: { some: {} } }],
    },
    orderBy: { startDate: "asc" },
    take: 30,
    select: { id: true, name: true, bracketStatus: true, special: true, startDate: true, season: { select: { id: true, name: true } }, _count: { select: { entries: true } } },
  });
  const shown = list.filter((t) => t._count.entries >= 2);
  for (const t of shown) if (t.bracketStatus !== "DONE") await syncPredictions(t.id);
  const markets = await prisma.market.findMany({ where: { tournamentId: { in: shown.map((t) => t.id) } }, include: { _count: { select: { bets: true } } } });
  return shown
    .map(({ _count, ...t }) => {
      const mine = markets.filter((m) => m.tournamentId === t.id);
      return { ...t, teams: _count.entries, open: mine.filter((m) => m.kind !== "GAME" && marketOpen(m, t, now)).length, markets: mine.length, picks: mine.reduce((n, m) => n + m._count.bets, 0) };
    })
    .sort((a, b) => Number(b.bracketStatus === "LIVE") - Number(a.bracketStatus === "LIVE") || b.open - a.open || Number(a.bracketStatus === "DONE") - Number(b.bracketStatus === "DONE"));
}

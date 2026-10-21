/**
 * The trash bin (ถังขยะ). Deleting a tournament keeps a copy of it and everything that belonged to it
 * (teams in it, rosters, solo sign-ups, matches with their games and player stats, the bracket, blacklist
 * entries, story links) for 30 days, so a mistake can be undone. After that it is gone for good.
 * Prediction picks are refunded at deletion and do not come back.
 */
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { recomputeRatings } from "./elo.js";
import { refundTournament, syncPredictions } from "./predict.js";

export const KEEP_DAYS = 30;
const DAY = 86_400_000;

const snapshotInclude = {
  entries: { include: { roster: true } },
  soloSignups: true,
  matches: { include: { games: { include: { playerStats: true } } } },
  bracketMatches: true,
  blacklist: true,
  stories: true,
} as const;

type Snapshot = NonNullable<Awaited<ReturnType<typeof loadTournament>>>;

function loadTournament(id: string) {
  return prisma.tournament.findUnique({ where: { id }, include: snapshotInclude });
}

/** Refunds picks, keeps a copy in the trash, then deletes the tournament and recomputes ratings. */
export async function trashTournament(id: string) {
  const t = await loadTournament(id);
  if (!t) throw notFound("Tournament");
  await refundTournament(id);
  const summary = [
    t.entries.length ? `${t.entries.length} ทีม` : null,
    t.soloSignups.length ? `${t.soloSignups.length} คนสมัครเดี่ยว` : null,
    `${t.matches.length} แมตช์`,
  ].filter(Boolean).join(" · ");
  await prisma.$transaction([
    prisma.trashItem.create({ data: { kind: "TOURNAMENT", refId: t.id, name: t.name, summary, data: JSON.stringify(t) } }),
    prisma.tournament.delete({ where: { id } }),
  ]);
  await recomputeRatings();
}

/** Forgets items older than 30 days. */
export function purgeTrash(now = new Date()) {
  return prisma.trashItem.deleteMany({ where: { deletedAt: { lt: new Date(now.getTime() - KEEP_DAYS * DAY) } } });
}

export async function trashList(now = new Date()) {
  await purgeTrash(now);
  const rows = await prisma.trashItem.findMany({ orderBy: { deletedAt: "desc" }, select: { id: true, kind: true, refId: true, name: true, summary: true, deletedAt: true } });
  return rows.map((r) => ({ ...r, expiresAt: new Date(r.deletedAt.getTime() + KEEP_DAYS * DAY) }));
}

export async function forgetTrash(id: string) {
  const item = await prisma.trashItem.findUnique({ where: { id }, select: { id: true } });
  if (!item) throw notFound("Trash item");
  await prisma.trashItem.delete({ where: { id } });
}

/**
 * Puts a tournament back as it was. Anything that pointed at something deleted since (a team, a player,
 * the game, the season) is left out or unlinked. Returns what could not come back.
 */
export async function restoreTrash(id: string) {
  await purgeTrash();
  const item = await prisma.trashItem.findUnique({ where: { id } });
  if (!item) throw notFound("Trash item");
  if (await prisma.tournament.findUnique({ where: { id: item.refId }, select: { id: true } })) throw fail(409, "Already restored", "ทัวร์นี้กู้คืนไปแล้ว");
  const t = JSON.parse(item.data) as Snapshot;
  const { entries, soloSignups, matches, bracketMatches, blacklist, stories, ...tournament } = t;

  const teamIds = new Set(
    (await prisma.team.findMany({ where: { id: { in: [...entries.map((e) => e.teamId), ...matches.flatMap((m) => [m.teamAId, m.teamBId])] } }, select: { id: true } })).map((r) => r.id),
  );
  const playerIds = new Set(
    (
      await prisma.player.findMany({
        where: {
          id: {
            in: [
              ...entries.flatMap((e) => e.roster.map((r) => r.playerId)),
              ...soloSignups.map((s) => s.playerId),
              ...matches.flatMap((m) => m.games.flatMap((g) => g.playerStats.map((s) => s.playerId))),
              ...blacklist.map((b) => b.playerId),
            ],
          },
        },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  const gameOk = tournament.gameId ? await prisma.game.findUnique({ where: { id: tournament.gameId }, select: { id: true } }) : null;
  const seasonOk = tournament.seasonId ? await prisma.specialSeason.findUnique({ where: { id: tournament.seasonId }, select: { id: true } }) : null;
  const usedRefs = new Set(
    (await prisma.match.findMany({ where: { sourceRef: { in: matches.map((m) => m.sourceRef).filter((s): s is string => Boolean(s)) } }, select: { sourceRef: true } })).map((r) => r.sourceRef),
  );

  const keptEntries = entries.filter((e) => teamIds.has(e.teamId));
  const keptMatches = matches.filter((m) => teamIds.has(m.teamAId) && teamIds.has(m.teamBId) && (!m.winnerId || teamIds.has(m.winnerId)));
  const matchIds = new Set(keptMatches.map((m) => m.id));
  const missing = {
    teams: entries.length - keptEntries.length,
    matches: matches.length - keptMatches.length,
  };

  await prisma.$transaction(async (tx) => {
    await tx.tournament.create({ data: { ...tournament, gameId: gameOk ? tournament.gameId : null, seasonId: seasonOk ? tournament.seasonId : null } });
    for (const { roster, ...entry } of keptEntries) {
      await tx.tournamentEntry.create({ data: entry });
      const rows = roster.filter((r) => playerIds.has(r.playerId));
      if (rows.length) await tx.rosterPlayer.createMany({ data: rows });
    }
    const solo = soloSignups.filter((s) => playerIds.has(s.playerId));
    if (solo.length) await tx.soloSignup.createMany({ data: solo });
    for (const { games, ...match } of keptMatches) {
      await tx.match.create({ data: { ...match, sourceRef: match.sourceRef && usedRefs.has(match.sourceRef) ? null : match.sourceRef } });
      for (const { playerStats, ...game } of games) {
        await tx.matchGame.create({ data: game });
        const stats = playerStats.filter((s) => playerIds.has(s.playerId) && teamIds.has(s.teamId));
        if (stats.length) await tx.matchPlayerStat.createMany({ data: stats });
      }
    }
    if (bracketMatches.length) await tx.bracketMatch.createMany({ data: bracketMatches.map((b) => ({ ...b, matchId: b.matchId && matchIds.has(b.matchId) ? b.matchId : null })) });
    const bans = blacklist.filter((b) => playerIds.has(b.playerId));
    if (bans.length) await tx.blacklistEntry.createMany({ data: bans });
    if (stories.length) await tx.tournamentStory.createMany({ data: stories });
    await tx.trashItem.delete({ where: { id } });
  });
  await recomputeRatings();
  await syncPredictions(item.refId).catch(() => null);
  return { tournamentId: item.refId, name: item.name, missing };
}

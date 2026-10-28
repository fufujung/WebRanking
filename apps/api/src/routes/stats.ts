import { Router } from "express";
import { prisma } from "../lib/db.js";
import { matchInclude, matchOrder } from "../lib/selects.js";
import { playerSearch } from "../lib/players.js";
import { playerBoard, tierCounts } from "../lib/leaderboard.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { z } from "zod";

export const stats = Router();

stats.get("/overview", async (req, res) => {
  const { gameId, home } = z.object({ gameId: z.string().trim().min(1).max(40).optional(), home: z.enum(["1"]).optional() }).parse(req.query);
  const game = gameId ? { gameId } : {};
  const upcomingQuery = (special: boolean) => prisma.tournament.findMany({ where: { ...game, special, status: { in: ["UPCOMING", "ONGOING"] } }, orderBy: { startDate: "asc" }, take: home ? 30 : 3, include: { _count: { select: { entries: true } } } });
  const [teams, players, tournaments, matches, ongoing, topTeams, recentMatches, upcoming, board, normal, special] = await Promise.all([
    prisma.team.count(),
    prisma.player.count(),
    prisma.tournament.count(),
    prisma.match.count(),
    prisma.tournament.count({ where: { status: "ONGOING" } }),
    prisma.team.findMany({ orderBy: [{ rating: "desc" }, { name: "asc" }], take: 5 }),
    prisma.match.findMany({ where: gameId ? { tournament: { gameId } } : {}, orderBy: matchOrder, take: home ? 30 : 8, include: matchInclude }),
    prisma.tournament.findMany({ where: { ...game, status: { in: ["UPCOMING", "ONGOING"] } }, orderBy: { startDate: "asc" }, take: 5, include: { _count: { select: { entries: true } } } }),
    playerBoard(),
    upcomingQuery(false),
    upcomingQuery(true),
  ]);
  res.json({
    totals: { teams, players, tournaments, matches, ongoingTournaments: ongoing },
    topTeams,
    /** Top of the MMR ladder (ranked players only). */
    topPlayers: board.ranked.slice(0, 5),
    recentMatches,
    upcomingTournaments: upcoming.map(({ _count, ...tournament }) => ({ ...tournament, teamCount: _count.entries })),
    normalTournaments: normal.map(({ _count, ...t }) => ({ ...t, teamCount: _count.entries })),
    specialTournaments: special.map(({ _count, ...t }) => ({ ...t, teamCount: _count.entries })),
  });
});

/** One search box across teams, players and tournaments. */
stats.get("/search", async (req, res) => {
  const scope = z.enum(["all", "tournaments"]).default("all").parse(req.query.scope);
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  if (!q) {
    res.json({ teams: [], players: [], tournaments: [] });
    return;
  }
  const [teams, players, tournaments] = await Promise.all([
    scope === "tournaments" ? [] : prisma.team.findMany({ where: { OR: [{ name: { contains: q } }, { tag: { contains: q } }] }, take: 10, orderBy: { rating: "desc" } }),
    scope === "tournaments" ? [] : prisma.player.findMany({
      where: playerSearch(q),
      take: 10,
      include: { team: { select: { id: true, name: true } } },
    }),
    prisma.tournament.findMany({ where: scope === "tournaments" ? { name: { contains: q } } : { OR: [{ name: { contains: q } }, { game: { contains: q } }] }, take: 10, orderBy: { startDate: "desc" } }),
  ]);
  res.json({ teams, players, tournaments });
});

const DAY = 86400_000;

/**
 * Everything the admin dashboard needs in one call: totals, activity per day,
 * tier spread and a to-do list. Days are counted in the site's time zone
 * (tz = minutes ahead of UTC, default Thailand +7).
 */
stats.get("/admin", requireAdmin, async (req, res) => {
  const q = z
    .object({ days: z.coerce.number().int().min(7).max(90).default(14), tz: z.coerce.number().int().min(-720).max(840).default(420) })
    .parse(req.query);
  const offset = q.tz * 60_000;
  const now = Date.now();
  const today = Math.floor((now + offset) / DAY) * DAY - offset; // local midnight, as a UTC instant
  const from = new Date(today - (q.days - 1) * DAY);
  const [teams, players, tournaments, matches, ongoing, recentMatches, newPlayers, newTeams, board, noUid, noLogo, noTeam, ready, disputed, openReg, linkRequests] =
    await Promise.all([
      prisma.team.count(),
      prisma.player.count(),
      prisma.tournament.count(),
      prisma.match.count(),
      prisma.tournament.count({ where: { status: "ONGOING" } }),
      prisma.match.findMany({ where: { playedAt: { gte: from } }, select: { playedAt: true, _count: { select: { games: true } } } }),
      prisma.player.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
      prisma.team.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
      playerBoard(),
      prisma.player.count({ where: { OR: [{ uid: null }, { uid: "" }] } }),
      prisma.team.count({ where: { OR: [{ logoUrl: null }, { logoUrl: "" }] } }),
      prisma.player.count({ where: { teamId: null } }),
      prisma.bracketMatch.groupBy({ by: ["tournamentId"], where: { status: "READY" }, _count: { _all: true } }),
      prisma.bracketMatch.findMany({
        where: { disputed: true, status: { not: "DONE" } },
        select: { id: true, number: true, tournament: { select: { id: true, name: true } } },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),
      prisma.tournament.findMany({
        where: { registrationOpen: true, status: { not: "COMPLETED" } },
        select: { id: true, name: true, maxTeams: true, _count: { select: { entries: true } } },
        orderBy: { startDate: "asc" },
      }),
      prisma.playerLinkRequest.count(),
    ]);

  const days = Array.from({ length: q.days }, (_, i) => {
    const start = today - (q.days - 1 - i) * DAY;
    return { date: new Date(start + offset).toISOString().slice(0, 10), matches: 0, games: 0, newPlayers: 0, newTeams: 0 };
  });
  const slot = (d: Date) => days[Math.floor((d.getTime() - from.getTime()) / DAY)];
  for (const m of recentMatches) {
    const d = slot(m.playedAt);
    if (!d) continue; // played in the future
    d.matches++;
    d.games += m._count.games;
  }
  for (const p of newPlayers) {
    const d = slot(p.createdAt);
    if (d) d.newPlayers++;
  }
  for (const t of newTeams) {
    const d = slot(t.createdAt);
    if (d) d.newTeams++;
  }

  const readyNames = ready.length
    ? await prisma.tournament.findMany({ where: { id: { in: ready.map((r) => r.tournamentId) } }, select: { id: true, name: true } })
    : [];
  const week = days.slice(-7);
  const prevWeek = days.slice(-14, -7);
  const sum = (rows: typeof days, key: "matches" | "newPlayers" | "newTeams") => rows.reduce((n, d) => n + d[key], 0);

  res.json({
    totals: { teams, players, tournaments, matches, ongoingTournaments: ongoing, rankedPlayers: board.ranked.length, placingPlayers: board.placing.length },
    week: {
      matches: sum(week, "matches"),
      prevMatches: prevWeek.length === 7 ? sum(prevWeek, "matches") : null,
      newPlayers: sum(week, "newPlayers"),
      newTeams: sum(week, "newTeams"),
      matchesToday: days.at(-1)!.matches,
    },
    days,
    tiers: tierCounts(board.ranked),
    topPlayers: board.ranked.slice(0, 5),
    todo: {
      playersWithoutUid: noUid,
      linkRequests,
      teamsWithoutLogo: noLogo,
      playersWithoutTeam: noTeam,
      readyMatches: ready
        .map((r) => ({ tournamentId: r.tournamentId, name: readyNames.find((t) => t.id === r.tournamentId)?.name ?? "", count: r._count._all }))
        .sort((a, b) => b.count - a.count),
      disputes: disputed.map((d) => ({ id: d.id, number: d.number, tournamentId: d.tournament.id, name: d.tournament.name })),
      openRegistration: openReg.map((t) => ({ id: t.id, name: t.name, teams: t._count.entries, maxTeams: t.maxTeams })),
    },
  });
});

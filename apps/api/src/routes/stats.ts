import { Router } from "express";
import { prisma } from "../lib/db.js";
import { matchInclude, matchOrder } from "../lib/selects.js";

export const stats = Router();

stats.get("/overview", async (_req, res) => {
  const [teams, players, tournaments, matches, ongoing, topTeams, recentMatches, upcoming] = await Promise.all([
    prisma.team.count(),
    prisma.player.count(),
    prisma.tournament.count(),
    prisma.match.count(),
    prisma.tournament.count({ where: { status: "ONGOING" } }),
    prisma.team.findMany({ orderBy: [{ rating: "desc" }, { name: "asc" }], take: 5 }),
    prisma.match.findMany({ orderBy: matchOrder, take: 8, include: matchInclude }),
    prisma.tournament.findMany({ where: { status: { in: ["UPCOMING", "ONGOING"] } }, orderBy: { startDate: "asc" }, take: 5 }),
  ]);
  res.json({
    totals: { teams, players, tournaments, matches, ongoingTournaments: ongoing },
    topTeams,
    recentMatches,
    upcomingTournaments: upcoming,
  });
});

/** One search box across teams, players and tournaments. */
stats.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  if (!q) {
    res.json({ teams: [], players: [], tournaments: [] });
    return;
  }
  const [teams, players, tournaments] = await Promise.all([
    prisma.team.findMany({ where: { OR: [{ name: { contains: q } }, { tag: { contains: q } }] }, take: 10, orderBy: { rating: "desc" } }),
    prisma.player.findMany({
      where: { OR: [{ name: { contains: q } }, { nickname: { contains: q } }] },
      take: 10,
      include: { team: { select: { id: true, name: true } } },
    }),
    prisma.tournament.findMany({ where: { OR: [{ name: { contains: q } }, { game: { contains: q } }] }, take: 10, orderBy: { startDate: "desc" } }),
  ]);
  res.json({ teams, players, tournaments });
});

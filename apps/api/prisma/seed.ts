// Creates the first API key (written to apps/web/.env.local) and, on an empty database, demo data.
import "../src/env.js";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db.js";
import { createApiKey } from "../src/lib/apiKeys.js";
import { saveMatch } from "../src/lib/matchWrite.js";

const webEnv = path.resolve(import.meta.dirname, "../../web/.env.local");

if ((await prisma.apiKey.count()) === 0 || !fs.existsSync(webEnv)) {
  const { key } = await createApiKey("Website (server-side)", "admin");
  const adminPassword = randomBytes(6).toString("hex");
  fs.writeFileSync(
    webEnv,
    [
      `API_URL=http://localhost:${process.env.PORT ?? 4000}`,
      `API_KEY=${key}`,
      `ADMIN_PASSWORD=${adminPassword}`,
      `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
      "",
    ].join("\n"),
  );
  console.log(`Wrote ${webEnv}`);
  console.log(`Admin password for the website: ${adminPassword}`);
}

if (process.argv.includes("--no-demo") || (await prisma.team.count()) > 0) {
  await prisma.$disconnect();
  process.exit(0);
}

const teamDefs = [
  { name: "Thunder Hawks", tag: "THK", country: "Thailand", players: ["Ace", "Blaze", "Comet", "Dash"] },
  { name: "Siam Dragons", tag: "SDG", country: "Thailand", players: ["Falcon", "Ghost", "Hunter", "Ion"] },
  { name: "Night Owls", tag: "NOW", country: "Thailand", players: ["Kite", "Lynx", "Moss", "Nova"] },
  { name: "Red Tigers", tag: "RTG", country: "Thailand", players: ["Pike", "Quill", "Raven", "Storm"] },
];
const teams = [];
for (const def of teamDefs) {
  const team = await prisma.team.create({
    data: {
      name: def.name,
      tag: def.tag,
      country: def.country,
      players: { create: def.players.map((n) => ({ name: n, country: def.country })) },
    },
    include: { players: true },
  });
  teams.push(team);
}

const day = 86_400_000;
const now = Date.now();
const game = "Basketball 3v3";
const cup = await prisma.tournament.create({
  data: { name: "Bangkok Masters 2026", game, location: "Discord", status: "COMPLETED", startDate: new Date(now - 40 * day), endDate: new Date(now - 38 * day) },
});
const league = await prisma.tournament.create({
  data: { name: "SEA Championship Season 1", game, location: "Discord", status: "ONGOING", startDate: new Date(now - 10 * day) },
});
await prisma.tournament.create({
  data: { name: "Chiang Mai Open", game, location: "Discord", status: "UPCOMING", startDate: new Date(now + 20 * day) },
});

let seed = 7;
const rand = (max: number) => Math.floor(((seed = (seed * 9301 + 49297) % 233280) / 233280) * (max + 1));

/** Splits a team's game score between its three starters and fills in the rest of the scoreboard. */
function scoreboard(players: { id: string }[], side: "A" | "B", points: number, won: boolean) {
  const a = rand(points);
  const b = rand(points - a);
  const split = [a, b, points - a - b];
  return players.slice(0, 3).map((p, i) => ({
    playerId: p.id,
    side,
    pts: split[i],
    reb: rand(10),
    blk: rand(3),
    stl: rand(2),
    ast: rand(6),
    lbr: rand(4),
    rating: Math.round((8 + split[i] * 0.6 + rand(6)) * 10) / 10,
    award: null as "MVP" | "SVP" | null,
    won,
  }));
}

const fixtures: [string, number, number, [number, number][]][] = [
  [cup.id, 0, 1, [[26, 13], [14, 8]]],
  [cup.id, 2, 3, [[21, 18], [15, 21], [12, 21]]],
  [cup.id, 0, 3, [[21, 17], [21, 19]]],
  [cup.id, 1, 2, [[18, 21], [21, 11], [21, 16]]],
  [league.id, 0, 2, [[21, 9], [19, 21], [21, 14]]],
  [league.id, 1, 3, [[13, 21], [17, 21]]],
  [league.id, 0, 1, [[16, 21], [21, 19], [18, 21]]],
  [league.id, 2, 3, [[21, 20], [20, 21], [21, 17]]],
];
for (const [i, [tournamentId, a, b, gameScores]] of fixtures.entries()) {
  const games = gameScores.map(([sa, sb]) => {
    const rows = [...scoreboard(teams[a].players, "A", sa, sa > sb), ...scoreboard(teams[b].players, "B", sb, sb > sa)];
    const byRating = [...rows].sort((x, y) => (y.rating ?? 0) - (x.rating ?? 0));
    byRating.find((r) => r.won)!.award = "MVP";
    byRating.find((r) => !r.won)!.award = "SVP";
    return { scoreA: sa, scoreB: sb, imageUrl: null, players: rows.map(({ won: _won, ...r }) => r) };
  });
  await saveMatch({
    tournamentId,
    teamAId: teams[a].id,
    teamBId: teams[b].id,
    scoreA: undefined,
    scoreB: undefined,
    round: tournamentId === cup.id ? ["Semi-final", "Semi-final", "Final", "Third place"][i] : `Week ${i - 3}`,
    notes: null,
    imageUrl: null,
    source: null,
    sourceRef: null,
    playedAt: new Date((tournamentId === cup.id ? now - 39 * day : now - 9 * day) + i * 3600_000),
    games,
  });
}
await prisma.tournamentEntry.updateMany({ where: { tournamentId: cup.id, teamId: teams[0].id }, data: { placement: 1 } });
await prisma.tournamentEntry.updateMany({ where: { tournamentId: cup.id, teamId: teams[3].id }, data: { placement: 2 } });
await prisma.tournamentEntry.updateMany({ where: { tournamentId: cup.id, teamId: teams[1].id }, data: { placement: 3 } });
console.log("Seeded demo teams, players, tournaments and matches.");
await prisma.$disconnect();

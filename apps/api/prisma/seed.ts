// Creates the first API key (written to apps/web/.env.local) and, on an empty database, demo data.
import "../src/env.js";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db.js";
import { createApiKey } from "../src/lib/apiKeys.js";
import { recomputeRatings, winnerOf } from "../src/lib/elo.js";

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
  { name: "Thunder Hawks", tag: "THK", country: "Thailand", players: ["Ace", "Blaze", "Comet", "Dash", "Echo"] },
  { name: "Siam Dragons", tag: "SDG", country: "Thailand", players: ["Falcon", "Ghost", "Hunter", "Ion", "Jet"] },
  { name: "Night Owls", tag: "NOW", country: "Vietnam", players: ["Kite", "Lynx", "Moss", "Nova", "Orbit"] },
  { name: "Red Tigers", tag: "RTG", country: "Malaysia", players: ["Pike", "Quill", "Raven", "Storm", "Tusk"] },
];
const teams = [];
for (const def of teamDefs) {
  const team = await prisma.team.create({
    data: {
      name: def.name,
      tag: def.tag,
      country: def.country,
      players: { create: def.players.map((n) => ({ name: n, nickname: n.toLowerCase(), country: def.country })) },
    },
    include: { players: true },
  });
  teams.push(team);
}

const day = 86_400_000;
const now = Date.now();
const cup = await prisma.tournament.create({
  data: { name: "Bangkok Masters 2026", game: "Valorant", location: "Bangkok", status: "COMPLETED", startDate: new Date(now - 40 * day), endDate: new Date(now - 38 * day) },
});
const league = await prisma.tournament.create({
  data: { name: "SEA Championship Season 1", game: "Valorant", location: "Online", status: "ONGOING", startDate: new Date(now - 10 * day) },
});
await prisma.tournament.create({
  data: { name: "Chiang Mai Open", game: "Valorant", location: "Chiang Mai", status: "UPCOMING", startDate: new Date(now + 20 * day) },
});

let seed = 7;
const rand = (max: number) => ((seed = (seed * 9301 + 49297) % 233280) / 233280) * max;
const fixtures: [string, number, number, number, number][] = [
  [cup.id, 0, 1, 13, 9], [cup.id, 2, 3, 11, 13], [cup.id, 0, 3, 13, 7], [cup.id, 1, 2, 13, 11],
  [league.id, 0, 2, 13, 10], [league.id, 1, 3, 9, 13], [league.id, 0, 1, 12, 14], [league.id, 2, 3, 13, 13],
];
for (const [i, [tournamentId, a, b, scoreA, scoreB]] of fixtures.entries()) {
  const teamA = teams[a];
  const teamB = teams[b];
  for (const t of [teamA, teamB]) {
    await prisma.tournamentEntry.upsert({
      where: { tournamentId_teamId: { tournamentId, teamId: t.id } },
      create: { tournamentId, teamId: t.id },
      update: {},
    });
  }
  await prisma.match.create({
    data: {
      tournamentId,
      teamAId: teamA.id,
      teamBId: teamB.id,
      scoreA,
      scoreB,
      winnerId: winnerOf(teamA.id, teamB.id, scoreA, scoreB),
      round: tournamentId === cup.id ? (["Semi-final", "Semi-final", "Final", "Third place"][i]) : `Week ${i - 3}`,
      playedAt: new Date((tournamentId === cup.id ? now - 39 * day : now - 9 * day) + i * 3600_000),
      playerStats: {
        create: [...teamA.players, ...teamB.players].map((p) => ({
          playerId: p.id,
          teamId: p.teamId!,
          kills: Math.round(8 + rand(20)),
          deaths: Math.round(8 + rand(15)),
          assists: Math.round(2 + rand(10)),
          score: Math.round(120 + rand(220)),
        })),
      },
    },
  });
}
await prisma.tournamentEntry.updateMany({ where: { tournamentId: cup.id, teamId: teams[0].id }, data: { placement: 1 } });
await prisma.tournamentEntry.updateMany({ where: { tournamentId: cup.id, teamId: teams[3].id }, data: { placement: 2 } });
await prisma.tournamentEntry.updateMany({ where: { tournamentId: cup.id, teamId: teams[1].id }, data: { placement: 3 } });
await recomputeRatings();
console.log("Seeded demo teams, players, tournaments and matches.");
await prisma.$disconnect();

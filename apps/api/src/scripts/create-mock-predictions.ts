import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dbPath = fileURLToPath(new URL("../../prisma/dev.db", import.meta.url));
if (!existsSync(dbPath)) throw new Error("Local development database was not found.");
const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath.replaceAll("\\", "/")}?socket_timeout=20` } } });
const tournamentIds = ["mock-home-20261028-normal-02", "mock-home-20261028-normal-03", "mock-home-20261028-special-02", "mock-home-20261028-special-03"];
const teams = ["Crimson Hawks", "Shadow Wolves", "Thunder Kings", "Blaze Phoenix"].map((name, i) => ({ id: `mock-predict-20261028-team-${i + 1}`, name: `[MOCK] ${name}`, tag: ["MCH", "MSW", "MTK", "MBP"][i] }));
try {
  const tournaments = await prisma.tournament.findMany({ where: { id: { in: tournamentIds }, entryMode: "TEAM" } });
  if (tournaments.length !== tournamentIds.length) throw new Error("The expected team mock tournaments are missing; run the mock tournament script first.");
  await prisma.$transaction(async (tx) => {
    for (const team of teams) await tx.team.upsert({ where: { id: team.id }, create: { ...team, gameId: tournaments[0].gameId }, update: {} });
    for (const tournament of tournaments) {
      for (const team of teams) await tx.tournamentEntry.upsert({ where: { tournamentId_teamId: { tournamentId: tournament.id, teamId: team.id } }, create: { tournamentId: tournament.id, teamId: team.id }, update: {} });
      for (let pair = 0; pair < 2; pair++) {
        const key = `mock-predict-pair-${pair + 1}`;
        await tx.market.upsert({ where: { tournamentId_key: { tournamentId: tournament.id, key } }, create: { tournamentId: tournament.id, key, kind: "CUSTOM", label: `[MOCK] คู่ที่ ${pair + 1}`, teamIds: JSON.stringify(teams.slice(pair * 2, pair * 2 + 2).map((team) => team.id)) }, update: {} });
      }
    }
  });
  console.log(JSON.stringify({ teams: teams.length, tournaments: tournaments.length, customMarkets: await prisma.market.count({ where: { tournamentId: { in: tournamentIds }, key: { startsWith: "mock-predict-pair-" } } }) }));
} finally { await prisma.$disconnect(); }

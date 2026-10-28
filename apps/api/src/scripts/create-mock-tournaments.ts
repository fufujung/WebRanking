import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Explicitly target this checkout's local development database, never a configured remote database.
const dbPath = fileURLToPath(new URL("../../prisma/dev.db", import.meta.url));
if (!existsSync(dbPath)) throw new Error("Local development database was not found.");
const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath.replaceAll("\\", "/")}?socket_timeout=20` } } });
const prefix = "mock-home-20261028-";
try {
  const games = await prisma.game.findMany({ orderBy: { name: "asc" } });
  const game = games.find((item) => item.name.toLowerCase().includes("kuroko")) ?? games[0];
  if (!game) throw new Error("Create a game before adding mock tournaments.");
  const existing = new Set((await prisma.tournament.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } })).map((t) => t.id));
  const start = new Date();
  start.setUTCHours(12, 0, 0, 0);
  const records = Array.from({ length: 60 }, (_, index) => {
    const special = index >= 50;
    const number = special ? index - 49 : index + 1;
    const id = `${prefix}${special ? "special" : "normal"}-${String(number).padStart(2, "0")}`;
    return {
      id,
      name: `[MOCK] ${special ? "เล่นเก่ง ปากเก่ง" : "Tournament"} ${String(number).padStart(2, "0")}`,
      gameId: game.id,
      game: game.name,
      description: "ข้อมูลตัวอย่างสำหรับทดสอบหน้าทัวร์นาเมนต์",
      location: "Discord",
      special,
      status: "UPCOMING",
      startDate: new Date(start.getTime() + (index + 1) * 86400000),
      format: "SINGLE_ELIMINATION",
      entryMode: index % 5 === 0 ? "SOLO" : "TEAM",
      teamSize: 3,
      rosterMin: 3,
      rosterMax: 5,
      maxTeams: 16,
      registrationOpen: index % 4 !== 0,
    };
  }).filter((record) => !existing.has(record.id));
  await prisma.$transaction(records.map((data) => prisma.tournament.create({ data })));
  const total = await prisma.tournament.groupBy({ by: ["special"], where: { id: { startsWith: prefix } }, _count: { _all: true } });
  console.log(JSON.stringify({ game: game.name, created: records.length, totals: total.map((row) => ({ special: row.special, count: row._count._all })) }));
} finally {
  await prisma.$disconnect();
}

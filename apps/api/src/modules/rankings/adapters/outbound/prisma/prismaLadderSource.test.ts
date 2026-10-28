/** The Prisma adapter of LadderSource against its own SQLite database (not the app's client). */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { prismaLadderSource } from "./prismaLadderSource.js";
import { seedLadder } from "../../../contract/fixtures.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-ladder-source-"));
fs.writeFileSync(path.join(tmp, "source.db"), "");
const url = `file:${path.join(tmp, "source.db").replaceAll("\\", "/")}`;
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: { ...process.env, DATABASE_URL: url } });
const prisma = new PrismaClient({ datasources: { db: { url } } });
const source = prismaLadderSource(prisma);
let f: Awaited<ReturnType<typeof seedLadder>>;

before(async () => {
  f = await seedLadder(prisma);
});

after(async () => {
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test("players: every game, or one game; team card has only the public team fields", async () => {
  const all = await source.load({ board: "main" });
  assert.equal(all.players.length, await prisma.player.count());
  const g2 = await source.load({ gameId: f.g2.id, board: "main" });
  assert.deepEqual(g2.players.map((p) => p.id), [f.ids.g]);
  const ace = all.players.find((p) => p.id === f.ids.a)!;
  assert.deepEqual(Object.keys(ace.team!).sort(), ["id", "logoUrl", "name", "rating", "tag"]);
  // Exactly the fields the ladder has always returned, named one by one: a new Player column stays private.
  const fields = ["avatarUrl", "country", "createdAt", "discordId", "gameId", "guildId", "id", "mmr", "name", "nickname", "peakMmr", "role", "server", "specialMmr", "specialPeakMmr", "team", "teamId", "uid", "updatedAt"];
  assert.deepEqual(Object.keys(ace).sort(), fields);
  assert.equal(all.players.find((p) => p.id === f.ids.h)!.team, null);
});

test("changes: only the asked board, newest first, same-day series by creation time", async () => {
  const main = await source.load({ board: "main" });
  const special = await source.load({ board: "special" });
  assert.ok(!main.changes.some((c) => c.playerId === f.ids.i));
  assert.deepEqual(new Set(special.changes.map((c) => c.playerId)), new Set([f.ids.i]));
  const times = main.changes.map((c) => c.playedAt.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  assert.deepEqual(main.changes.filter((c) => c.playerId === f.ids.e).map((c) => c.delta), [-5, 10]);
  // The game filter is for players only; changes are not filtered (as before), the ladder joins them.
  assert.equal((await source.load({ gameId: f.g2.id, board: "main" })).changes.length, main.changes.length);
});

test("blacklist: active entries only, one id per player", async () => {
  const { blacklistedPlayerIds } = await source.load({ board: "main" });
  assert.deepEqual(blacklistedPlayerIds, [f.ids.g]);
});

test("an empty database loads empty lists", async () => {
  fs.writeFileSync(path.join(tmp, "empty.db"), "");
  const emptyUrl = `file:${path.join(tmp, "empty.db").replaceAll("\\", "/")}`;
  execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: { ...process.env, DATABASE_URL: emptyUrl } });
  const empty = new PrismaClient({ datasources: { db: { url: emptyUrl } } });
  try {
    assert.deepEqual(await prismaLadderSource(empty).load({ board: "main" }), { players: [], changes: [], blacklistedPlayerIds: [] });
  } finally {
    await empty.$disconnect();
  }
});

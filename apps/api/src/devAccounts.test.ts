import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-client-seed-"));
fs.writeFileSync(path.join(tmp, "test.db"), "");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db").replaceAll("\\", "/")}`;
execFileSync(process.execPath, [path.resolve("../../node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], { env: process.env, stdio: "ignore" });
const { prisma } = await import("./lib/db.js");
const { seedDevAccounts } = await import("../prisma/devAccounts.js");
const { reserveList } = await import("./lib/special.js");
after(async () => {
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test("client seed creates six per rank and reruns without duplicates or erasing profiles", async () => {
  await prisma.$transaction(seedDevAccounts);
  const ranks = await prisma.player.groupBy({ by: ["inGameRank"], _count: true });
  assert.equal(ranks.length, 4);
  assert.ok(ranks.every((r) => r._count === 6));
  const game = await prisma.game.findUniqueOrThrow({ where: { name: "Kuroko's Basketball: Street Rivals" } });
  const reserves = await reserveList(true, game.id);
  assert.equal(reserves.length, 24, "seeded players are available to the admin reserve draw");
  for (const rank of ranks) {
    const pool = reserves.filter((p) => p.rank === rank.inGameRank);
    assert.equal(pool.length, 6);
    for (const position of ["GUARD", "FORWARD", "CENTER"]) assert.equal(pool.filter((p) => p.position === position).length, 2);
  }
  assert.equal((await reserveList(true, "other-game")).length, 0);
  await prisma.reservePlayer.update({ where: { playerId: "dev-test-player-01" }, data: { position: "ALL", facebook: "test contact", rank: "เจ้าแห่ง ZONE" } });
  for (const r of ranks) {
    const positions = await prisma.player.groupBy({ by: ["role"], where: { inGameRank: r.inGameRank }, _count: true });
    assert.equal(positions.length, 3);
    assert.ok(positions.every((p) => p._count === 2));
  }
  await prisma.player.update({ where: { id: "dev-test-player-01" }, data: { name: "Custom name", mmr: 1234, role: "ALL", inGameRank: null } });
  await prisma.$transaction(seedDevAccounts);
  assert.equal(await prisma.player.count(), 24);
  assert.equal(await prisma.reservePlayer.count(), 24);
  const signup = await prisma.reservePlayer.findUniqueOrThrow({ where: { playerId: "dev-test-player-01" } });
  assert.equal(signup.position, "ALL");
  assert.equal(signup.facebook, "test contact");
  assert.equal(signup.rank, "เจ้าแห่ง ZONE");
  const player = await prisma.player.findUniqueOrThrow({ where: { id: "dev-test-player-01" } });
  assert.equal(player.name, "Custom name");
  assert.equal(player.mmr, 1234);
  assert.equal(player.role, "ALL");
  assert.equal(player.inGameRank, "แม่ทัพไร้มงกุฎ");
});

test("incompatible custom game ranks leave existing profiles intact", async () => {
  await prisma.game.updateMany({ data: { ranks: JSON.stringify([{ name: "Custom", iconUrl: null }]) } });
  await prisma.player.update({ where: { id: "dev-test-player-01" }, data: { inGameRank: "Custom" } });
  await assert.rejects(prisma.$transaction(seedDevAccounts), /Test rank is not available/);
  assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: "dev-test-player-01" } })).inGameRank, "Custom");
  assert.equal(await prisma.player.count(), 24);
});

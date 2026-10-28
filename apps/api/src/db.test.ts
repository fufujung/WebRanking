/** The SQLite connection: waits for locks instead of failing, and reads alongside writes (WAL). */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-db-test-"));
fs.writeFileSync(path.join(tmp, "test.db"), "");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db").replaceAll("\\", "/")}`;
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: process.env });

const { databaseUrl, prisma, tuneDatabase } = await import("./lib/db.js");

after(async () => {
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("SQLite urls get a longer lock wait, other settings are kept", () => {
  assert.equal(databaseUrl("file:./dev.db"), "file:./dev.db?socket_timeout=20");
  assert.equal(databaseUrl("file:./dev.db?connection_limit=1"), "file:./dev.db?connection_limit=1&socket_timeout=20");
  assert.equal(databaseUrl("file:./dev.db?socket_timeout=60"), "file:./dev.db?socket_timeout=60");
  assert.equal(databaseUrl(undefined), undefined);
});

test("the database switches to WAL and keeps working", async () => {
  await tuneDatabase();
  const [mode] = await prisma.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode");
  assert.equal(mode.journal_mode, "wal");
  await prisma.game.create({ data: { id: "wal-test", name: "WAL" } });
  assert.equal(await prisma.game.count({ where: { id: "wal-test" } }), 1);
});

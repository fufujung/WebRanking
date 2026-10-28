/** Readiness and the deploy's write gate. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-life-test-"));
const gate = path.join(tmp, "WRITE_GATE");
fs.writeFileSync(path.join(tmp, "test.db"), "");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db").replaceAll("\\", "/")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
process.env.THERANKING_WRITE_GATE = gate;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: process.env });

const { createApp } = await import("./app.js");
const { createApiKey } = await import("./lib/apiKeys.js");
const { prisma } = await import("./lib/db.js");
const { runStartup, resetStartupForTests, writesHeld, forgetGateCheckForTests } = await import("./lib/lifecycle.js");

let server: Server;
let base: string;
let admin: string;

const call = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { "X-API-Key": admin, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
/** The gate file is read at most every 0.5 s; tests make the next check read it again instead of waiting. */
const recheck = () => {
  forgetGateCheckForTests();
  return writesHeld();
};

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = (await createApiKey("test admin", "admin")).key;
});

after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test("liveness always answers; readiness waits for start-up and reports a failure without details", async () => {
  resetStartupForTests();
  assert.equal((await call("GET", "/health")).status, 200);
  assert.deepEqual(await call("GET", "/health/ready"), { status: 503, body: { ok: false, state: "starting" } });

  let finish!: () => void;
  const slow = runStartup(() => new Promise<void>((r) => (finish = r)));
  assert.equal((await call("GET", "/health/ready")).status, 503, "slow start-up stays not ready");
  finish();
  await slow;
  assert.deepEqual(await call("GET", "/health/ready"), { status: 200, body: { ok: true, state: "ready" } });

  resetStartupForTests();
  await runStartup(async () => {
    throw new Error("backfill broke\nfile:/secret/path.db");
  });
  const failed = await call("GET", "/health/ready");
  assert.equal(failed.status, 503);
  assert.equal(failed.body.state, "failed");
  assert.equal(failed.body.reason, "Error: backfill broke");
  await runStartup(async () => {});
});

test("readiness fails when the database does not have the schema this code expects", async () => {
  await runStartup(async () => {});
  await prisma.$executeRawUnsafe('ALTER TABLE "Player" RENAME COLUMN "specialMmr" TO "specialMmrOld"');
  try {
    const res = await call("GET", "/health/ready");
    assert.equal(res.status, 503);
    assert.equal(res.body.state, "database");
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "Player" RENAME COLUMN "specialMmrOld" TO "specialMmr"');
  }
  assert.equal((await call("GET", "/health/ready")).status, 200);
});

test("while the deploy holds writes: saving gets 503, reading still works, nothing is written", async () => {
  fs.writeFileSync(gate, "deploy");
  recheck();
  try {
    const res = await call("POST", "/api/v1/teams", { name: "Gate Team" });
    assert.equal(res.status, 503);
    assert.equal(res.body.details.th, "เว็บกำลังอัปเดต ลองใหม่อีกครั้งในไม่กี่วินาที");
    assert.equal((await call("GET", "/api/v1/teams")).status, 200);
    assert.equal((await call("GET", "/health/ready")).status, 200);
    assert.equal(await prisma.team.count({ where: { name: "Gate Team" } }), 0);
  } finally {
    fs.rmSync(gate, { force: true });
    recheck();
  }
  assert.equal((await call("POST", "/api/v1/teams", { name: "Gate Team" })).status, 201);
});

test("a GET that saves (a team's invite code) is held too", async () => {
  const team = await prisma.team.create({ data: { name: "Invite Team" } });
  fs.writeFileSync(gate, "deploy");
  recheck();
  try {
    assert.equal((await call("GET", `/api/v1/teams/${team.id}/invite`)).status, 503);
    assert.equal(await prisma.teamInvite.count({ where: { teamId: team.id } }), 0);
  } finally {
    fs.rmSync(gate, { force: true });
    recheck();
  }
  assert.equal((await call("GET", `/api/v1/teams/${team.id}/invite`)).status, 200);
});

test("a gate left behind for more than 30 minutes is ignored", async () => {
  fs.writeFileSync(gate, "old");
  const old = new Date(Date.now() - 31 * 60_000);
  fs.utimesSync(gate, old, old);
  try {
    assert.equal(recheck(), false);
    assert.equal((await call("POST", "/api/v1/teams", { name: "Late Team" })).status, 201);
  } finally {
    fs.rmSync(gate, { force: true });
    recheck();
  }
});

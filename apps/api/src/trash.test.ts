/** The trash bin: a deleted tournament comes back with everything in it for 30 days, then it is gone. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-trash-test-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: process.env });

const { createApp } = await import("./app.js");
const { createApiKey } = await import("./lib/apiKeys.js");
const { prisma } = await import("./lib/db.js");

let server: Server;
let base: string;
let admin: string;
let reader: string;

async function call(method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = { "X-API-Key": admin };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}/api/v1${url}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Expects success and returns the body. */
async function ok(method: string, url: string, body?: unknown) {
  const res = await call(method, url, body);
  assert.ok(res.status < 300, `${method} ${url} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = (await createApiKey("test admin", "admin")).key;
  reader = (await createApiKey("test reader", "read")).key;
});

after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const line = (side: "A" | "B", playerId: string, pts = 5) => ({ side, playerId, pts, reb: 1, blk: 0, stl: 0, ast: 1, lbr: 0 });
let n = 0;
const discord = () => String(100000000000000000n + BigInt(++n));

async function registerTeam(tid: string, name: string) {
  const captain = discord();
  return ok("POST", `/tournaments/${tid}/registrations`, {
    teamName: name,
    captainDiscordId: captain,
    players: [1, 2, 3].map((i) => ({ name: `${name} P${i}`, discordId: i === 1 ? captain : discord() })),
  });
}

describe("trash", () => {
  const ids: Record<string, string> = {};

  test("deleting a tournament moves it to the trash; restoring brings matches, stats, MMR and stories back", async () => {
    ids.A = (await ok("POST", "/teams", { name: "Aces" })).id;
    ids.B = (await ok("POST", "/teams", { name: "Bolts" })).id;
    ids.a = (await ok("POST", "/players", { name: "a1", teamId: ids.A })).id;
    ids.b = (await ok("POST", "/players", { name: "b1", teamId: ids.B })).id;
    ids.cup = (await ok("POST", "/tournaments", { name: "Trash Cup", startDate: "2026-01-01" })).id;
    for (const day of [1, 2]) {
      await ok("POST", "/matches", { tournamentId: ids.cup, teamAId: ids.A, teamBId: ids.B, playedAt: `2026-01-0${day}T12:00:00Z`, games: [{ scoreA: 21, scoreB: 10, players: [line("A", ids.a), line("B", ids.b)] }] });
    }
    await ok("PUT", `/tournaments/${ids.cup}/stories`, { stories: [{ title: "โพสต์แรก", url: "https://www.facebook.com/share/p/abc" }] });
    const before = await ok("GET", `/players/${ids.a}`);
    assert.ok(before.mmr > 1000);

    assert.equal((await call("DELETE", `/tournaments/${ids.cup}`)).status, 204);
    assert.equal((await call("GET", `/tournaments/${ids.cup}`)).status, 404);
    assert.equal((await ok("GET", `/players/${ids.a}`)).mmr, 1000, "ratings no longer count the deleted matches");
    const [item] = (await ok("GET", "/trash")).data;
    assert.equal(item.name, "Trash Cup");
    assert.equal(item.refId, ids.cup);
    assert.match(item.summary, /2 แมตช์/);
    const days = (new Date(item.expiresAt).getTime() - new Date(item.deletedAt).getTime()) / 86_400_000;
    assert.equal(days, 30);

    const back = await ok("POST", `/trash/${item.id}/restore`);
    assert.deepEqual(back.missing, { teams: 0, matches: 0 });
    const t = await ok("GET", `/tournaments/${ids.cup}`);
    assert.equal(t.name, "Trash Cup");
    const matches = (await ok("GET", `/matches?tournamentId=${ids.cup}`)).data;
    assert.equal(matches.length, 2);
    assert.equal(await prisma.matchPlayerStat.count({ where: { match: { tournamentId: ids.cup } } }), 4);
    assert.equal((await ok("GET", `/players/${ids.a}`)).mmr, before.mmr, "ratings are as they were");
    assert.equal((await ok("GET", `/tournaments/${ids.cup}/stories`)).data.length, 1);
    assert.equal((await ok("GET", "/trash")).data.length, 0);
    assert.equal((await call("POST", `/trash/${item.id}/restore`)).status, 404, "it can only come back once");
  });

  test("a bracket comes back with its teams, rosters and slots", async () => {
    const t = await ok("POST", "/tournaments", { name: "Bracket Bin", startDate: "2026-11-01T12:00:00Z", format: "SINGLE_ELIMINATION", registrationOpen: true, rosterMin: 3, rosterMax: 4 });
    const teams = [];
    for (const name of ["Red", "Blue", "Green", "Gold"]) teams.push(await registerTeam(t.id, name));
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: teams.map((x) => x.id) });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    const slots = (await ok("GET", `/tournaments/${t.id}/bracket`)).matches.length;
    const roster = await prisma.rosterPlayer.count({ where: { entry: { tournamentId: t.id } } });
    assert.equal(roster, 12);

    await ok("DELETE", `/tournaments/${t.id}`);
    const [item] = (await ok("GET", "/trash")).data;
    assert.match(item.summary, /4 ทีม/);
    await ok("POST", `/trash/${item.id}/restore`);
    const view = await ok("GET", `/tournaments/${t.id}/bracket`);
    assert.equal(view.matches.length, slots);
    assert.equal(view.tournament?.bracketStatus ?? (await ok("GET", `/tournaments/${t.id}`)).bracketStatus, "LIVE");
    assert.equal(await prisma.rosterPlayer.count({ where: { entry: { tournamentId: t.id } } }), roster);
  });

  test("what was deleted since stays out; old items are purged; only admins see the bin", async () => {
    await ok("DELETE", `/tournaments/${ids.cup}`);
    await ok("DELETE", `/teams/${ids.B}`);
    const [item] = (await ok("GET", "/trash")).data;
    const back = await ok("POST", `/trash/${item.id}/restore`);
    assert.deepEqual(back.missing, { teams: 1, matches: 2 }, "the deleted team and its matches can't come back");
    assert.equal((await ok("GET", `/matches?tournamentId=${ids.cup}`)).data.length, 0);

    await ok("DELETE", `/tournaments/${ids.cup}`);
    const [old] = (await ok("GET", "/trash")).data;
    await prisma.trashItem.update({ where: { id: old.id }, data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });
    assert.equal((await ok("GET", "/trash")).data.length, 0, "older than 30 days is gone for good");

    const res = await fetch(`${base}/api/v1/trash`, { headers: { "X-API-Key": reader } });
    assert.equal(res.status, 403);
    // Removing an item for good right away.
    const cup = await ok("POST", "/tournaments", { name: "Gone Cup", startDate: "2026-01-01" });
    await ok("DELETE", `/tournaments/${cup.id}`);
    const [gone] = (await ok("GET", "/trash")).data;
    assert.equal((await call("DELETE", `/trash/${gone.id}`)).status, 204);
    assert.equal((await ok("GET", "/trash")).data.length, 0);
  });
});

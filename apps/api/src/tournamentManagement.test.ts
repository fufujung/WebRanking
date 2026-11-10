import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-management-"));
fs.writeFileSync(path.join(tmp, "test.db"), "");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db").replaceAll("\\", "/")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: process.env });
const { createApp } = await import("./app.js");
const { createApiKey } = await import("./lib/apiKeys.js");
const { prisma } = await import("./lib/db.js");
let server: Server, base: string, admin: string, reader: string;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  admin = (await createApiKey("admin", "admin")).key;
  reader = (await createApiKey("reader", "read")).key;
});
after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
async function call(method: string, url: string, body?: unknown, key: string | null = admin) {
  const response = await fetch(base + url, { method, headers: { ...(key ? { "X-API-Key": key } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const event = (data = {}) => prisma.tournament.create({ data: { name: "Editable", startDate: new Date("2027-01-01"), ...data } });

test("admin edits and clears details; public read reflects changes; writes require admin", async () => {
  const t = await event();
  for (const [key, expected] of [[null, 401], [reader, 403]] as const) {
    assert.equal((await call("PATCH", `/tournaments/${t.id}`, { name: "Denied" }, key)).status, expected);
  }
  const updated = await call("PATCH", `/tournaments/${t.id}`, { name: "Renamed", location: "Online", description: "Details", endDate: "2027-01-02" });
  assert.equal(updated.status, 200);
  const cleared = await call("PATCH", `/tournaments/${t.id}`, { location: null, description: null, endDate: null });
  assert.equal(cleared.status, 200);
  const read = await call("GET", `/tournaments/${t.id}`, undefined, reader);
  assert.equal(read.body.name, "Renamed");
  assert.equal(read.body.description, null);
  assert.equal(read.body.endDate, null);
  assert.equal((await call("PATCH", `/tournaments/${t.id}`, { endDate: "2026-01-01" })).status, 400);
});

test("participants lock identity; capacity and roster changes cannot invalidate teams", async () => {
  const t = await event();
  for (let i = 0; i < 3; i++) {
    const team = await prisma.team.create({ data: { name: `Team ${i}` } });
    await prisma.tournamentEntry.create({ data: { tournamentId: t.id, teamId: team.id, roster: { create: { player: { create: { name: `Player ${i}` } } } } } });
  }
  for (const patch of [{ entryMode: "SOLO" }, { teamSize: 4 }, { game: "Other game" }, { maxTeams: 2 }, { rosterMin: 4 }]) {
    const response = await call("PATCH", `/tournaments/${t.id}`, patch);
    assert.equal(response.status, 409, JSON.stringify(patch));
    assert.ok(response.body.details.th);
  }
  assert.equal((await prisma.game.count({ where: { name: "Other game" } })), 0, "rejected edit rolls back game creation");
  assert.equal((await call("PATCH", `/tournaments/${t.id}`, { rosterMin: 1, rosterMax: 2, maxTeams: 3, name: "Safe edit" })).status, 200);
});

test("solo signup locks mode and team size before a team exists", async () => {
  const t = await event({ entryMode: "SOLO" });
  const p = await prisma.player.create({ data: { name: "Solo" } });
  await prisma.soloSignup.create({ data: { tournamentId: t.id, playerId: p.id, position: "ALL", rank: "Gold" } });
  assert.equal((await call("PATCH", `/tournaments/${t.id}`, { entryMode: "TEAM" })).status, 409);
  assert.equal((await call("PATCH", `/tournaments/${t.id}`, { teamSize: 5 })).status, 409);
});

test("bracket lifecycle controls status; live and done rules stay locked while details stay editable", async () => {
  const t = await event({ format: "SINGLE_ELIMINATION" });
  assert.equal((await call("PATCH", `/tournaments/${t.id}`, { status: "ONGOING" })).status, 409);
  for (const bracketStatus of ["LIVE", "DONE"]) {
    await prisma.tournament.update({ where: { id: t.id }, data: { bracketStatus, status: bracketStatus === "LIVE" ? "ONGOING" : "COMPLETED" } });
    for (const patch of [{ bestOf: 5 }, { finalBestOf: 7 }, { lateMinutes: 30 }, { format: null }, { registrationOpen: true }, { status: "UPCOMING" }]) {
      assert.equal((await call("PATCH", `/tournaments/${t.id}`, patch)).status, 409, JSON.stringify(patch));
    }
    assert.equal((await call("PATCH", `/tournaments/${t.id}`, { name: "Updated live details", startDate: "2027-02-01" })).status, 200);
  }
  const free = await event();
  assert.equal((await call("PATCH", `/tournaments/${free.id}`, { status: "COMPLETED" })).status, 200);
});

test("completed formatted events preserve unchanged status when editing details", async () => {
  for (const bracketStatus of ["NONE", "DRAFT"]) {
    const t = await event({ format: "SINGLE_ELIMINATION", status: "COMPLETED", bracketStatus, registrationOpen: true });
    for (const patch of [{ description: "Updated description" }, { location: "Online", status: "COMPLETED" }]) {
      const result = await call("PATCH", `/tournaments/${t.id}`, patch);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.status, "COMPLETED");
      assert.equal(result.body.bracketStatus, bracketStatus);
      assert.equal(result.body.registrationOpen, true, "an unchanged legacy flag does not block detail edits");
    }
    assert.equal((await call("PATCH", `/tournaments/${t.id}`, { status: "ONGOING" })).status, 409, "actual status transitions remain validated");
    await call("PATCH", `/tournaments/${t.id}`, { registrationOpen: false });
    assert.equal((await call("PATCH", `/tournaments/${t.id}`, { registrationOpen: true })).status, 409, "registration cannot be reopened");
  }
});

test("legacy special events retain historical teams and capacity during detail edits", async () => {
  for (const maxTeams of [null, 2, 8]) {
    const t = await event({ special: true, format: "SINGLE_ELIMINATION", status: "COMPLETED", bracketStatus: "DRAFT", maxTeams });
    for (let i = 0; i < 3; i++) {
      const team = await prisma.team.create({ data: { name: `Legacy ${t.id} ${i}` } });
      await prisma.tournamentEntry.create({ data: { tournamentId: t.id, teamId: team.id } });
    }
    const slot = await prisma.bracketMatch.create({ data: { tournamentId: t.id, code: "W1-0", stage: "W", round: 1, position: 0, number: 1 } });
    const detail = await call("GET", `/tournaments/${t.id}`);
    assert.equal(detail.body.maxTeams, maxTeams, "reads expose the stored legacy capacity");
    for (const patch of [{ name: "Updated legacy name" }, { location: "New venue", maxTeams, status: "COMPLETED" }]) {
      const result = await call("PATCH", `/tournaments/${t.id}`, patch);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.maxTeams, maxTeams);
    }
    assert.equal(await prisma.tournamentEntry.count({ where: { tournamentId: t.id } }), 3);
    assert.ok(await prisma.bracketMatch.findUnique({ where: { id: slot.id } }));
    assert.equal((await call("PATCH", `/tournaments/${t.id}`, { maxTeams: maxTeams === 2 ? 6 : 2 })).status, 409, "capacity changes must obey new rules and current participation");
    const third = await prisma.team.create({ data: { name: `Extra legacy ${t.id}` } });
    assert.equal((await call("POST", `/tournaments/${t.id}/entries`, { teamId: third.id })).status, 409, "historical teams do not permit additional teams");
  }
});

test("converting an existing oversized event to special still enforces two teams", async () => {
  const t = await event({ maxTeams: 2 });
  for (let i = 0; i < 3; i++) {
    const team = await prisma.team.create({ data: { name: `Conversion ${t.id} ${i}` } });
    await prisma.tournamentEntry.create({ data: { tournamentId: t.id, teamId: team.id } });
  }
  assert.equal((await call("PATCH", `/tournaments/${t.id}`, { special: true })).status, 409);
  assert.equal((await prisma.tournament.findUniqueOrThrow({ where: { id: t.id } })).special, false);
});

test("changing draft shape removes draft slots and seeds only", async () => {
  const t = await event({ format: "SINGLE_ELIMINATION", bracketStatus: "DRAFT" });
  await prisma.bracketMatch.create({ data: { tournamentId: t.id, code: "W1-0", stage: "W", round: 1, position: 0, number: 1 } });
  const result = await call("PATCH", `/tournaments/${t.id}`, { format: "ROUND_ROBIN" });
  assert.equal(result.status, 200);
  assert.equal(result.body.bracketStatus, "NONE");
  assert.equal(await prisma.bracketMatch.count({ where: { tournamentId: t.id } }), 0);
});

test("moving an event into a season puts its participants on the season's list", async () => {
  const t = await event({ entryMode: "SOLO" });
  const player = await prisma.player.create({ data: { name: "Season player" } });
  await prisma.soloSignup.create({ data: { tournamentId: t.id, playerId: player.id, position: "ALL", rank: "Gold" } });
  const season = await prisma.specialSeason.create({ data: { name: "New season", startDate: new Date("2027-01-01") } });
  assert.equal((await call("PATCH", `/tournaments/${t.id}`, { seasonId: season.id })).status, 200);
  assert.ok(await prisma.seasonPlayer.findFirst({ where: { seasonId: season.id, playerId: player.id } }));
});

test("editing event dates preserves explicit match schedules", async () => {
  const t = await event({ format: "SINGLE_ELIMINATION", bracketStatus: "LIVE", status: "ONGOING" });
  const scheduledAt = new Date("2027-01-03T12:00:00Z");
  const slot = await prisma.bracketMatch.create({ data: { tournamentId: t.id, code: "W1-0", stage: "W", round: 1, position: 0, number: 1, scheduledAt } });
  assert.equal((await call("PATCH", `/tournaments/${t.id}`, { startDate: "2027-01-02", location: "New venue" })).status, 200);
  assert.deepEqual((await prisma.bracketMatch.findUniqueOrThrow({ where: { id: slot.id } })).scheduledAt, scheduledAt);
});

test("special two-side editor saves partial slots, exact player identity and names atomically", async () => {
  const t = await event({ special: true, format: "SINGLE_ELIMINATION" });
  const p = await prisma.player.create({ data: { name: "Picked existing", mmr: 1450 } });
  const payload = { teams: [
    { name: "Special Alpha", slots: [{ playerId: p.id }, null, { name: "Typed player" }] },
    { name: "Special Beta", slots: [null, null, null] },
  ] };
  assert.equal((await call("PUT", `/tournaments/${t.id}/special-teams`, payload, reader)).status, 403);
  const result = await call("PUT", `/tournaments/${t.id}/special-teams`, payload);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.teams.length, 2);
  assert.equal(result.body.teams[0].slots[0].playerId, p.id);
  assert.equal(result.body.teams[0].slots[1], null);
  assert.equal(result.body.teams[0].slots[2].name, "Typed player");
  assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: p.id } })).mmr, 1450);
  assert.equal((await prisma.tournament.findUniqueOrThrow({ where: { id: t.id } })).maxTeams, 2);
  const read = await call("GET", `/tournaments/${t.id}/special-teams`);
  assert.deepEqual(read.body, result.body);
  assert.equal((await call("POST", `/tournaments/${t.id}/bracket/seed`, {})).status, 409, "incomplete sides cannot seed");
  const sides = result.body.teams;
  sides[1].slots[0] = { playerId: p.id };
  sides[0].name = "Must roll back";
  assert.equal((await call("PUT", `/tournaments/${t.id}/special-teams`, { teams: sides })).status, 409);
  assert.equal((await call("GET", `/tournaments/${t.id}/special-teams`)).body.teams[0].name, "Special Alpha");
  sides[1].slots[0] = { name: "New opponent" };
  assert.equal((await call("PUT", `/tournaments/${t.id}/special-teams`, { teams: sides })).status, 200);
  assert.equal(await prisma.tournamentEntry.count({ where: { tournamentId: t.id } }), 2);
  const third = await prisma.team.create({ data: { name: "Third side" } });
  assert.equal((await call("POST", `/tournaments/${t.id}/entries`, { teamId: third.id })).status, 409);
  await prisma.tournament.update({ where: { id: t.id }, data: { bracketStatus: "LIVE", status: "ONGOING" } });
  assert.equal((await call("PUT", `/tournaments/${t.id}/special-teams`, { teams: sides })).status, 409);
});

test("special editor rejects wrong game and missing season membership without creating teams", async () => {
  const game = await prisma.game.create({ data: { name: "Special editor game" } });
  const season = await prisma.specialSeason.create({ data: { name: "Editor season", startDate: new Date() } });
  const t = await event({ special: true, seasonId: season.id });
  const wrong = await prisma.player.create({ data: { name: "Wrong game player", gameId: game.id } });
  const payload = { teams: [{ name: "Season side A", slots: [{ playerId: wrong.id }] }, { name: "Season side B", slots: [null] }] };
  assert.equal((await call("PUT", `/tournaments/${t.id}/special-teams`, payload)).status, 409);
  payload.teams[0].slots = [{ playerId: (await prisma.player.create({ data: { name: "Not in season" } })).id }];
  assert.equal((await call("PUT", `/tournaments/${t.id}/special-teams`, payload)).status, 403);
  assert.equal(await prisma.tournamentEntry.count({ where: { tournamentId: t.id } }), 0);
  assert.equal(await prisma.team.count({ where: { name: { in: ["Season side A", "Season side B"] } } }), 0);
});

test("scheduled status starts at the exact cutoff and preserves brackets, dates, registration and completed events", async () => {
  const { refreshTournamentStatuses } = await import("./lib/tournamentStatus.js");
  const { currentRevision } = await import("./lib/revision.js");
  const now = new Date();
  const free = await event({ startDate: now, registrationOpen: true });
  const draft = await event({ startDate: new Date(now.getTime() - 1), format: "SINGLE_ELIMINATION", bracketStatus: "DRAFT" });
  const future = await event({ startDate: new Date(now.getTime() + 60_000) });
  const completed = await event({ startDate: now, status: "COMPLETED" });
  const done = await event({ startDate: now, bracketStatus: "DONE" });
  const revision = currentRevision();
  assert.equal(await refreshTournamentStatuses(now), 2);
  assert.equal(currentRevision(), revision + 1);
  const read = await call("GET", `/tournaments/${free.id}`);
  assert.equal(read.body.status, "ONGOING");
  assert.equal(read.body.registrationOpen, true);
  assert.equal(read.body.startDate, now.toISOString());
  const draftRead = await call("GET", `/tournaments/${draft.id}`);
  assert.equal(draftRead.body.status, "ONGOING");
  assert.equal(draftRead.body.bracketStatus, "DRAFT");
  assert.equal((await call("PATCH", `/tournaments/${draft.id}`, { description: "Still editable after automatic start" })).status, 200);
  const list = await call("GET", "/tournaments?status=ONGOING&limit=100");
  assert.ok(list.body.data.some((t: { id: string }) => t.id === free.id));
  assert.equal((await prisma.tournament.findUniqueOrThrow({ where: { id: future.id } })).status, "UPCOMING");
  assert.equal((await prisma.tournament.findUniqueOrThrow({ where: { id: completed.id } })).status, "COMPLETED");
  assert.equal((await prisma.tournament.findUniqueOrThrow({ where: { id: done.id } })).status, "UPCOMING", "completed brackets are never restarted");
  const after = currentRevision();
  assert.equal(await refreshTournamentStatuses(now), 0);
  assert.equal(currentRevision(), after);
  assert.equal(await refreshTournamentStatuses(new Date(now.getTime() + 60_000)), 1);
  assert.equal((await prisma.tournament.findUniqueOrThrow({ where: { id: future.id } })).status, "ONGOING");
});

test("background status poller advances an event without any visitor request", async () => {
  const { startTournamentStatusPoller } = await import("./lib/tournamentStatus.js");
  const t = await event({ startDate: new Date(Date.now() + 50) });
  const timer = startTournamentStatusPoller();
  try {
    let status = "UPCOMING";
    for (let i = 0; i < 40 && status === "UPCOMING"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      status = (await prisma.tournament.findUniqueOrThrow({ where: { id: t.id } })).status;
    }
    assert.equal(status, "ONGOING");
  } finally { clearInterval(timer); }
});

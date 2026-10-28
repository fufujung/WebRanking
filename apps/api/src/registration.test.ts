/** Website registration uses existing teams, saved solo profiles and the shared competition rules. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-registration-"));
fs.writeFileSync(path.join(tmp, "test.db"), "");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db").replaceAll("\\", "/")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { stdio: "pipe", env: process.env });
const { createApp } = await import("./app.js");
const { createApiKey } = await import("./lib/apiKeys.js");
const { prisma } = await import("./lib/db.js");
const { backfillPlayerRanks } = await import("./lib/playerRegistration.js");
let server: Server, base: string, admin: string, reader: string;
let nextAccount = 500000;
before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  admin = (await createApiKey("registration admin", "admin")).key;
  reader = (await createApiKey("registration reader", "read")).key;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
  if (path.dirname(tmp) !== os.tmpdir() || !path.basename(tmp).startsWith("tr-registration-")) throw Error("Unexpected test directory");
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
async function call(method: string, url: string, body?: unknown, key = admin) {
  const res = await fetch(base + url, { method, headers: { "X-API-Key": key, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function team(name: string, gameId: string, size = 2) {
  const discordId = String(++nextAccount);
  const captain = await prisma.player.create({ data: { name: `${name} captain`, discordId, gameId } });
  const created = await call("POST", `/members/${discordId}/teams`, { playerId: captain.id, name });
  assert.equal(created.status, 201);
  const rest = await Promise.all(Array.from({ length: size - 1 }, (_, i) => prisma.player.create({ data: { name: `${name} mate ${i}`, discordId: String(++nextAccount), gameId, teamId: created.body.id } })));
  return { discordId, captain, members: [captain, ...rest], id: created.body.id as string };
}
async function tournament(name: string, gameId: string, extra = {}) {
  return prisma.tournament.create({ data: { name, gameId, startDate: new Date(), registrationOpen: true, rosterMin: 2, rosterMax: 3, ...extra } });
}

test("categories filter before pagination; name-only search and overview keep categories separate", async () => {
  const game = await prisma.game.create({ data: { name: "GameOnlyNeedle" } });
  await prisma.player.create({ data: { name: "PlayerOnlyNeedle" } });
  await prisma.team.create({ data: { name: "TeamOnlyNeedle" } });
  for (const special of [true, false]) for (let i = 0; i < 5; i++) await tournament(`${special ? "Special" : "Normal"} Cup ${i}`, game.id, { special, game: game.name });
  const normal = (await call("GET", "/tournaments?category=normal&limit=2")).body;
  const special = (await call("GET", "/tournaments?category=special&limit=2")).body;
  assert.equal(normal.total, 5); assert.equal(special.total, 5);
  assert.ok(normal.data.every((t: { special: boolean }) => !t.special));
  assert.ok(special.data.every((t: { special: boolean }) => t.special));
  for (const q of ["GameOnlyNeedle", "PlayerOnlyNeedle", "TeamOnlyNeedle"]) assert.deepEqual((await call("GET", `/stats/search?scope=tournaments&q=${q}`)).body, { teams: [], players: [], tournaments: [] });
  assert.equal((await call("GET", "/stats/search?q=GameOnlyNeedle")).body.tournaments.length, 10);
  assert.equal((await call("GET", "/stats/search?scope=tournaments&q=Special%20Cup")).body.tournaments.length, 5);
  const overview = (await call("GET", "/stats/overview")).body;
  assert.equal(overview.normalTournaments.length, 3); assert.equal(overview.specialTournaments.length, 3);
  assert.ok(overview.normalTournaments.every((t: { special: boolean }) => !t.special));
  assert.ok(overview.specialTournaments.every((t: { special: boolean }) => t.special));
});

test("homepage game filter selects tournaments and results before applying the limits", async () => {
  const a = await prisma.game.create({ data: { name: "Home filter game A" } });
  const b = await prisma.game.create({ data: { name: "Home filter game B" } });
  const empty = await prisma.game.create({ data: { name: "Home filter empty" } });
  const cups = await Promise.all([a, b].flatMap((game) => [false, true].flatMap((special) =>
    Array.from({ length: 4 }, (_, i) => tournament(`${game.name} ${special ? "special" : "normal"} ${i}`, game.id, { special }))
  )));
  const teamA = await prisma.team.create({ data: { name: "Home filter team A" } });
  const teamB = await prisma.team.create({ data: { name: "Home filter team B" } });
  const cupA = cups.find((cup) => cup.gameId === a.id && !cup.special)!;
  const cupB = cups.find((cup) => cup.gameId === b.id && !cup.special)!;
  await prisma.match.create({ data: { tournamentId: cupA.id, teamAId: teamA.id, teamBId: teamB.id, scoreA: 1, scoreB: 0, playedAt: new Date("2020-01-01") } });
  for (let i = 0; i < 9; i++) await prisma.match.create({ data: { tournamentId: cupB.id, teamAId: teamA.id, teamBId: teamB.id, scoreA: 1, scoreB: 0, playedAt: new Date("2025-01-01") } });

  const filtered = (await call("GET", `/stats/overview?gameId=${a.id}`)).body;
  assert.equal(filtered.normalTournaments.length, 3);
  assert.equal(filtered.specialTournaments.length, 3);
  assert.ok(filtered.normalTournaments.every((t: { gameId: string; special: boolean }) => t.gameId === a.id && !t.special));
  assert.ok(filtered.specialTournaments.every((t: { gameId: string; special: boolean }) => t.gameId === a.id && t.special));
  assert.ok(filtered.upcomingTournaments.every((t: { gameId: string }) => t.gameId === a.id));
  assert.deepEqual(filtered.recentMatches.map((match: { tournamentId: string }) => match.tournamentId), [cupA.id]);
  const carousel = (await call("GET", `/stats/overview?gameId=${a.id}&home=1`)).body;
  assert.equal(carousel.normalTournaments.length, 4);
  assert.equal(carousel.specialTournaments.length, 4);
  assert.ok(carousel.normalTournaments.every((t: { gameId: string }) => t.gameId === a.id));
  const carouselB = (await call("GET", `/stats/overview?gameId=${b.id}&home=1`)).body;
  assert.equal(carouselB.recentMatches.length, 9);
  const noResults = (await call("GET", `/stats/overview?gameId=${empty.id}`)).body;
  assert.deepEqual([noResults.normalTournaments, noResults.specialTournaments, noResults.recentMatches], [[], [], []]);
  const all = (await call("GET", "/stats/overview")).body;
  assert.equal(all.recentMatches.length, 8);
  assert.ok(all.recentMatches.every((match: { tournamentId: string }) => match.tournamentId === cupB.id));
  assert.deepEqual(filtered.totals, all.totals, "site-wide totals stay unchanged");
});

test("only a team's captain can register its real roster; retries are idempotent", async () => {
  const game = await prisma.game.create({ data: { name: "Team registration game" } });
  const own = await team("Existing team", game.id, 4);
  const t = await tournament("Roster cup", game.id);
  const url = `/members/${own.discordId}/tournaments/${t.id}/join`;
  const playerIds = own.members.slice(0, 3).map((p) => p.id);
  assert.equal((await call("POST", url, { playerId: own.captain.id, playerIds }, reader)).status, 403);
  assert.equal((await call("POST", `/members/${own.members[1].discordId}/tournaments/${t.id}/join`, { playerId: own.members[1].id })).status, 403);
  assert.equal((await call("POST", url, { playerId: own.members[1].id, playerIds })).status, 403);
  assert.equal((await call("POST", url, { playerId: own.captain.id })).status, 400);
  assert.equal((await call("POST", url, { playerId: own.captain.id, playerIds: [own.captain.id] })).status, 400);
  assert.equal((await call("POST", url, { playerId: own.captain.id, playerIds: [own.captain.id, "other-team-player"] })).status, 400);
  const first = await call("POST", url, { playerId: own.captain.id, playerIds });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.id, own.id);
  assert.deepEqual(new Set(first.body.roster.map((p: { playerId: string }) => p.playerId)), new Set(playerIds));
  assert.equal((await call("POST", url, { playerId: own.captain.id, playerIds })).status, 200);
  assert.equal(await prisma.tournamentEntry.count({ where: { tournamentId: t.id } }), 1);
  assert.equal(await prisma.player.count({ where: { teamId: own.id } }), 4, "registration does not change permanent membership");
});

test("last team slot, closed registration, different games and season eligibility are enforced", async () => {
  const game = await prisma.game.create({ data: { name: "Capacity game" } });
  const a = await team("Slot A", game.id), b = await team("Slot B", game.id);
  const t = await tournament("Last slot", game.id, { maxTeams: 1 });
  const join = (x: typeof a, id = t.id, extra = {}) => call("POST", `/members/${x.discordId}/tournaments/${id}/join`, { playerId: x.captain.id, ...extra });
  assert.deepEqual((await Promise.all([join(a), join(b)])).map((r) => r.status).sort(), [200, 409]);
  assert.equal(await prisma.tournamentEntry.count({ where: { tournamentId: t.id } }), 1);
  const closed = await tournament("Closed", game.id, { registrationOpen: false });
  assert.equal((await join(a, closed.id, { override: true })).status, 409);
  const other = await prisma.game.create({ data: { name: "Other game" } });
  const wrong = await tournament("Wrong game", other.id);
  assert.equal((await join(a, wrong.id)).status, 400);
  const season = await prisma.specialSeason.create({ data: { name: "Restricted", gameId: game.id, startDate: new Date() } });
  const restricted = await tournament("Restricted cup", game.id, { special: true, seasonId: season.id });
  assert.equal((await join(a, restricted.id)).status, 403);
});

test("solo joins require owned, valid saved details; duplicate joins and last-slot races do not overbook", async () => {
  const game = await prisma.game.create({ data: { name: "Solo game", ranks: JSON.stringify([{ name: "Gold" }, { name: "Silver" }]) } });
  const a = await prisma.player.create({ data: { name: "Solo A", gameId: game.id, discordId: String(++nextAccount) } });
  const b = await prisma.player.create({ data: { name: "Solo B", gameId: game.id, discordId: String(++nextAccount) } });
  const t = await tournament("Solo cup", game.id, { entryMode: "SOLO", maxTeams: 1, teamSize: 2 });
  const join = (p: typeof a) => call("POST", `/members/${p.discordId}/solo/${t.id}/join`, { playerId: p.id, position: "CENTER", rank: "Gold" });
  assert.equal((await join(a)).status, 400, "request cannot replace missing saved profile");
  assert.equal((await call("POST", `/members/${b.discordId}/player-profile`, { playerId: a.id, position: "GUARD", inGameRank: "Gold" })).status, 403);
  assert.equal((await call("POST", `/members/${a.discordId}/player-profile`, { playerId: a.id, position: "GUARD", inGameRank: "Retired" })).status, 400);
  for (const p of [a, b]) assert.equal((await call("POST", `/members/${p.discordId}/player-profile`, { playerId: p.id, position: "GUARD", inGameRank: "Gold" })).status, 200);
  assert.equal((await join(a)).status, 200);
  assert.equal((await join(a)).status, 200);
  assert.equal((await prisma.soloSignup.findFirstOrThrow({ where: { tournamentId: t.id, playerId: a.id } })).position, "GUARD");
  const c = await prisma.player.create({ data: { name: "Solo C", gameId: game.id, discordId: String(++nextAccount), role: "FORWARD", inGameRank: "Silver" } });
  assert.deepEqual((await Promise.all([join(b), join(c)])).map((r) => r.status).sort(), [200, 409]);
  assert.equal(await prisma.soloSignup.count({ where: { tournamentId: t.id } }), 2);
  await prisma.tournament.update({ where: { id: t.id }, data: { registrationOpen: false } });
  assert.equal((await join(a)).status, 200, "already joined survives closure");
  assert.equal(await prisma.soloSignup.count({ where: { tournamentId: t.id } }), 2);
});

test("backfill uses valid same-game history and never overwrites a saved profile or old signups", async () => {
  const game = await prisma.game.create({ data: { name: "History game", ranks: JSON.stringify([{ name: "Gold" }]) } });
  const p = await prisma.player.create({ data: { name: "History player", gameId: game.id } });
  const t = await tournament("History solo", game.id, { entryMode: "SOLO" });
  await prisma.soloSignup.create({ data: { tournamentId: t.id, playerId: p.id, position: "CENTER", rank: "Gold" } });
  await backfillPlayerRanks();
  assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: p.id } })).inGameRank, "Gold");
  await prisma.player.update({ where: { id: p.id }, data: { role: "GUARD" } });
  await backfillPlayerRanks();
  assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: p.id } })).role, "GUARD");
  assert.equal((await prisma.soloSignup.findFirstOrThrow({ where: { playerId: p.id } })).position, "CENTER");
  const invalid = await prisma.player.create({ data: { name: "Invalid history", gameId: game.id } });
  await prisma.soloSignup.create({ data: { tournamentId: t.id, playerId: invalid.id, position: "CENTER", rank: "Retired" } });
  await backfillPlayerRanks();
  assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: invalid.id } })).inGameRank, null);
});

test("prediction search finds eligible tournaments beyond the initial list and supports direct links", async () => {
  const teamA = await prisma.team.create({ data: { name: "Picker fixture A" } });
  const teamB = await prisma.team.create({ data: { name: "Picker fixture B" } });
  const tournamentIds: string[] = [];
  for (let index = 0; index < 31; index++) {
    const tournament = await prisma.tournament.create({ data: { name: `Picker fixture ${String(index).padStart(2, "0")}`, startDate: new Date(Date.UTC(2000, 0, index + 1)), status: "UPCOMING" } });
    tournamentIds.push(tournament.id);
    await prisma.tournamentEntry.createMany({ data: [{ tournamentId: tournament.id, teamId: teamA.id }, { tournamentId: tournament.id, teamId: teamB.id }] });
    await prisma.market.create({ data: { tournamentId: tournament.id, key: "fixture-pair", kind: "CUSTOM", teamIds: JSON.stringify([teamA.id, teamB.id]) } });
  }
  const first = await call("GET", "/predict/tournaments");
  assert.equal(first.body.data.length, 30);
  assert.ok(!first.body.data.some((t: { id: string }) => t.id === tournamentIds[30]));
  const search = await call("GET", "/predict/tournaments?search=Picker%20fixture%2030");
  assert.equal(search.body.data[0].id, tournamentIds[30]);
  const direct = await call("GET", `/predict/tournaments?id=${tournamentIds[30]}`);
  assert.equal(direct.body.data[0].id, tournamentIds[30]);
});

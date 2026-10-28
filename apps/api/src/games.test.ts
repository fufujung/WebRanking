/** Games (MMR and rankings per game) and teams run by their own players. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-games-test-"));
fs.writeFileSync(path.join(tmp, "test.db"), "");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db").replaceAll("\\", "/")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: process.env });

const { createApp } = await import("./app.js");
const { createApiKey } = await import("./lib/apiKeys.js");
const { prisma } = await import("./lib/db.js");
const { backfillGames } = await import("./lib/games.js");

let server: Server;
let base: string;
let admin: string;
let reader: string;

async function call(method: string, url: string, body?: unknown, key = admin) {
  const headers: Record<string, string> = { "X-API-Key": key };
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}/api/v1${url}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

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

describe("games", () => {
  test("data from before games: a tournament's game name becomes a game everyone joins", async () => {
    const t = await prisma.tournament.create({ data: { name: "Old Cup", game: "Street Rivals", startDate: new Date("2026-09-01") } });
    const team = await prisma.team.create({ data: { name: "Old Team" } });
    const loner = await prisma.player.create({ data: { name: "Loner" } });
    await backfillGames();
    const games = (await ok("GET", "/games")).data;
    assert.deepEqual(games.map((g: { name: string }) => g.name), ["Street Rivals"]);
    const gid = games[0].id;
    assert.equal((await prisma.tournament.findUnique({ where: { id: t.id } }))!.gameId, gid);
    assert.equal((await prisma.team.findUnique({ where: { id: team.id } }))!.gameId, gid);
    assert.equal((await prisma.player.findUnique({ where: { id: loner.id } }))!.gameId, gid, "with one game, everyone joins it");
  });

  test("organizers add, rename and delete games; names are unique; a game in use cannot be deleted", async () => {
    assert.equal((await call("POST", "/games", { name: "Valorant" }, reader)).status, 403);
    const v = await ok("POST", "/games", { name: "Valorant" });
    assert.equal((await call("POST", "/games", { name: "valorant " })).status, 409);
    const sr = (await ok("GET", "/games")).data.find((g: { name: string }) => g.name === "Street Rivals");
    assert.equal((await call("DELETE", `/games/${sr.id}`)).status, 409);
    const renamed = await ok("PATCH", `/games/${v.id}`, { name: "Valorant PC" });
    assert.equal(renamed.name, "Valorant PC");
    const t = await ok("POST", "/tournaments", { name: "VCT Mini", gameId: v.id, startDate: "2026-10-01" });
    assert.equal(t.game, "Valorant PC");
    await ok("PATCH", `/games/${v.id}`, { name: "Valorant" });
    assert.equal((await ok("GET", `/tournaments/${t.id}`)).game, "Valorant", "renaming a game renames it on its tournaments");
    // Older clients send a game name: it is matched to the existing game.
    const byName = await ok("POST", "/tournaments", { name: "VCT Mini 2", game: "VALORANT", startDate: "2026-10-02" });
    assert.equal(byName.gameId, v.id);
    const empty = await ok("POST", "/games", { name: "Chess" });
    assert.equal((await call("DELETE", `/games/${empty.id}`)).status, 204);
  });

  test("MMR ladder and player rank are per game", async () => {
    const games = (await ok("GET", "/games")).data as { id: string; name: string }[];
    const sr = games.find((g) => g.name === "Street Rivals")!;
    const val = games.find((g) => g.name === "Valorant")!;
    const mk = async (name: string, gameId: string) => (await ok("POST", "/teams", { name, gameId })).id as string;
    const pl = async (name: string, teamId: string, gameId: string) => (await ok("POST", "/players", { name, teamId, gameId })).id as string;
    const srA = await mk("SR Alpha", sr.id), srB = await mk("SR Bravo", sr.id);
    const vA = await mk("V Alpha", val.id), vB = await mk("V Bravo", val.id);
    const p = { a: await pl("Sr1", srA, sr.id), b: await pl("Sr2", srB, sr.id), c: await pl("V1", vA, val.id), d: await pl("V2", vB, val.id) };
    const srCup = await ok("POST", "/tournaments", { name: "SR Cup", gameId: sr.id, startDate: "2026-10-01" });
    const vCup = await ok("POST", "/tournaments", { name: "V Cup", gameId: val.id, startDate: "2026-10-01" });
    for (let i = 0; i < 3; i++) {
      await ok("POST", "/matches", { tournamentId: srCup.id, teamAId: srA, teamBId: srB, playedAt: `2026-10-0${i + 2}T12:00:00Z`, games: [{ scoreA: 21, scoreB: 10, players: [line("A", p.a), line("B", p.b)] }] });
      await ok("POST", "/matches", { tournamentId: vCup.id, teamAId: vA, teamBId: vB, playedAt: `2026-10-0${i + 2}T12:00:00Z`, games: [{ scoreA: 13, scoreB: 5, players: [line("A", p.c), line("B", p.d)] }] });
    }
    const srBoard = await ok("GET", `/rankings/mmr?gameId=${sr.id}`);
    assert.deepEqual(srBoard.data.map((r: { name: string }) => r.name), ["Sr1", "Sr2"]);
    const vBoard = await ok("GET", `/rankings/mmr?gameId=${val.id}`);
    assert.deepEqual(vBoard.data.map((r: { name: string }) => r.name), ["V1", "V2"]);
    assert.equal((await ok("GET", "/rankings/mmr")).data.length, 4, "no gameId: every game, as before");
    const v1 = await ok("GET", `/players/${p.c}`);
    assert.equal(v1.mmrRank, 1);
    assert.equal(v1.rankedPlayers, 2);
    assert.equal(v1.game.name, "Valorant");
    assert.equal((await ok("GET", `/rankings/teams?gameId=${val.id}`)).data.length, 2);
    assert.equal((await ok("GET", `/teams/${vB}`)).rank, 2, "team rank counts only teams of the same game");
  });

  test("players and teams added by sign-up or results take the tournament's game", async () => {
    const val = (await ok("GET", "/games")).data.find((g: { name: string }) => g.name === "Valorant");
    const t = await ok("POST", "/tournaments", { name: "Open Signup", gameId: val.id, startDate: "2026-10-05", registrationOpen: true });
    await ok("POST", `/tournaments/${t.id}/registrations`, { teamName: "Walk-in Five", players: [{ name: "Walker 1" }, { name: "Walker 2" }, { name: "Walker 3" }] });
    const team = await prisma.team.findFirst({ where: { name: "Walk-in Five" } });
    assert.equal(team!.gameId, val.id);
    assert.equal(await prisma.player.count({ where: { name: { startsWith: "Walker" }, gameId: val.id } }), 3);
  });
});

describe("teams run by their players", () => {
  const ME = "111111111111111111", YOU = "222222222222222222", THEM = "333333333333333333";
  let gid: string;
  let other: string;
  const claim = async (who: string, uid: string, name: string, gameId = gid) => (await ok("POST", `/players/discord/${who}/claim`, { uid, name, gameId })).id as string;
  const me = async (who: string) => (await ok("GET", `/members/${who}`)).data;

  before(async () => {
    gid = (await ok("GET", "/games")).data.find((g: { name: string }) => g.name === "Street Rivals").id;
    other = (await ok("GET", "/games")).data.find((g: { name: string }) => g.name === "Valorant").id;
  });

  test("with several games, claiming a new character needs its game", async () => {
    const res = await call("POST", `/players/discord/${ME}/claim`, { uid: "50000001", name: "NoGame" });
    assert.equal(res.status, 400);
    assert.equal(res.body.details.needsGame, true);
  });

  test("create a team, invite with a code, join, kick, hand over the lead and leave", async () => {
    const mine = await claim(ME, "50000002", "Capt");
    const yours = await claim(YOU, "50000003", "Mate");
    const theirs = await claim(THEM, "50000004", "Third");
    const elsewhere = await claim(THEM, "50000005", "OtherGame", other);

    assert.equal((await call("POST", `/members/${YOU}/teams`, { playerId: mine, name: "Not Yours" })).status, 403);
    assert.equal((await call("POST", `/members/${ME}/teams`, { playerId: mine, name: "SR Alpha" })).status, 409, "name taken");
    const team = await ok("POST", `/members/${ME}/teams`, { playerId: mine, name: "Self Made", tag: "SM" });
    assert.equal(team.captainId, mine);
    assert.equal(team.gameId, gid);
    const [card] = await me(ME);
    assert.equal(card.team.isCaptain, true);
    const code = card.team.inviteCode;
    assert.match(code, /^[2-9A-HJ-NP-Z]{8}$/);
    assert.equal((await ok("GET", `/teams/${team.id}`)).invite, undefined, "the code never shows on public team pages");
    assert.equal((await call("GET", `/members/invites/${code}`, undefined, reader)).status, 403);
    assert.equal((await ok("GET", `/members/invites/${code.toLowerCase()}`)).name, "Self Made");

    assert.equal((await call("POST", `/members/${YOU}/join`, { playerId: yours, code: "WRONGCODE" })).status, 404);
    await ok("POST", `/members/${YOU}/join`, { playerId: yours, code });
    assert.equal((await call("POST", `/members/${YOU}/join`, { playerId: yours, code })).status, 409, "already in");
    assert.equal((await call("POST", `/members/${THEM}/join`, { playerId: elsewhere, code })).status, 400, "another game");
    await ok("POST", `/members/${THEM}/join`, { playerId: theirs, code });
    const [yourCard] = await me(YOU);
    assert.equal(yourCard.team.isCaptain, false);
    assert.equal(yourCard.team.inviteCode, null, "only the captain sees the invite code");
    assert.equal(yourCard.team.members.length, 3);

    assert.equal((await call("POST", `/members/${YOU}/kick`, { playerId: yours, memberId: theirs })).status, 403, "only the captain kicks");
    await ok("POST", `/members/${ME}/kick`, { playerId: mine, memberId: theirs });
    assert.equal((await prisma.player.findUnique({ where: { id: theirs } }))!.teamId, null);

    const fresh = await ok("POST", `/members/${ME}/invite`, { playerId: mine });
    assert.notEqual(fresh.code, code);
    assert.equal((await call("POST", `/members/${THEM}/join`, { playerId: theirs, code })).status, 404, "the old link stops working");

    await ok("POST", `/members/${ME}/captain`, { playerId: mine, memberId: yours });
    assert.equal((await me(YOU))[0].team.isCaptain, true);
    assert.equal((await call("POST", `/members/${ME}/kick`, { playerId: mine, memberId: yours })).status, 403, "no longer captain");

    // The captain leaving hands the lead on; the last one out leaves a team with no captain.
    await ok("POST", `/members/${YOU}/leave`, { playerId: yours });
    assert.equal((await prisma.team.findUnique({ where: { id: team.id } }))!.captainId, mine);
    await ok("POST", `/members/${ME}/leave`, { playerId: mine });
    const left = await prisma.team.findUnique({ where: { id: team.id } });
    assert.equal(left!.captainId, null);
    assert.equal((await call("POST", `/members/${ME}/leave`, { playerId: mine })).status, 409);
  });

  test("organizers set a team's captain and share its invite code", async () => {
    const team = await ok("POST", "/teams", { name: "Org Team", gameId: gid });
    const p = await ok("POST", "/players", { name: "Org Player", teamId: team.id, gameId: gid });
    const outsider = await ok("POST", "/players", { name: "Outsider", gameId: gid });
    assert.equal((await call("PATCH", `/teams/${team.id}`, { captainId: outsider.id })).status, 400);
    assert.equal((await ok("PATCH", `/teams/${team.id}`, { captainId: p.id })).captainId, p.id);
    const { code } = await ok("GET", `/teams/${team.id}/invite`);
    assert.equal((await ok("GET", `/teams/${team.id}/invite`)).code, code, "same code until a new one is asked for");
    assert.notEqual((await ok("GET", `/teams/${team.id}/invite?new=1`)).code, code);
    assert.equal((await call("GET", `/teams/${team.id}/invite`, undefined, reader)).status, 403);
  });

  test("a team made by an organizer gets its first joiner as captain", async () => {
    const team = await ok("POST", "/teams", { name: "No Lead", gameId: gid });
    const { code } = await ok("GET", `/teams/${team.id}/invite`);
    const joiner = await claim("444444444444444444", "50000009", "Joiner");
    await ok("POST", "/members/444444444444444444/join", { playerId: joiner, code });
    assert.equal((await prisma.team.findUnique({ where: { id: team.id } }))!.captainId, joiner);
  });
});

describe("game on teams and players", () => {
  test("admin forms set a game by id; an unknown id is refused", async () => {
    const g = await ok("POST", "/games", { name: "Form Game" });
    const team = await ok("POST", "/teams", { name: "Form Team", gameId: g.id });
    assert.equal(team.gameId, g.id);
    assert.equal((await call("POST", "/teams", { name: "Bad Game Team", gameId: "nope" })).status, 400);
    const player = await ok("POST", "/players", { name: "Form Player", gameId: g.id });
    assert.equal(player.gameId, g.id);
    assert.equal((await call("PATCH", `/players/${player.id}`, { gameId: "nope" })).status, 400);
    const cleared = await ok("PATCH", `/teams/${team.id}`, { gameId: null });
    assert.equal(cleared.gameId, null);
    // A tournament picks an existing game by id; its name follows.
    const t = await ok("POST", "/tournaments", { name: "Form Cup", gameId: g.id, startDate: new Date().toISOString() });
    assert.equal(t.game, "Form Game");
  });
});

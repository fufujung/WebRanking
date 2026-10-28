/** Seasons of the special "เล่นเก่งปากเก่ง" events: who may play in each, and the season boards. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-seasons-test-"));
fs.writeFileSync(path.join(tmp, "test.db"), "");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db").replaceAll("\\", "/")}`;
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

const line = (side: "A" | "B", playerId: string, pts = 5, award: string | null = null) => ({ side, playerId, pts, reb: 1, blk: 0, stl: 0, ast: 1, lbr: 0, award });

const R = "รุ่นแห่งปาฏิหาริย์";

describe("special seasons (เล่นเก่งปากเก่ง)", () => {
  let kuroko: string;
  let dunk: string;
  let season: { id: string; name: string };
  let kite: string;
  let lynx: string;
  let outsider: string;

  test("organizers create a season; readers cannot; bad dates and names are explained in Thai", async () => {
    kuroko = (await ok("POST", "/games", { name: "Kuroko Street Rivals" })).id;
    dunk = (await ok("POST", "/games", { name: "Dunk City Dynasty" })).id;
    await ok("PATCH", `/games/${kuroko}`, { ranks: ["ฟ้า", "โซน"].map((name) => ({ name, iconUrl: null })) });
    assert.equal((await call("POST", "/special/seasons", { name: "Season 1", gameId: kuroko, startDate: "2026-10-01" }, reader)).status, 403);
    const noName = await call("POST", "/special/seasons", { name: " ", startDate: "2026-10-01" });
    assert.equal(noName.status, 400);
    assert.match(noName.body.details.th, /ชื่อซีซั่น/);
    const backwards = await call("POST", "/special/seasons", { name: "S", startDate: "2026-10-10", endDate: "2026-10-01" });
    assert.equal(backwards.status, 400);
    assert.match(backwards.body.details.th, /วันจบ/);
    season = await ok("POST", "/special/seasons", { name: "Season 1", gameId: kuroko, startDate: "2026-10-01", endDate: "2026-12-31" });
    assert.equal((await ok("GET", "/special/seasons")).data[0].name, "Season 1");
  });

  test("players are pasted one per line as name + UID; known UIDs join, new ones are created, problems are listed", async () => {
    // Kite already exists (claimed on the website): the paste joins him without renaming him.
    kite = (await ok("POST", "/players/discord/111111111111111111/claim", { uid: "81000108", name: "Kite", gameId: kuroko })).id;
    const ghostOfOtherGame = (await ok("POST", "/players", { name: "Dunker", uid: "99990000", gameId: dunk })).id;
    const res = await ok("POST", `/special/seasons/${season.id}/players`, {
      text: ["Kite ตัวจริง 81000108", "UID: 7730586, Lynx", "", "Moss\t5550001", "Ghost", "12345678", "Dunker 99990000"].join("\n"),
    });
    assert.deepEqual(res.added.map((a: { name: string; created: boolean }) => [a.name, a.created]), [["Kite", false], ["Lynx", true], ["Moss", true]]);
    assert.deepEqual(res.problems.map((p: { line: number; reason: string }) => p.line), [5, 6, 7]);
    assert.match(res.problems[0].reason, /ไม่พบ UID/);
    assert.match(res.problems[1].reason, /ใส่ชื่อ/);
    assert.match(res.problems[2].reason, /เกมอื่น/);
    lynx = res.added[1].id;
    assert.equal((await prisma.player.findUnique({ where: { id: lynx } }))!.gameId, kuroko, "new players join the season's game");
    assert.equal((await prisma.player.findUnique({ where: { id: kite } }))!.name, "Kite");
    assert.ok(ghostOfOtherGame);

    // Pasting again adds nobody twice; rows work too.
    const again = await ok("POST", `/special/seasons/${season.id}/players`, { players: [{ uid: "7730586" }, { playerId: kite }] });
    assert.equal(again.added.length, 0);
    assert.equal(again.already, 2);
    assert.equal((await call("POST", `/special/seasons/${season.id}/players`, { players: [{ uid: "1" }] }, reader)).status, 403);

    const view = await ok("GET", `/special/seasons/${season.id}`);
    assert.deepEqual(view.players.map((p: { name: string }) => p.name), ["Kite", "Lynx", "Moss"]);
    assert.equal((await ok("GET", "/special/seasons")).data[0].players, 3);
  });

  test("a season's event is special and in the season's game; only players on the list may sign up or be on a roster", async () => {
    const other = await call("POST", "/tournaments", { name: "Wrong game", startDate: "2026-10-05", gameId: dunk, seasonId: season.id });
    assert.equal(other.status, 400);
    assert.match(other.body.details.th, /เกมอื่น/);
    const solo = await ok("POST", "/tournaments", { name: "S1 Solo", startDate: "2026-10-05", entryMode: "SOLO", registrationOpen: true, seasonId: season.id });
    assert.equal(solo.special, true, "a season makes the event special");
    assert.equal(solo.gameId, kuroko, "and gives it the season's game");
    assert.equal((await ok("GET", `/tournaments/${solo.id}`)).season.name, "Season 1");

    // Solo sign-up: someone not on the list is refused with the reason.
    const stranger = "333333333333333333";
    outsider = (await ok("POST", `/players/discord/${stranger}/claim`, { uid: "4440001", name: "Outsider", gameId: kuroko })).id;
    const refused = await call("POST", `/members/${stranger}/solo/${solo.id}`, { playerId: outsider, position: "GUARD", rank: "ฟ้า" });
    assert.equal(refused.status, 403);
    assert.match(refused.body.details.th, /Outsider \(UID 4440001\) ยังไม่มีชื่อในรายชื่อ Season 1/);
    await ok("POST", `/members/111111111111111111/solo/${solo.id}`, { playerId: kite, position: "GUARD", rank: "โซน" });

    // Team registration and roster changes: one outsider refuses the whole roster and nothing is saved.
    const teams = await ok("POST", "/tournaments", { name: "S1 Teams", startDate: "2026-10-06", registrationOpen: true, rosterMin: 1, seasonId: season.id });
    const bad = await call("POST", `/tournaments/${teams.id}/registrations`, { teamName: "Mixed", players: [{ name: "Kite", uid: "81000108" }, { name: "Outsider", uid: "4440001" }] });
    assert.equal(bad.status, 403);
    assert.match(bad.body.details.th, /Outsider/);
    assert.equal(await prisma.tournamentEntry.count({ where: { tournamentId: teams.id } }), 0);
    const good = await ok("POST", `/tournaments/${teams.id}/registrations`, { teamName: "Owls", players: [{ name: "Kite", uid: "81000108" }, { name: "Lynx", uid: "7730586" }] });
    const swap = await call("PUT", `/tournaments/${teams.id}/entries/${good.id}/roster`, { players: [{ name: "Outsider", uid: "4440001" }], override: true });
    assert.equal(swap.status, 403, "organizers too: add the player to the season first");
    // Once on the list, the same change goes through.
    await ok("POST", `/special/seasons/${season.id}/players`, { players: [{ playerId: outsider }] });
    await ok("PUT", `/tournaments/${teams.id}/entries/${good.id}/roster`, { players: [{ name: "Outsider", uid: "4440001" }], override: true });

    // A non-special event ignores seasons; unticking special drops the season.
    const off = await ok("PATCH", `/tournaments/${teams.id}`, { special: false });
    assert.equal(off.seasonId, null);
    await ok("PATCH", `/tournaments/${teams.id}`, { seasonId: season.id });
    assert.equal((await ok("GET", `/tournaments/${teams.id}`)).special, true);
  });

  test("the season board shows its own players, events and stats; the MMR carries on from earlier events", async () => {
    const a = (await ok("POST", "/teams", { name: "Side A" })).id;
    const b = (await ok("POST", "/teams", { name: "Side B" })).id;
    const line = (side: "A" | "B", playerId: string, pts: number) => ({ side, playerId, pts, reb: 1, blk: 0, stl: 0, ast: 1, lbr: 0, award: null });
    const series = (tournamentId: string, day: number, winner: string, loser: string) =>
      ok("POST", "/matches", { tournamentId, teamAId: a, teamBId: b, playedAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`, games: [{ scoreA: 21, scoreB: 10, players: [line("A", winner, 20), line("B", loser, 10)] }] });
    // An event before seasons existed: Outsider beats Kite three times.
    const old = await ok("POST", "/tournaments", { name: "Before seasons", startDate: "2026-09-01", gameId: kuroko, special: true });
    for (let i = 1; i <= 3; i++) await series(old.id, 10 + i, outsider, kite);
    const kiteBefore = (await prisma.player.findUnique({ where: { id: kite } }))!.specialMmr;
    assert.ok(kiteBefore < 1000);
    // In Season 1, Kite beats Lynx three times.
    const s1 = (await ok("GET", `/special/seasons/${season.id}`)).tournaments.find((t: { name: string }) => t.name === "S1 Solo");
    for (let i = 1; i <= 3; i++) await series(s1.id, 20 + i, kite, lynx);

    const all = await ok("GET", `/special?gameId=${kuroko}`);
    assert.equal(all.season, null);
    assert.equal(all.currentSeasonId, season.id);
    assert.deepEqual(all.seasons.map((s: { name: string }) => s.name), ["Season 1"]);
    assert.equal(all.events.length, 3);

    const board = await ok("GET", `/special?seasonId=${season.id}`);
    assert.equal(board.season.name, "Season 1");
    assert.equal(board.season.players, 4);
    assert.deepEqual(board.events.map((e: { name: string }) => e.name).sort(), ["S1 Solo", "S1 Teams"]);
    assert.deepEqual(board.stats.map((s: { name: string; stats: { pts: number } }) => [s.name, s.stats.pts]), [["Kite", 60], ["Lynx", 30]], "only the season's games count");
    const kiteNow = (await prisma.player.findUnique({ where: { id: kite } }))!.specialMmr;
    // The ladder: Season 1 players only, ranked 1, 2 … among themselves; the MMR is not reset.
    assert.deepEqual(board.ranked.map((r: { name: string; rank: number }) => [r.rank, r.name]), [[1, "Outsider"], [2, "Kite"], [3, "Lynx"]]);
    assert.equal(board.ranked[1].mmr, kiteNow);
    assert.ok(kiteNow > kiteBefore && kiteNow < 1000 + 100, "the season continues from the earlier MMR");
    assert.equal((await call("GET", "/special?seasonId=nope")).status, 404);
  });

  test("deleting a season keeps its events without a season", async () => {
    assert.equal((await call("DELETE", `/special/seasons/${season.id}/players/${lynx}`)).status, 204);
    assert.equal((await call("DELETE", `/special/seasons/${season.id}/players/${lynx}`)).status, 404);
    assert.equal((await call("DELETE", `/special/seasons/${season.id}`, undefined, reader)).status, 403);
    assert.equal((await call("DELETE", `/special/seasons/${season.id}`)).status, 204);
    assert.equal(await prisma.tournament.count({ where: { seasonId: { not: null } } }), 0);
    assert.equal(await prisma.tournament.count({ where: { name: { startsWith: "S1" } } }), 2);
    assert.equal(await prisma.seasonPlayer.count(), 0);
  });
});

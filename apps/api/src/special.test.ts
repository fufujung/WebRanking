/** The special "เล่นเก่งปากเก่ง" events: the always-open substitutes list and the separate MMR and stats. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-special-test-"));
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
  fs.rmSync(tmp, { recursive: true, force: true });
});

const line = (side: "A" | "B", playerId: string, pts = 5, award: string | null = null) => ({ side, playerId, pts, reb: 1, blk: 0, stl: 0, ast: 1, lbr: 0, award });

const R = "รุ่นแห่งปาฏิหาริย์";

describe("special events (เล่นเก่งปากเก่ง)", () => {
  const bank = "111111111111111111";
  const dew = "222222222222222222";
  let bankPlayer: string;
  let dewPlayer: string;

  test("members sign up with character, UID, Facebook, optional phone and position; contact stays private", async () => {
    bankPlayer = (await ok("POST", `/players/discord/${bank}/claim`, { uid: "100100", name: "Bank" })).id;
    dewPlayer = (await ok("POST", `/players/discord/${dew}/claim`, { uid: "200200", name: "Dew" })).id;

    // Facebook is required, the position must be one of the four, the phone may be left out.
    const noFb = await call("POST", `/members/${bank}/reserve`, { playerId: bankPlayer, position: "GUARD", rank: R });
    assert.equal(noFb.status, 400);
    assert.match(noFb.body.details.th, /Facebook/);
    const badPos = await call("POST", `/members/${bank}/reserve`, { playerId: bankPlayer, position: "Goalkeeper", facebook: "Bank OT", rank: R });
    assert.equal(badPos.status, 400);
    assert.match(badPos.body.details.th, /ตำแหน่ง/);
    const badPhone = await call("POST", `/members/${bank}/reserve`, { playerId: bankPlayer, position: "GUARD", facebook: "Bank OT", phone: "call me", rank: R });
    assert.equal(badPhone.status, 400);
    assert.match(badPhone.body.details.th, /เบอร์/);
    // The rank is required and must be one of the game's ranks (the same list as solo tournaments).
    const ranks = (await ok("GET", "/special/ranks")).data.map((r: { name: string }) => r.name);
    assert.ok(ranks.includes(R));
    const noRank = await call("POST", `/members/${bank}/reserve`, { playerId: bankPlayer, position: "GUARD", facebook: "Bank OT" });
    assert.equal(noRank.status, 400);
    assert.match(noRank.body.details.th, /แรงค์/);
    const badRank = await call("POST", `/members/${bank}/reserve`, { playerId: bankPlayer, position: "GUARD", facebook: "Bank OT", rank: "ฟ้า" });
    assert.equal(badRank.status, 400);
    assert.match(badRank.body.details.th, /เจ้าแห่ง ZONE/, "the error lists the ranks to pick from");
    // Discord checks the form before asking for the rank; nothing is saved.
    const check = (who: string, body: object, key?: string) => call("POST", `/members/${who}/reserve/check`, body, key);
    assert.equal((await check("999999999999999999", { uid: "999", name: "Zed", position: "GUARD", facebook: "Zed" })).status, 204);
    assert.equal((await check("999999999999999999", { uid: "999", name: "Zed", position: "GUARD", facebook: "https://evil.example" })).status, 400);
    assert.equal((await check("999999999999999999", { uid: "100100", name: "Zed", position: "GUARD", facebook: "Zed" })).status, 409, "Bank's UID");
    assert.equal((await check(bank, { uid: "100100", position: "GUARD", facebook: "Bank" })).status, 204, "Bank's own UID");
    assert.equal((await check("999999999999999999", { uid: "999", name: "Zed", position: "GUARD", facebook: "Zed" }, reader)).status, 403);
    assert.equal((await ok("GET", "/players/discord/999999999999999999")).data.length, 0, "checking creates no character");
    assert.equal((await ok("GET", "/special/reserve")).data.length, 0);
    // A link must be a Facebook link.
    for (const facebook of ["https://evil.example/login", "javascript:alert(1)//facebook.com", "www.fakebook.com/bank", "https://facebook.com.evil.io/x"]) {
      const r = await call("POST", `/members/${bank}/reserve`, { playerId: bankPlayer, position: "GUARD", facebook, rank: R });
      assert.equal(r.status, 400, facebook);
    }
    // Signing up by UID links or creates the character, but only once the form is right.
    const carlId = "555555555555555555";
    assert.equal((await call("POST", `/members/${carlId}/reserve`, { uid: "555555", name: "Carl", position: "GUARD", facebook: "x", rank: R })).status, 400);
    assert.equal((await ok("GET", `/players/discord/${carlId}`)).data.length, 0, "a bad form creates no character");
    assert.equal((await call("POST", `/members/${carlId}/reserve`, { uid: "100100", name: "Fake Bank", position: "GUARD", facebook: "Carl", rank: R })).status, 409, "Bank's UID is linked to Bank");
    const byUid = (await ok("POST", `/members/${carlId}/reserve`, { uid: "555555", name: "Carl", position: "GUARD", facebook: "Carl C", rank: R })).data;
    assert.equal(byUid.player.name, "Carl");
    assert.equal(byUid.player.uid, "555555");
    assert.equal((await call("DELETE", `/members/${carlId}/reserve`)).status, 204);

    // Someone else's character is refused.
    assert.equal((await call("POST", `/members/${dew}/reserve`, { playerId: bankPlayer, position: "GUARD", facebook: "Dew", rank: R })).status, 403);

    // "บอลหลัก" is the Thai word for Guard.
    const mine = (await ok("POST", `/members/${bank}/reserve`, { playerId: bankPlayer, position: "บอลหลัก", facebook: "https://www.facebook.com/bank.ot", phone: "081-234-5678", rank: "เจ้าแห่ง ZONE" })).data;
    assert.equal(mine.rank, "เจ้าแห่ง ZONE");
    assert.equal(mine.position, "GUARD");
    assert.equal(mine.facebook, "https://www.facebook.com/bank.ot");
    assert.equal(mine.phone, "081-234-5678");
    assert.equal((await prisma.player.findUnique({ where: { id: bankPlayer } }))!.role, "GUARD", "the position is the player's position on the site too");
    await ok("POST", `/members/${dew}/reserve`, { playerId: dewPlayer, position: "FORWARD", facebook: "Dew Rivals", rank: R });

    // Signing up again changes the details instead of adding a second row.
    await ok("POST", `/members/${dew}/reserve`, { playerId: dewPlayer, position: "CENTER", facebook: "Dew Rivals", phone: "", rank: R });
    const pub = (await ok("GET", "/special/reserve")).data;
    assert.deepEqual(pub.map((r: { player: { name: string }; position: string }) => [r.player.name, r.position]), [["Bank", "GUARD"], ["Dew", "CENTER"]]);
    for (const r of pub) {
      assert.equal(r.facebook, undefined, "the public list has no Facebook");
      assert.equal(r.phone, undefined, "the public list has no phone");
      assert.equal(r.discordId, undefined, "the public list has no Discord account");
    }
    // A read-only key (another website) sees the public list but not the private one.
    assert.equal((await call("GET", "/special/reserve", undefined, reader)).status, 200);
    assert.equal((await call("GET", "/special/reserve/private", undefined, reader)).status, 403);
    assert.equal((await call("GET", "/special", undefined, reader)).body.reserve[0].facebook, undefined);
    const priv = (await ok("GET", "/special/reserve/private")).data;
    assert.equal(priv[0].facebook, "https://www.facebook.com/bank.ot");
    assert.equal(priv[0].discordId, bank);
    assert.equal(priv[1].phone, null);
    // Members can't write with a read key.
    assert.equal((await call("POST", `/members/${dew}/reserve`, { playerId: dewPlayer, position: "CENTER", facebook: "Dew", rank: R }, reader)).status, 403);
  });

  test("organizers fix or remove sign-ups; members leave on their own", async () => {
    const fixed = await ok("PATCH", `/special/reserve/${dewPlayer}`, { position: "ALL", phone: "0899999999" });
    assert.equal(fixed.position, "ALL");
    assert.equal(fixed.phone, "0899999999");
    assert.equal(fixed.facebook, "Dew Rivals", "fields left out are kept");
    assert.equal((await call("PATCH", `/special/reserve/${dewPlayer}`, { facebook: "https://evil.example" })).status, 400);
    assert.equal((await call("PATCH", `/special/reserve/${dewPlayer}`, { rank: "ไม่มีแรงค์นี้" })).status, 400);
    assert.equal((await ok("PATCH", `/special/reserve/${dewPlayer}`, { rank: "เจ้าแห่ง ZONE" })).rank, "เจ้าแห่ง ZONE");
    assert.equal((await call("PATCH", `/special/reserve/${dewPlayer}`, { position: "CENTER" }, reader)).status, 403);
    assert.equal((await call("DELETE", `/special/reserve/${dewPlayer}`, undefined, reader)).status, 403);

    assert.equal((await call("DELETE", `/members/${dew}/reserve`)).status, 204);
    assert.equal((await call("DELETE", `/members/${dew}/reserve`)).status, 404);
    assert.equal((await ok("GET", `/members/${dew}/reserve`)).data, null);
    await ok("POST", `/members/${dew}/reserve`, { playerId: dewPlayer, position: "FORWARD", facebook: "Dew Rivals", rank: R });
    assert.equal((await call("DELETE", `/special/reserve/${dewPlayer}`)).status, 204);
    assert.equal((await ok("GET", "/special/reserve")).data.length, 1);
  });

  test("the old Discord list is carried over by UID, once", async () => {
    const carl = "333333333333333333";
    const r = await ok("POST", "/special/reserve/import", {
      players: [
        { discordId: carl, name: "Carl", uid: "300300", server: "Asia", rank: "แดง" },
        { discordId: bank, name: "Bank", uid: "100100", rank: "ทอง" },
        { discordId: "444444444444444444", name: "Thief", uid: "100100", rank: "ฟ้า" },
      ],
    });
    assert.equal(r.added, 1);
    assert.equal(r.skipped.length, 2, "Bank is on the list already and the UID 100100 belongs to Bank's account");
    const carlRow = (await ok("GET", "/special/reserve/private")).data.find((x: { discordId: string }) => x.discordId === carl);
    assert.equal(carlRow.rank, "แดง");
    assert.equal(carlRow.position, null, "filled in when Carl edits the sign-up");
    assert.equal(carlRow.player.uid, "300300");
    assert.equal((await ok("POST", "/special/reserve/import", { players: [{ discordId: carl, name: "Carl", uid: "300300" }] })).added, 0);
  });

  test("special events have their own MMR and stats and never touch the main ranking", async () => {
    const teamA = (await ok("POST", "/teams", { name: "Main A" })).id;
    const teamB = (await ok("POST", "/teams", { name: "Main B" })).id;
    const sa = (await ok("POST", "/teams", { name: "Special A" })).id;
    const sb = (await ok("POST", "/teams", { name: "Special B" })).id;
    const main = await ok("POST", "/tournaments", { name: "Main Cup", startDate: "2026-10-01" });
    const fun = await ok("POST", "/tournaments", { name: "เล่นเก่งปากเก่ง #1", startDate: "2026-10-01", special: true });
    assert.equal(fun.special, true);
    assert.equal(main.special, false);

    // Bank loses three main series to Dew, then wins three special ones.
    for (let i = 0; i < 3; i++) {
      await ok("POST", "/matches", { tournamentId: main.id, teamAId: teamA, teamBId: teamB, playedAt: `2026-10-0${i + 2}T12:00:00Z`, games: [{ scoreA: 5, scoreB: 21, players: [line("A", bankPlayer, 5), line("B", dewPlayer, 21)] }] });
    }
    const mainBank = (await prisma.player.findUnique({ where: { id: bankPlayer } }))!;
    const before = { teamA: (await ok("GET", `/teams/${teamA}`)).rating, mmr: mainBank.mmr };
    assert.ok(before.mmr < 1000);
    assert.equal(mainBank.specialMmr, 1000);
    for (let i = 0; i < 3; i++) {
      await ok("POST", "/matches", { tournamentId: fun.id, teamAId: sa, teamBId: sb, playedAt: `2026-10-0${i + 5}T12:00:00Z`, games: [{ scoreA: 21, scoreB: 9, players: [line("A", bankPlayer, 30, "MVP"), line("B", dewPlayer, 9)] }] });
    }
    const bankNow = (await prisma.player.findUnique({ where: { id: bankPlayer } }))!;
    assert.equal(bankNow.mmr, before.mmr, "special wins don't move the main MMR");
    assert.ok(bankNow.specialMmr > 1000, "they move the special MMR");
    assert.equal(bankNow.specialPeakMmr, bankNow.specialMmr);
    assert.equal((await ok("GET", `/teams/${sa}`)).rating, 1000, "nor any team rating");
    assert.equal((await ok("GET", `/teams/${teamA}`)).rating, before.teamA);

    // Main boards: the special series and stat lines are not there.
    const mainBoard = await ok("GET", "/rankings/mmr");
    const bankMain = mainBoard.data.find((r: { id: string }) => r.id === bankPlayer);
    assert.equal(bankMain.series, 3);
    assert.equal(bankMain.mmr, before.mmr);
    assert.deepEqual(bankMain.form, ["L", "L", "L"]);
    const mainStats = (await ok("GET", "/rankings/players")).data.find((r: { id: string }) => r.id === bankPlayer);
    assert.equal(mainStats.stats.pts, 15);
    assert.equal(mainStats.stats.mvp, 0);
    const mainTeams = (await ok("GET", "/rankings/teams")).data;
    assert.equal(mainTeams.find((t: { id: string }) => t.id === sa).stats.matches, 0);
    const profile = await ok("GET", `/players/${bankPlayer}`);
    assert.equal(profile.series, 3);
    assert.equal(profile.stats.pts, 15);
    assert.equal(profile.mmrHistory.length, 3);
    assert.equal(profile.special.mmr, bankNow.specialMmr);
    assert.equal(profile.special.series, 3);
    assert.equal(profile.special.stats.pts, 90);
    assert.equal(profile.special.rank, 1);

    // The special board: its own ladder, stats and events.
    const board = await ok("GET", "/special");
    assert.deepEqual(board.ranked.map((r: { name: string }) => r.name), ["Bank", "Dew"]);
    assert.equal(board.ranked[0].mmr, bankNow.specialMmr);
    assert.deepEqual(board.ranked[0].form, ["W", "W", "W"]);
    assert.equal(board.stats[0].name, "Bank");
    assert.equal(board.stats[0].stats.pts, 90);
    assert.equal(board.stats[0].stats.mvp, 3);
    assert.deepEqual(board.events.map((e: { name: string; matches: number }) => [e.name, e.matches]), [["เล่นเก่งปากเก่ง #1", 3]]);
    assert.equal(board.rules.start, 1000);

    // Dew never played a special event... until now; and a profile without one has special = null.
    const other = (await ok("POST", "/players", { name: "Nobody" })).id;
    assert.equal((await ok("GET", `/players/${other}`)).special, null);

    // Unticking "special" moves the results back into the main ranking.
    await ok("PATCH", `/tournaments/${fun.id}`, { special: false });
    const moved = (await prisma.player.findUnique({ where: { id: bankPlayer } }))!;
    assert.ok(moved.mmr > before.mmr);
    assert.equal(moved.specialMmr, 1000);
    assert.equal((await ok("GET", "/special")).ranked.length, 0);
    await ok("PATCH", `/tournaments/${fun.id}`, { special: true });
    assert.equal((await prisma.player.findUnique({ where: { id: bankPlayer } }))!.mmr, before.mmr);
  });

  test("each game keeps its own list: a character only shows in its own game, one sign-up per account in each game", async () => {
    const kuroko = (await ok("POST", "/games", { name: "Kuroko Street Rivals" })).id;
    const dunk = (await ok("POST", "/games", { name: "Dunk City Dynasty" })).id;
    await ok("PATCH", `/games/${kuroko}`, { ranks: ["ฟ้า", "โซน"].map((name) => ({ name, iconUrl: null })) });
    await ok("PATCH", `/games/${dunk}`, { ranks: ["Rookie", "Pro"].map((name) => ({ name, iconUrl: null })) });
    const fon = "777777777777777777";
    const kChar = (await ok("POST", `/players/discord/${fon}/claim`, { uid: "K-1", name: "Fon Kuroko", gameId: kuroko })).id;
    const dChar = (await ok("POST", `/players/discord/${fon}/claim`, { uid: "D-1", name: "Fon Dunk", gameId: dunk })).id;

    await ok("POST", `/members/${fon}/reserve`, { playerId: kChar, position: "GUARD", facebook: "Fon", rank: "โซน" });
    // Ranks are the character's own game's ranks.
    const wrongGame = await call("POST", `/members/${fon}/reserve`, { playerId: dChar, position: "CENTER", facebook: "Fon", rank: "โซน" });
    assert.equal(wrongGame.status, 400);
    assert.match(wrongGame.body.details.th, /Rookie, Pro/);
    await ok("POST", `/members/${fon}/reserve`, { playerId: dChar, position: "CENTER", facebook: "Fon", rank: "Pro" });
    assert.equal((await ok("GET", `/members/${fon}/reserves`)).data.length, 2, "one sign-up in each game");

    const names = async (gameId: string) => (await ok("GET", `/special/reserve?gameId=${gameId}`)).data.map((r: { player: { name: string } }) => r.player.name);
    assert.deepEqual(await names(kuroko), ["Fon Kuroko"]);
    assert.deepEqual(await names(dunk), ["Fon Dunk"]);
    assert.deepEqual((await ok("GET", `/special?gameId=${dunk}`)).reserve.map((r: { player: { name: string } }) => r.player.name), ["Fon Dunk"]);
    assert.deepEqual((await ok("GET", `/special?gameId=${dunk}`)).ranks.map((r: { name: string }) => r.name), ["Rookie", "Pro"]);
    assert.equal((await ok("GET", `/members/${fon}/reserve?gameId=${dunk}`)).data.player.name, "Fon Dunk");

    // A new character signed up by UID joins the game asked for.
    const gai = "888888888888888888";
    const byUid = (await ok("POST", `/members/${gai}/reserve`, { uid: "D-2", name: "Gai", gameId: dunk, position: "ALL", facebook: "Gai", rank: "Rookie" })).data;
    assert.deepEqual(await names(dunk), ["Fon Dunk", "Gai"]);
    assert.equal((await prisma.player.findUnique({ where: { id: byUid.playerId } }))!.gameId, dunk);

    // Leaving one game keeps the other.
    assert.equal((await call("DELETE", `/members/${fon}/reserve?gameId=${dunk}`)).status, 204);
    assert.deepEqual(await names(dunk), ["Gai"]);
    assert.deepEqual(await names(kuroko), ["Fon Kuroko"]);
  });
});

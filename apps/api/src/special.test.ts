/** The special "เล่นเก่งปากเก่ง" events: the substitutes of each season and the separate MMR and stats. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-special-test-"));
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

describe("special events (เล่นเก่งปากเก่ง)", () => {
  const bank = "111111111111111111";
  const dew = "222222222222222222";
  let bankPlayer: string;
  let dewPlayer: string;

  test("members sign up with character, UID, Facebook, optional phone and position; contact stays private", async () => {
    // Sign-ups go to a season that takes substitutes; with only one open it needs no choice.
    const closed = await call("POST", `/members/${bank}/reserve/check`, { uid: "100100", name: "Bank", position: "GUARD", facebook: "Bank OT" });
    assert.equal(closed.status, 409, "no season takes substitutes yet");
    assert.match(closed.body.details.th, /ยังไม่เปิดรับตัวสำรอง/);
    await ok("POST", "/special/seasons", { name: "ซีซั่น 1", startDate: "2026-01-01", reserveOpen: true });
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
    // A character that exists without a Discord owner waits for an organizer instead of signing up.
    const orphan = await ok("POST", "/players", { name: "Dora", uid: "565656" });
    const waits = await call("POST", `/members/${carlId}/reserve`, { uid: "565656", position: "GUARD", facebook: "Carl C", rank: R });
    assert.equal(waits.status, 409);
    assert.equal(waits.body.details.pending, true);
    assert.equal((await ok("GET", `/players/${orphan.id}`)).discordId, null);
    const [request] = (await ok("GET", "/players/link-requests")).data;
    assert.equal(request.player.id, orphan.id);
    await ok("POST", `/players/link-requests/${request.id}/deny`);
    assert.equal((await call("DELETE", `/players/${orphan.id}`)).status, 204);

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

describe("organizers pick players from the list", () => {
  test("a team is registered by picking players: name, UID and Discord come from their profile and sign-up", async () => {
    const gameId = (await ok("GET", "/games")).data[0].id;
    const kite = (await ok("POST", "/players/discord/333333333333333333/claim", { uid: "930300", name: "Kite", gameId })).id;
    const moss = (await ok("POST", "/players", { name: "Moss", uid: "940400", gameId })).id;
    const t = await ok("POST", "/tournaments", { name: "Picked Cup", startDate: "2026-11-01T12:00:00Z", format: "SINGLE_ELIMINATION", rosterMin: 1, rosterMax: 3, special: true });
    const entry = await ok("POST", `/tournaments/${t.id}/registrations`, { teamName: "Picked", players: [{ playerId: kite }, { playerId: moss }], override: true });
    assert.deepEqual(
      entry.roster.map((r: any) => [r.playerId, r.name, r.uid, r.discordId]),
      [[kite, "Kite", "930300", "333333333333333333"], [moss, "Moss", "940400", null]],
    );
    const twice = await call("POST", `/tournaments/${t.id}/registrations`, { teamName: "Again", players: [{ playerId: kite }], override: true });
    assert.equal(twice.status, 409, "a player can be on one team only");
    const gone = await call("POST", `/tournaments/${t.id}/registrations`, { teamName: "Ghosts", players: [{ playerId: "nope" }], override: true });
    assert.equal(gone.status, 404);
    assert.match(gone.body.details.th, /ไม่พบผู้เล่นที่เลือก/);
    // The roster editor can pick too.
    const fixed = await ok("PUT", `/tournaments/${t.id}/entries/${entry.id}/roster`, { players: [{ playerId: moss }], override: true });
    assert.deepEqual(fixed.roster.map((r: any) => r.name), ["Moss"]);
  });
});

describe("story posts (ต้นเรื่อง)", () => {
  test("organizers keep an ordered list of Facebook posts per event; other links are refused", async () => {
    const t = await ok("POST", "/tournaments", { name: "Story Cup", startDate: "2026-11-02T12:00:00Z", special: true });
    const saved = await ok("PUT", `/tournaments/${t.id}/stories`, {
      stories: [
        { title: "ตอนที่ 1 จุดเริ่มดราม่า", url: "https://www.facebook.com/overtime/posts/123" },
        { title: "", url: "https://fb.watch/abcDEF/" },
      ],
    });
    assert.deepEqual(saved.data.map((s: any) => [s.title, s.position]), [["ตอนที่ 1 จุดเริ่มดราม่า", 0], [null, 1]]);
    // Reorder and remove by saving the list again.
    await ok("PUT", `/tournaments/${t.id}/stories`, { stories: [{ url: "https://fb.watch/abcDEF/" }] });
    assert.deepEqual((await ok("GET", `/tournaments/${t.id}/stories`)).data.map((s: any) => s.url), ["https://fb.watch/abcDEF/"]);
    for (const url of ["https://evil.example/facebook.com", "http://www.facebook.com/x", "https://facebook.com.evil.example/x", "javascript:alert(1)"]) {
      const bad = await call("PUT", `/tournaments/${t.id}/stories`, { stories: [{ url }] });
      assert.equal(bad.status, 400, url);
      assert.match(bad.body.details.th, /โพสต์ที่ 1: ใส่ลิงก์โพสต์ Facebook/);
    }
    assert.equal((await call("PUT", `/tournaments/${t.id}/stories`, { stories: [] }, reader)).status, 403);
    assert.equal((await call("GET", `/tournaments/${t.id}/stories`, undefined, reader)).status, 200);
    const listed = (await ok("GET", "/special/stories")).data.find((x: any) => x.id === t.id);
    assert.equal(listed.stories.length, 1);
  });

  test("a season keeps its own story posts, before it has any event", async () => {
    const season = await ok("POST", "/special/seasons", { name: "Story Season", startDate: "2026-11-01T00:00:00Z" });
    const saved = await ok("PUT", `/special/seasons/${season.id}/stories`, { stories: [{ title: "เปิดซีซั่น", url: "https://www.facebook.com/ot/posts/9" }] });
    assert.deepEqual(saved.data.map((s: any) => s.title), ["เปิดซีซั่น"]);
    assert.equal((await call("PUT", `/special/seasons/${season.id}/stories`, { stories: [{ url: "https://evil.example/" }] })).status, 400);
    assert.equal((await call("PUT", `/special/seasons/${season.id}/stories`, { stories: [] }, reader)).status, 403);
    assert.equal((await call("PUT", "/special/seasons/nope/stories", { stories: [] })).status, 404);
    const all = await ok("GET", "/special/stories");
    assert.equal(all.seasons.find((x: any) => x.id === season.id).stories[0].url, "https://www.facebook.com/ot/posts/9");
    const one = await ok("GET", `/special/stories?seasonId=${season.id}`);
    assert.deepEqual([one.data.length, one.seasons.length], [0, 1]);
    // Deleting the season takes its posts with it.
    await ok("DELETE", `/special/seasons/${season.id}`);
    assert.equal(await prisma.tournamentStory.count({ where: { seasonId: season.id } }), 0);
  });
});

describe("substitutes sign up season by season", () => {
  test("members pick an open season, keep their details for the next, and leave one season at a time", async () => {
    const game = (await ok("POST", "/games", { name: "Season Game" })).id;
    await ok("PATCH", `/games/${game}`, { ranks: ["A", "B"].map((name) => ({ name, iconUrl: null })) });
    // Only this game's seasons count: the open season of no game from the first tests is closed here.
    for (const x of (await ok("GET", "/special/seasons")).data.filter((x: any) => !x.gameId && x.reserveOpen)) await ok("PATCH", `/special/seasons/${x.id}`, { reserveOpen: false });
    const s1 = await ok("POST", "/special/seasons", { name: "S1", gameId: game, startDate: "2026-02-01", reserveOpen: true });
    const s2 = await ok("POST", "/special/seasons", { name: "S2", gameId: game, startDate: "2026-06-01", reserveOpen: true });
    const kai = "919191919191919191";
    const kaiChar = (await ok("POST", `/players/discord/${kai}/claim`, { uid: "S-1", name: "Kai", gameId: game })).id;
    const form = { playerId: kaiChar, position: "GUARD", facebook: "Kai", rank: "A" };

    // Two open seasons: the member has to choose, and the answer lists them.
    const choose = await call("POST", `/members/${kai}/reserve`, form);
    assert.equal(choose.status, 400);
    assert.deepEqual(choose.body.details.seasons.map((x: any) => x.name), ["S2", "S1"]);
    assert.equal(await prisma.reservePlayer.count({ where: { playerId: kaiChar } }), 0, "nothing saved");

    const joined = (await ok("POST", `/members/${kai}/reserve`, { ...form, seasonId: s1.id })).data;
    assert.deepEqual([joined.joinedSeason.name, joined.seasons.map((x: any) => x.name)], ["S1", ["S1"]]);
    // Signing up again for the next season keeps the first one.
    assert.deepEqual((await ok("POST", `/members/${kai}/reserve`, { ...form, seasonId: s2.id })).data.seasons.map((x: any) => x.name), ["S2", "S1"]);
    assert.deepEqual((await ok("GET", `/members/${kai}/reserve?gameId=${game}`)).data.seasons.map((x: any) => x.name), ["S2", "S1"]);

    // Each season shows its own substitutes; the board of a season too.
    const names = async (q: string) => (await ok("GET", `/special/reserve?${q}`)).data.map((r: any) => r.player.name);
    const dee = "929292929292929292";
    const deeChar = (await ok("POST", `/players/discord/${dee}/claim`, { uid: "S-2", name: "Dee", gameId: game })).id;
    await ok("POST", `/members/${dee}/reserve`, { playerId: deeChar, position: "CENTER", facebook: "Dee", rank: "B", seasonId: s2.id });
    assert.deepEqual(await names(`seasonId=${s1.id}`), ["Kai"]);
    assert.deepEqual(await names(`seasonId=${s2.id}`), ["Kai", "Dee"]);
    assert.deepEqual(await names(`gameId=${game}`), ["Kai", "Dee"], "without a season: everyone of the game");
    const board = await ok("GET", `/special?seasonId=${s1.id}`);
    assert.deepEqual(board.reserve.map((r: any) => r.player.name), ["Kai"]);
    assert.deepEqual(board.reserveSeasons.map((x: any) => x.name), ["S2", "S1"]);

    // A closed season takes no sign-ups; a season of another game neither.
    await ok("PATCH", `/special/seasons/${s1.id}`, { reserveOpen: false });
    const shut = await call("POST", `/members/${dee}/reserve`, { playerId: deeChar, position: "CENTER", facebook: "Dee", rank: "B", seasonId: s1.id });
    assert.equal(shut.status, 409);
    assert.match(shut.body.details.th, /ปิดรับตัวสำรอง/);
    assert.equal((await call("POST", `/members/${dee}/reserve/check`, { playerId: deeChar, position: "CENTER", facebook: "Dee", seasonId: s1.id })).status, 409, "the Discord form is stopped before the rank question");
    const other = await ok("POST", "/special/seasons", { name: "Other", gameId: (await ok("POST", "/games", { name: "Other Game" })).id, startDate: "2026-06-01", reserveOpen: true });
    assert.equal((await call("POST", `/members/${dee}/reserve`, { playerId: deeChar, position: "CENTER", facebook: "Dee", rank: "B", seasonId: other.id })).status, 400);
    // Someone on the list who names no season only edits their details, even with no season open for them.
    const edited = (await ok("POST", `/members/${dee}/reserve`, { playerId: deeChar, position: "ALL", facebook: "Dee", rank: "B" })).data;
    assert.deepEqual([edited.joinedSeason, edited.position, edited.seasons.map((x: any) => x.name)], [null, "ALL", ["S2"]]);
    // A newcomer with one open season left gets it without asking.
    const eve = "949494949494949494";
    const eveChar = (await ok("POST", `/players/discord/${eve}/claim`, { uid: "S-3", name: "Eve", gameId: game })).id;
    assert.equal((await ok("POST", `/members/${eve}/reserve`, { playerId: eveChar, position: "ALL", facebook: "Eve", rank: "A" })).data.joinedSeason.name, "S2");
    await ok("DELETE", `/members/${eve}/reserve?gameId=${game}`);

    // Leaving one season keeps the details and the other season.
    assert.equal((await call("DELETE", `/members/${kai}/reserve?gameId=${game}&seasonId=${s2.id}`)).status, 204);
    assert.equal((await call("DELETE", `/members/${kai}/reserve?gameId=${game}&seasonId=${s2.id}`)).status, 404);
    assert.deepEqual(await names(`seasonId=${s2.id}`), ["Dee"]);
    assert.deepEqual((await ok("GET", `/members/${kai}/reserve?gameId=${game}`)).data.seasons.map((x: any) => x.name), ["S1"]);

    // Organizers put anyone on a season's list (even a closed one) or take them off; read keys cannot.
    await ok("PUT", `/special/seasons/${s2.id}/reserve/${kaiChar}`);
    await ok("PUT", `/special/seasons/${s2.id}/reserve/${kaiChar}`);
    assert.deepEqual(await names(`seasonId=${s2.id}`), ["Kai", "Dee"]);
    await ok("DELETE", `/special/seasons/${s1.id}/reserve/${kaiChar}`);
    assert.deepEqual(await names(`seasonId=${s1.id}`), []);
    assert.equal((await call("PUT", `/special/seasons/${s1.id}/reserve/${kaiChar}`, undefined, reader)).status, 403);
    assert.equal((await call("PUT", `/special/seasons/${other.id}/reserve/${kaiChar}`)).status, 400, "another game's season");
    assert.equal((await call("PUT", `/special/seasons/nope/reserve/${kaiChar}`)).status, 404);
    assert.equal((await ok("GET", "/special/seasons")).data.find((x: any) => x.id === s2.id).reserves, 2);

    // Deleting a season takes only its list; the details stay.
    await ok("DELETE", `/special/seasons/${s2.id}`);
    assert.equal(await prisma.reservePlayer.count({ where: { playerId: { in: [kaiChar, deeChar] } } }), 2);
  });

  test("once, everyone already on the list joins the latest season of their game, which opens", async () => {
    const { backfillReserveSeasons } = await import("./lib/special.js");
    const game = (await ok("POST", "/games", { name: "Backfill Game" })).id;
    const old = await prisma.specialSeason.create({ data: { name: "Old", gameId: game, startDate: new Date("2025-01-01") } });
    const latest = await prisma.specialSeason.create({ data: { name: "Latest", gameId: game, startDate: new Date("2026-03-01") } });
    const p = await prisma.player.create({ data: { name: "Old timer", uid: "B-1", gameId: game } });
    await prisma.reservePlayer.create({ data: { playerId: p.id, discordId: "939393939393939393", rank: "x" } });
    await prisma.siteSetting.deleteMany({ where: { key: "reserveSeasonsBackfilled" } });
    await prisma.seasonReserve.deleteMany({ where: { playerId: p.id } });

    assert.ok((await backfillReserveSeasons()) >= 1);
    assert.deepEqual((await prisma.seasonReserve.findMany({ where: { playerId: p.id } })).map((r) => r.seasonId), [latest.id]);
    assert.equal((await prisma.specialSeason.findUnique({ where: { id: latest.id } }))!.reserveOpen, true);
    assert.equal((await prisma.specialSeason.findUnique({ where: { id: old.id } }))!.reserveOpen, false);
    // Only once: someone who later leaves stays out.
    await prisma.seasonReserve.deleteMany({ where: { playerId: p.id } });
    assert.equal(await backfillReserveSeasons(), 0);
    assert.equal(await prisma.seasonReserve.count({ where: { playerId: p.id } }), 0);
  });
});

describe("site settings (Discord invite button)", () => {
  test("admins set the Discord invite; only discord.gg / discord.com/invite links are taken", async () => {
    assert.deepEqual(await ok("GET", "/settings"), { discordInvite: null });
    assert.equal((await ok("PATCH", "/settings", { discordInvite: "discord.gg/OverTime" })).discordInvite, "https://discord.gg/OverTime");
    assert.equal((await ok("PATCH", "/settings", { discordInvite: "https://discord.com/invite/abc-123" })).discordInvite, "https://discord.com/invite/abc-123");
    for (const bad of ["https://evil.example/discord.gg/x", "http://discord.gg/abc", "https://discord.gg.evil.example/abc", "javascript:alert(1)", "https://discord.gg/abc?x=<script>"]) {
      const res = await call("PATCH", "/settings", { discordInvite: bad });
      assert.equal(res.status, 400, bad);
      assert.match(res.body.details.th, /ลิงก์เชิญ Discord/);
    }
    assert.equal((await call("PATCH", "/settings", { discordInvite: "https://discord.gg/abc" }, reader)).status, 403);
    assert.equal((await call("GET", "/settings", undefined, reader)).body.discordInvite, "https://discord.com/invite/abc-123");
    // Sending nothing changes nothing; "" clears it.
    assert.equal((await ok("PATCH", "/settings", {})).discordInvite, "https://discord.com/invite/abc-123");
    assert.equal((await ok("PATCH", "/settings", { discordInvite: "" })).discordInvite, null);
  });
});

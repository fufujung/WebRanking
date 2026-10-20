/** The prediction game: free coins, picks on matches and champions, settling, refunds and prizes. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-black-test-"));
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

let n = 0;
const discord = () => String(100000000000000000n + BigInt(++n));

async function newTournament(extra: Record<string, unknown> = {}) {
  return ok("POST", "/tournaments", { name: `Cup ${++n}`, startDate: "2026-11-01T12:00:00Z", format: "SINGLE_ELIMINATION", registrationOpen: true, rosterMin: 3, rosterMax: 4, ...extra });
}

async function registerTeam(tid: string, name: string, captain = discord()) {
  return ok("POST", `/tournaments/${tid}/registrations`, {
    teamName: name,
    captainDiscordId: captain,
    players: [1, 2, 3].map((i) => ({ name: `${name} P${i}`, discordId: i === 1 ? captain : discord() })),
  });
}

const markets = (tid: string, who?: string) => ok("GET", `/predict/tournaments/${tid}${who ? `?discordId=${who}` : ""}`);
const wallet = (who: string) => ok("GET", `/predict/members/${who}`);
const bet = (who: string, marketId: string, teamId: string, amount: number) => call("POST", `/predict/members/${who}/bets`, { marketId, teamId, amount });
const soon = () => new Date(Date.now() + 3600_000).toISOString();

describe("predictions", () => {
  const alice = discord();
  const bob = discord();
  const carol = discord();

  test("the first daily claim gives the welcome coins plus the daily coins, once per Thai day", async () => {
    const first = await ok("POST", `/predict/members/${alice}/daily`, { name: "Alice" });
    assert.equal(first.amount, 20);
    assert.equal(first.coins, 120, "100 welcome + 20 daily");
    assert.equal(first.welcome, 100);
    const again = await call("POST", `/predict/members/${alice}/daily`, {});
    assert.equal(again.status, 409);
    assert.match(again.body.details.th, /วันนี้รับเหรียญไปแล้ว/);
    // Yesterday's claim keeps the streak going.
    await prisma.predictor.update({ where: { discordId: alice }, data: { lastDaily: new Date(Date.now() + 7 * 3600_000 - 86400_000).toISOString().slice(0, 10), streak: 3 } });
    const streak = await ok("POST", `/predict/members/${alice}/daily`, {});
    assert.equal(streak.streak, 4);
    assert.equal(streak.amount, 26);
    const w = await wallet(alice);
    assert.equal(w.coins, 146);
    assert.equal(w.dailyClaimed, true);
    for (const who of [bob, carol]) await ok("POST", `/predict/members/${who}/daily`, { name: who === bob ? "Bob" : "Carol" });
  });

  test("watching gives coins only while a tournament is live, and not too often", async () => {
    const idle = await ok("POST", `/predict/members/${bob}/watch`, {});
    assert.equal(idle.amount, 0);
    assert.equal(idle.live, false);
  });

  test("a match opens once both teams and a start time are known; players cannot pick their own game", async () => {
    const t = await newTournament();
    const capA = discord();
    const a = await registerTeam(t.id, "Aces", capA);
    const b = await registerTeam(t.id, "Bulls");
    let view = await markets(t.id);
    const champ = view.markets.find((m: any) => m.kind === "CHAMPION");
    assert.ok(champ?.open, "the champion pick is open during sign-ups");
    const listed = (await ok("GET", "/predict/tournaments")).data.find((x: any) => x.id === t.id);
    assert.equal(listed.open, 1);
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: [a.id, b.id] });
    view = await markets(t.id);
    const m1 = view.markets.find((m: any) => m.kind === "MATCH");
    assert.ok(m1);
    assert.equal(m1.open, false, "no start time yet");
    const early = await bet(alice, m1.id, a.id, 10);
    assert.equal(early.status, 409);
    assert.match(early.body.details.th, /ยังไม่ได้ตั้งเวลา/);

    // Champion picks before the start.
    assert.equal((await bet(carol, champ.id, b.id, 20)).status, 200);
    const own = await bet(capA, champ.id, b.id, 10);
    assert.equal(own.status, 403);
    assert.match(own.body.details.th, /ทายแชมป์ไม่ได้/);

    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    await ok("POST", `/tournaments/${t.id}/bracket/schedule`, { match: "M1", scheduledAt: soon() });
    view = await markets(t.id);
    assert.equal(view.markets.find((m: any) => m.kind === "CHAMPION").open, false, "the champion pick closes when play starts");
    const match = view.markets.find((m: any) => m.kind === "MATCH");
    assert.equal(match.open, true);

    const mine = await bet(capA, match.id, b.id, 10);
    assert.equal(mine.status, 403);
    assert.match(mine.body.details.th, /ทายแมตช์ของตัวเองไม่ได้/);
    const broke = await bet(alice, match.id, a.id, 100000);
    assert.equal(broke.status, 400);
    assert.match(broke.body.details.th, /เหรียญไม่พอ/);
    const bad = await call("POST", `/predict/members/${alice}/bets`, { marketId: match.id, teamId: a.id, amount: 0 });
    assert.equal(bad.status, 400);
    assert.match(bad.body.details.th, /จำนวนเหรียญ/);

    // Alice 40 on Aces (then changes to 60), Bob 30 on Bulls, Carol 30 on Aces.
    assert.equal((await bet(alice, match.id, a.id, 40)).status, 200);
    const changed = await bet(alice, match.id, a.id, 60);
    assert.equal(changed.body.coins, 146 - 60);
    assert.equal((await bet(bob, match.id, b.id, 30)).status, 200);
    assert.equal((await bet(carol, match.id, a.id, 30)).status, 200);
    view = await markets(t.id, alice);
    const split = view.markets.find((m: any) => m.kind === "MATCH");
    assert.equal(split.pool, 120);
    assert.deepEqual(split.options.map((o: any) => o.percent), [75, 25]);
    assert.deepEqual(split.mine, { teamId: a.id, amount: 60, payout: null });
    // Readers see the split but never one person's pick.
    assert.equal((await call("GET", `/predict/tournaments/${t.id}?discordId=${alice}`, undefined, reader)).status, 403);

    // While live, watching pays.
    const watched = await ok("POST", `/predict/members/${bob}/watch`, {});
    assert.equal(watched.amount, 2);
    assert.equal((await ok("POST", `/predict/members/${bob}/watch`, {})).amount, 0, "too soon");

    // The match locks at its start time.
    await prisma.market.update({ where: { id: match.id }, data: { locksAt: new Date(Date.now() - 1000) } });
    await prisma.bracketMatch.updateMany({ where: { tournamentId: t.id, code: match.key }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    const late = await bet(bob, match.id, b.id, 5);
    assert.equal(late.status, 409);
    assert.match(late.body.details.th, /ปิดทาย/);

    // Aces win: the 30 coins of Bulls fans go to Aces fans by stake (60:30 → 20 and 10).
    const before = { alice: (await wallet(alice)).coins, bob: (await wallet(bob)).coins, carol: (await wallet(carol)).coins };
    await ok("POST", `/tournaments/${t.id}/bracket/matches/M1/result`, { scoreA: 2, scoreB: 0 });
    let after = { alice: (await wallet(alice)).coins, bob: (await wallet(bob)).coins, carol: (await wallet(carol)).coins };
    assert.equal(after.alice - before.alice, 80);
    assert.equal(after.carol - before.carol, 40 + 20, "and the champion pick comes back");
    assert.equal(after.bob - before.bob, 0);
    // The final is over: Aces are champions, nobody picked them, so Carol's 20 on Bulls comes back.
    view = await markets(t.id);
    const champDone = view.markets.find((m: any) => m.kind === "CHAMPION");
    assert.equal(champDone.status, "REFUNDED", "nobody picked the champion: stakes come back");

    const board = await ok("GET", `/predict/leaderboard?tournamentId=${t.id}`, undefined);
    assert.deepEqual(board.data.map((r: any) => [r.name, r.net]), [["Alice", 20], ["Carol", 10], ["Bob", -30]]);

    // Reopening the result takes the winnings back; a walkover then refunds everyone.
    await ok("POST", `/tournaments/${t.id}/bracket/matches/M1/reopen`, { force: true });
    after = { alice: (await wallet(alice)).coins, bob: (await wallet(bob)).coins, carol: (await wallet(carol)).coins };
    assert.deepEqual(after, before, "every pick is open again, coins back to staked");
    await ok("POST", `/tournaments/${t.id}/bracket/matches/M1/walkover`, { teamId: b.id, mode: "organizer", force: true });
    after = { alice: (await wallet(alice)).coins, bob: (await wallet(bob)).coins, carol: (await wallet(carol)).coins };
    assert.equal(after.alice - before.alice, 60, "a walkover gives every stake back");
    assert.equal(after.bob - before.bob, 30);

    // The ledger always adds up to the balance.
    for (const who of [alice, bob, carol]) {
      const sum = await prisma.coinTx.aggregate({ where: { discordId: who }, _sum: { amount: true } });
      assert.equal(sum._sum.amount, (await wallet(who)).coins);
    }
  });

  test("deleting a tournament gives every stake back", async () => {
    const t = await newTournament();
    const a = await registerTeam(t.id, "Cats");
    await registerTeam(t.id, "Dogs");
    const champ = (await markets(t.id)).markets.find((m: any) => m.kind === "CHAMPION");
    const before = (await wallet(bob)).coins;
    assert.equal((await bet(bob, champ.id, a.id, 25)).status, 200);
    assert.equal((await wallet(bob)).coins, before - 25);
    await ok("DELETE", `/tournaments/${t.id}`);
    assert.equal((await wallet(bob)).coins, before);
  });

  test("each game of a BO5 is predicted on its own; games that were not played give the coins back", async () => {
    const t = await newTournament({ bestOf: 5 });
    const a = await registerTeam(t.id, "Gulls");
    const b = await registerTeam(t.id, "Hawks");
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: [a.id, b.id] });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    await ok("POST", `/tournaments/${t.id}/bracket/schedule`, { match: "M1", scheduledAt: soon() });
    const view = await markets(t.id);
    const series = view.markets.find((m: any) => m.kind === "MATCH");
    const games = view.markets.filter((m: any) => m.kind === "GAME");
    assert.deepEqual(games.map((g: any) => [g.match, g.game, g.number, g.open]), [1, 2, 3, 4, 5].map((n) => [series.key, n, 1, true]));
    assert.deepEqual(view.markets.map((m: any) => m.kind), ["CHAMPION", "MATCH", "GAME", "GAME", "GAME", "GAME", "GAME"], "games follow their match");
    assert.equal((await ok("GET", "/predict/tournaments")).data.find((x: any) => x.id === t.id).open, 1, "a series counts once");

    const before = { alice: (await wallet(alice)).coins, bob: (await wallet(bob)).coins };
    assert.equal((await bet(alice, games[0].id, a.id, 10)).status, 200);
    assert.equal((await bet(bob, games[0].id, b.id, 20)).status, 200);
    assert.equal((await bet(alice, games[1].id, b.id, 5)).status, 200);
    assert.equal((await bet(bob, games[1].id, a.id, 5)).status, 200);
    assert.equal((await bet(bob, games[3].id, a.id, 15)).status, 200);

    // Gulls win 3-0: game 1 pays Alice, game 2 pays Bob, game 3 had no picks, game 4 was never played.
    const g = (scoreA: number, scoreB: number) => ({ scoreA, scoreB });
    await ok("POST", `/tournaments/${t.id}/bracket/matches/M1/result`, { games: [g(21, 15), g(21, 19), g(21, 10)] });
    const done = (await markets(t.id)).markets.filter((m: any) => m.kind === "GAME");
    assert.deepEqual(done.map((m: any) => m.status), ["SETTLED", "SETTLED", "REFUNDED"], "games without picks are not listed");
    assert.deepEqual(done.map((m: any) => m.game), [1, 2, 4]);
    assert.equal(done[0].winnerTeamId, a.id);
    const after = { alice: (await wallet(alice)).coins, bob: (await wallet(bob)).coins };
    assert.equal(after.alice - before.alice, 20 - 5, "won Bob's 20 on game 1, lost 5 on game 2");
    assert.equal(after.bob - before.bob, -20 + 5, "won Alice's 5 on game 2, game 4 came back");

    // A correction with only the series score: game picks come back too.
    await ok("POST", `/tournaments/${t.id}/bracket/matches/M1/result`, { scoreA: 3, scoreB: 1, replace: true });
    assert.deepEqual({ alice: (await wallet(alice)).coins, bob: (await wallet(bob)).coins }, before, "no game scores: every game pick is refunded");
    for (const who of [alice, bob]) {
      const sum = await prisma.coinTx.aggregate({ where: { discordId: who }, _sum: { amount: true } });
      assert.equal(sum._sum.amount, (await wallet(who)).coins);
    }
  });

  test("organizers paste shop codes and give them to the top of a leaderboard; codes stay private", async () => {
    const pasted = await ok("POST", "/predict/codes", { label: "ส่วนลด 50", text: "AAAA1111\nBBBB2222, CCCC3333\nAAAA1111\nbad code!" });
    assert.equal(pasted.added, 3);
    assert.equal(pasted.duplicates, 1);
    assert.deepEqual(pasted.invalid, ["bad", "code!"]);
    assert.equal((await call("POST", "/predict/codes", { label: "x", text: "ZZZZ9999" }, reader)).status, 403);
    assert.deepEqual((await ok("GET", "/predict/codes")).data, [{ label: "ส่วนลด 50", total: 3, left: 3 }]);
    assert.equal(JSON.stringify(await ok("GET", "/predict/codes")).includes("AAAA1111"), false, "the pool never lists codes");

    // A finished tournament: Carol called it, Bob did not.
    const t = await newTournament();
    const a = await registerTeam(t.id, "Eagles");
    const b = await registerTeam(t.id, "Foxes");
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: [a.id, b.id] });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    await ok("POST", `/tournaments/${t.id}/bracket/schedule`, { match: "M1", scheduledAt: soon() });
    const m = (await markets(t.id)).markets.find((x: any) => x.kind === "MATCH");
    assert.equal((await bet(carol, m.id, a.id, 10)).status, 200);
    assert.equal((await bet(bob, m.id, b.id, 10)).status, 200);
    const early = await call("POST", "/predict/rewards", { title: "อันดับ 1", codeLabel: "ส่วนลด 50", tournamentId: t.id });
    assert.equal(early.status, 409, "nobody has won anything yet");
    await ok("POST", `/tournaments/${t.id}/bracket/matches/M1/result`, { scoreA: 2, scoreB: 1 });
    const top = await ok("POST", "/predict/rewards", { title: "อันดับ 1", codeLabel: "ส่วนลด 50", tournamentId: t.id, from: 1, to: 3 });
    assert.equal(top.given, 1, "only people who came out ahead win prizes");
    assert.equal(top.data[0].discordId, carol);
    assert.equal(top.data[0].place, 1);
    const one = await ok("POST", "/predict/rewards", { title: "ของขวัญ", codeLabel: "ส่วนลด 50", discordId: alice });
    assert.equal(one.given, 1);
    const tooMany = await call("POST", "/predict/rewards", { title: "x", codeLabel: "ไม่มี", discordId: alice });
    assert.equal(tooMany.status, 409);
    assert.match(tooMany.body.details.th, /เหลือ 0/);

    const w = await wallet(alice);
    const code = w.rewards[0].code;
    assert.ok(["AAAA1111", "BBBB2222", "CCCC3333"].includes(code), "the winner sees the code");
    const list = await ok("GET", "/predict/rewards");
    assert.equal(JSON.stringify(list).includes(code), false, "the admin list never shows codes");

    const pending = await ok("GET", "/predict/rewards/unnotified");
    assert.ok(pending.data.some((r: any) => r.code === code));
    await ok("POST", `/predict/rewards/${one.data[0].id}/notified`);
    assert.equal((await ok("GET", "/predict/rewards/unnotified")).data.some((r: any) => r.id === one.data[0].id), false);

    const item = await ok("POST", "/predict/rewards", { title: "เมาส์เกมมิ่ง", kind: "ITEM", discordId: bob });
    assert.equal(item.data[0].status, "PENDING");
    await ok("PATCH", `/predict/rewards/${item.data[0].id}`, { status: "SENT" });
    const got = await ok("POST", `/predict/members/${bob}/rewards/${item.data[0].id}/received`);
    assert.equal(got.status, "RECEIVED");
    assert.equal((await call("POST", `/predict/members/${alice}/rewards/${item.data[0].id}/received`)).status, 404, "only the winner confirms");
  });
});

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

test("free-form special events automatically accept picks for two full teams and settle/refund through admin controls", async () => {
  const t = await newTournament({ special: true, format: null, startDate: soon() });
  const a = await registerTeam(t.id, "Special predict A");
  assert.equal((await markets(t.id)).markets.length, 0, "one team cannot be predicted");
  const b = await registerTeam(t.id, "Special predict B");
  const list = (await ok("GET", "/predict/tournaments")).data;
  assert.equal(list.find((row: any) => row.id === t.id)?.open, 1);
  assert.equal(list.find((row: any) => row.id === t.id)?.special, true);
  const pair = (await markets(t.id)).markets.find((m: any) => m.key === "SPECIAL_PAIR");
  assert.equal(pair.kind, "CUSTOM");
  assert.equal(pair.open, true);
  assert.equal(pair.options.length, 2);
  const fan = a.captainDiscordId, fan2 = discord();
  await wallet(fan); await wallet(fan2);
  assert.equal((await bet(fan, pair.id, b.id, 30)).status, 200, "competitor may pick the opposing side");
  assert.equal((await bet(fan, pair.id, a.id, 30)).status, 200);
  assert.equal((await bet(fan2, pair.id, b.id, 10)).status, 200);
  assert.equal((await call("POST", `/predict/markets/${pair.id}/settle`, { winnerTeamId: a.id }, reader)).status, 403);
  assert.equal((await call("PUT", `/tournaments/${t.id}/special-teams`, { teams: [
    { teamId: a.id, name: "Special predict A", slots: [{ name: "Replacement" }, null, null] },
    { teamId: b.id, name: "Special predict B", slots: [null, null, null] },
  ] })).status, 409, "lineups cannot change while stakes exist");
  await ok("PATCH", `/tournaments/${t.id}`, { status: "ONGOING" });
  assert.equal((await markets(t.id)).markets.find((m: any) => m.id === pair.id).open, false);
  assert.equal((await bet(discord(), pair.id, a.id, 5)).status, 409);
  assert.equal((await bet(fan, pair.id, a.id, 5)).status, 409, "competitors follow the same closing rules");
  // Opened again by hand after the event started: it stays open (the start no longer closes it).
  await ok("PATCH", `/predict/markets/${pair.id}`, { status: "OPEN" });
  assert.equal((await markets(t.id)).markets.find((m: any) => m.id === pair.id).open, true, "reopened by hand stays open");
  assert.equal((await bet(fan2, pair.id, b.id, 5)).status, 200);
  await ok("PATCH", `/predict/markets/${pair.id}`, { status: "CLOSED" });
  const before = (await wallet(fan)).coins;
  await ok("POST", `/predict/markets/${pair.id}/settle`, { winnerTeamId: a.id });
  assert.equal((await wallet(fan)).coins, before + 35, "the second pick replaced fan2's 10 with 5");
  assert.equal((await markets(t.id)).markets.find((m: any) => m.id === pair.id).status, "SETTLED", "sync preserves manual settlement");
  await ok("DELETE", `/predict/markets/${pair.id}`);
  assert.equal((await markets(t.id)).markets.filter((m: any) => m.open).length, 0);
  assert.equal(await prisma.market.count({ where: { tournamentId: t.id } }), 1, "cancelled auto pair is not recreated");
});

test("special prediction drafts require complete rosters and keep bracket markets separate", async () => {
  const t = await newTournament({ special: true, format: null });
  const draft = await ok("PUT", `/tournaments/${t.id}/special-teams`, { teams: [
    { name: "Draft predict A", slots: [{ name: "Draft P1" }, null, null] },
    { name: "Draft predict B", slots: [null, null, null] },
  ] });
  assert.equal((await markets(t.id)).markets.length, 0);
  await ok("PUT", `/tournaments/${t.id}/special-teams`, { teams: draft.teams.map((team: any, side: number) => ({ ...team, slots: [0, 1, 2].map((i) => ({ name: `Draft side ${side} player ${i}` })) })) });
  assert.equal((await markets(t.id)).markets.filter((m: any) => m.open && m.kind !== "GAME").length, 1);
  await ok("PATCH", `/tournaments/${t.id}`, { format: "SINGLE_ELIMINATION" });
  const bracketMarkets = (await markets(t.id)).markets;
  assert.equal(bracketMarkets.some((m: any) => m.key === "SPECIAL_PAIR" && m.open), false);
  assert.equal(bracketMarkets.some((m: any) => m.kind === "CHAMPION" && m.open), true);
});

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

  test("a match opens once both teams and a start time are known; competitors may predict their event", async () => {
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
    assert.equal(own.status, 200);
    assert.equal((await bet(capA, champ.id, a.id, 15)).status, 200, "competitor can switch to their own team");
    await ok("DELETE", `/predict/members/${capA}/bets/${champ.id}`);

    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    await ok("POST", `/tournaments/${t.id}/bracket/schedule`, { match: "M1", scheduledAt: soon() });
    view = await markets(t.id);
    assert.equal(view.markets.find((m: any) => m.kind === "CHAMPION").open, false, "the champion pick closes when play starts");
    const match = view.markets.find((m: any) => m.kind === "MATCH");
    assert.equal(match.open, true);

    const mine = await bet(capA, match.id, b.id, 10);
    assert.equal(mine.status, 200);
    await ok("DELETE", `/predict/members/${capA}/bets/${match.id}`);
    const game = view.markets.find((m: any) => m.kind === "GAME");
    assert.equal((await bet(capA, game.id, a.id, 10)).status, 200, "competitors may predict individual games too");
    await ok("DELETE", `/predict/members/${capA}/bets/${game.id}`);
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
    // The winner is already known: a taken-back result leaves the match closed, so nobody can switch to the winner.
    const reopened = (await markets(t.id)).markets.find((m: any) => m.kind === "MATCH");
    assert.equal(reopened.status, "CLOSED");
    assert.equal(reopened.open, false);
    assert.equal((await bet(bob, reopened.id, a.id, 30)).status, 409, "no switching sides once the result was seen");
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

describe("organizer controls", () => {
  const fan = discord();
  const fan2 = discord();

  before(async () => {
    for (const who of [fan, fan2]) await ok("POST", `/predict/members/${who}/daily`, { name: "Fan" });
  });

  test("the whole pot is paid out: coins left by rounding go to the biggest winning pick", async () => {
    const t = await newTournament({ format: null });
    const a = await registerTeam(t.id, "Odd");
    const b = await registerTeam(t.id, "Even");
    const pair = await ok("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: a.id, teamBId: b.id });
    const [p1, p2, p3, loser] = [discord(), discord(), discord(), discord()];
    for (const who of [p1, p2, p3, loser]) await ok("POST", `/predict/members/${who}/daily`, { name: "P" });
    // Pot 3+3+5 on Odd, 10 on Even: shares 3+2.72, 3+2.72, 5+4.54 round down to 5, 5, 9 = 19 of 21.
    await bet(p1, pair.id, a.id, 3);
    await bet(p2, pair.id, a.id, 3);
    await bet(p3, pair.id, a.id, 5);
    await bet(loser, pair.id, b.id, 10);
    await ok("POST", `/predict/markets/${pair.id}/settle`, { winnerTeamId: a.id });
    const paid = await Promise.all([p1, p2, p3].map(async (who) => (await wallet(who)).bets[0].payout));
    assert.equal(paid.reduce((x, y) => x + y, 0), 21, "nothing is lost to rounding");
    assert.deepEqual(paid, [6, 5, 10], "the biggest pick first, then the earliest");
  });

  test("bracket matches open as soon as the bracket starts, even without a start time; organizers close one or all", async () => {
    const t = await newTournament();
    const a = await registerTeam(t.id, "Kings");
    const b = await registerTeam(t.id, "Queens");
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: [a.id, b.id] });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    let m1 = (await markets(t.id)).markets.find((m: any) => m.kind === "MATCH");
    assert.equal(m1.open, true, "open without a start time once the bracket is under way");
    assert.equal(m1.title, "คู่ที่ 1");
    assert.equal((await bet(fan, m1.id, a.id, 10)).status, 200);

    await ok("PATCH", `/predict/markets/${m1.id}`, { status: "CLOSED" });
    m1 = (await markets(t.id)).markets.find((m: any) => m.id === m1.id);
    assert.equal(m1.open, false);
    assert.equal((await bet(fan2, m1.id, b.id, 10)).status, 409, "closed: no new picks");
    assert.equal((await call("DELETE", `/predict/members/${fan}/bets/${m1.id}`)).status, 409, "closed: picks stay");

    const opened = await ok("POST", `/predict/tournaments/${t.id}/status`, { status: "OPEN" });
    assert.equal(opened.changed, 1);
    assert.equal((await markets(t.id)).markets.find((m: any) => m.id === m1.id).open, true);
    const closed = await ok("POST", `/predict/tournaments/${t.id}/status`, { status: "CLOSED" });
    assert.ok(closed.changed >= 1);
    assert.equal((await markets(t.id)).markets.some((m: any) => m.open), false, "close all closes every market");
    assert.equal((await call("POST", `/predict/tournaments/${t.id}/status`, { status: "CLOSED" }, reader)).status, 403, "organizers only");

    // The result still settles a closed match.
    await ok("POST", `/tournaments/${t.id}/bracket/matches/M1/result`, { scoreA: 2, scoreB: 0 });
    const done = (await markets(t.id)).markets.find((m: any) => m.id === m1.id);
    assert.equal(done.status, "SETTLED");
  });

  test("a hand-made pair: open at once, closed by the organizer, settled by picking the winner, and listed for an event without a bracket", async () => {
    const t = await newTournament({ format: null });
    const a = await registerTeam(t.id, "Red");
    const b = await registerTeam(t.id, "Blue");
    const other = await newTournament();
    const outsider = await registerTeam(other.id, "Green");
    assert.equal((await ok("GET", "/predict/tournaments")).data.some((x: any) => x.id === t.id), false, "nothing to predict yet");

    const bad = await call("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: a.id, teamBId: outsider.id });
    assert.equal(bad.status, 400);
    assert.match(bad.body.details.th, /ต้องอยู่ในรายการนี้/);
    assert.equal((await call("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: a.id, teamBId: a.id })).status, 400);
    assert.equal((await call("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: a.id, teamBId: b.id }, reader)).status, 403);

    const pair = await ok("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: a.id, teamBId: b.id, label: "โชว์แมตช์" });
    assert.equal(pair.kind, "CUSTOM");
    const listed = (await ok("GET", "/predict/tournaments")).data.find((x: any) => x.id === t.id);
    assert.equal(listed?.open, 1, "an event without a bracket is listed once it has a pair");
    let view = (await markets(t.id)).markets;
    assert.equal(view.length, 1, "no champion pick without a bracket");
    assert.equal(view[0].title, "โชว์แมตช์");
    assert.equal(view[0].open, true);

    assert.equal((await bet(fan, pair.id, a.id, 30)).status, 200);
    assert.equal((await bet(fan2, pair.id, b.id, 10)).status, 200);
    const before1 = (await wallet(fan)).coins;
    await ok("PATCH", `/predict/markets/${pair.id}`, { status: "CLOSED" });
    // A bracket's own matches are settled by their results, not by hand.
    const won = await ok("POST", `/predict/markets/${pair.id}/settle`, { winnerTeamId: a.id });
    assert.equal(won.status, "SETTLED");
    assert.equal((await wallet(fan)).coins, before1 + 40, "the winner takes the whole pot");
    // Changed by mistake: the other team won after all; the coins move.
    await ok("POST", `/predict/markets/${pair.id}/settle`, { winnerTeamId: b.id });
    assert.equal((await wallet(fan)).coins, before1);
    const w2 = await wallet(fan2);
    assert.equal(w2.bets[0].market.label, "โชว์แมตช์");
    assert.equal(w2.bets[0].payout, 40);
    // Called off: everyone gets their stake back.
    await ok("POST", `/predict/markets/${pair.id}/settle`, { winnerTeamId: null });
    assert.equal((await wallet(fan)).coins, before1 + 30);
    view = (await markets(t.id)).markets;
    assert.equal(view[0].status, "REFUNDED");

    // A plain pair is called "A vs B", and can be deleted (stakes back).
    const plain = await ok("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: b.id, teamBId: a.id });
    assert.equal((await markets(t.id)).markets.find((m: any) => m.id === plain.id).title, "Blue vs Red");
    const coins = (await wallet(fan2)).coins;
    await bet(fan2, plain.id, a.id, 5);
    await ok("DELETE", `/predict/markets/${plain.id}`);
    assert.equal((await wallet(fan2)).coins, coins);
    const champ = await newTournament();
    const c1 = await registerTeam(champ.id, "C1");
    await registerTeam(champ.id, "C2");
    const cm = (await markets(champ.id)).markets[0];
    assert.equal((await call("POST", `/predict/markets/${cm.id}/settle`, { winnerTeamId: c1.id })).status, 409, "only hand-made pairs are settled by hand");
    assert.equal((await call("DELETE", `/predict/markets/${cm.id}`)).status, 409);
  });

  test("the change counter goes up with organizer changes, not with members' picks", async () => {
    const r0 = (await ok("GET", "/revision")).revision;
    await ok("POST", `/predict/members/${fan}/watch`, {});
    assert.equal((await ok("GET", "/revision")).revision, r0);
    await newTournament();
    assert.ok((await ok("GET", "/revision")).revision > r0);
  });
});

test("a pair whose closing time has passed opens again with 'open all' (or on its own) and stays open", async () => {
  const t = await newTournament({ format: null });
  const a = await registerTeam(t.id, "Late A");
  const b = await registerTeam(t.id, "Late B");
  const past = new Date(Date.now() - 60_000).toISOString();
  const refused = await call("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: a.id, teamBId: b.id, locksAt: past });
  assert.equal(refused.status, 400, "a time already passed is refused");
  assert.match(refused.body.details.th, /เวลาปิดรับเลยมาแล้ว/);
  // A pair made earlier whose time has since passed (as on the live site):
  const pair = await ok("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: a.id, teamBId: b.id, label: "late", locksAt: new Date(Date.now() + 1500).toISOString() });
  await new Promise((r) => setTimeout(r, 1600));
  const view = async () => (await markets(t.id)).markets.find((m: any) => m.id === pair.id);
  assert.equal((await view()).open, false, "its time has passed");
  assert.equal((await view()).status, "OPEN", "still OPEN, only past its time: the trap Bank hit");
  const fan = discord();
  await wallet(fan);
  assert.equal((await bet(fan, pair.id, a.id, 5)).status, 409);
  const res = await ok("POST", `/predict/tournaments/${t.id}/status`, { status: "OPEN" });
  assert.equal(res.changed, 1);
  assert.equal((await view()).open, true);
  assert.equal((await view()).locksAt, null, "the passed time is no longer shown");
  assert.equal((await bet(fan, pair.id, a.id, 5)).status, 200);
  // Closing all closes it; opening one by hand lifts the time too.
  await ok("POST", `/predict/tournaments/${t.id}/status`, { status: "CLOSED" });
  assert.equal((await view()).open, false);
  await ok("PATCH", `/predict/markets/${pair.id}`, { status: "OPEN" });
  assert.equal((await view()).open, true);
});

test("a BO5 pair is predicted round by round: one round open at a time, closed once a team has 3, the rest refunded", async () => {
  const t = await newTournament({ format: null });
  const a = await registerTeam(t.id, "Round A");
  const b = await registerTeam(t.id, "Round B");
  const bad = await call("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: a.id, teamBId: b.id, bestOf: 9 });
  assert.equal(bad.status, 400, "at most 7 rounds");
  const pair = await ok("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: a.id, teamBId: b.id, bestOf: 5 });
  assert.equal(pair.bestOf, 5);
  const all = async () => (await markets(t.id)).markets;
  const rounds = async () => (await all()).filter((m: any) => m.match === pair.key).sort((x: any, y: any) => x.game - y.game);
  let r = await rounds();
  assert.equal(r.length, 5);
  assert.deepEqual(r.map((m: any) => m.open), [true, false, false, false, false], "only round 1 is open");
  assert.equal(r[0].title, "Round A vs Round B · รอบ 1");
  assert.equal((await all()).find((m: any) => m.id === pair.id).open, true, "who wins the match is open too");

  const fan = discord();
  const fan2 = discord();
  await wallet(fan);
  await wallet(fan2);
  assert.equal((await bet(fan, r[1].id, a.id, 5)).status, 409, "round 2 is not open yet");
  assert.equal((await bet(fan, r[0].id, a.id, 10)).status, 200);
  assert.equal((await bet(fan2, r[0].id, b.id, 10)).status, 200);
  assert.equal((await bet(fan, pair.id, a.id, 20)).status, 200);
  assert.equal((await bet(fan2, pair.id, b.id, 20)).status, 200);
  // "Open all" does not open rounds ahead of time.
  await ok("POST", `/predict/tournaments/${t.id}/status`, { status: "OPEN" });
  assert.equal((await rounds())[2].open, false);

  const start = (await wallet(fan)).coins;
  // Round 1 to A: it pays, and round 2 opens.
  await ok("POST", `/predict/markets/${r[0].id}/settle`, { winnerTeamId: a.id });
  assert.equal((await wallet(fan)).coins, start + 20);
  r = await rounds();
  assert.equal(r[0].status, "SETTLED");
  assert.equal(r[1].open, true, "the next round opens by itself");
  // Round 2 to B with nobody on it (refunded but still counts), round 3 called off, rounds 4 and 5 to A.
  await ok("POST", `/predict/markets/${r[1].id}/settle`, { winnerTeamId: b.id });
  r = await rounds();
  assert.equal(r[1].status, "REFUNDED");
  assert.equal(r[2].open, true);
  await ok("POST", `/predict/markets/${r[2].id}/settle`, { winnerTeamId: null });
  r = await rounds();
  assert.equal(r[3].open, true, "a called-off round moves on to the next");
  await ok("POST", `/predict/markets/${r[3].id}/settle`, { winnerTeamId: a.id });
  r = await rounds();
  assert.equal((await all()).find((m: any) => m.id === pair.id).status, "OPEN", "1 win short of 3");
  await bet(fan2, r[4].id, b.id, 7);
  await bet(fan, r[4].id, a.id, 7);
  const before5 = (await wallet(fan2)).coins;
  await ok("POST", `/predict/markets/${r[4].id}/settle`, { winnerTeamId: a.id });
  const p = (await all()).find((m: any) => m.id === pair.id);
  assert.equal(p.status, "SETTLED", "A reached 3 rounds: the match is over");
  assert.equal(p.winnerTeamId, a.id);
  assert.equal((await wallet(fan)).coins, start + 20 - 7 + 14 + 40, "round 5 and the match pay as well");
  assert.equal((await wallet(fan2)).coins, before5, "fan2 lost round 5 and the match");
  // The match is over: rounds can't be changed any more.
  assert.equal((await call("POST", `/predict/markets/${r[1].id}/settle`, { winnerTeamId: a.id })).status, 409);

  // A BO3 decided 2-0: round 3 gives its coins back; the organizer can also change the number of rounds.
  const bo3 = await ok("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: a.id, teamBId: b.id, bestOf: 3 });
  const r3 = async () => (await all()).filter((m: any) => m.match === bo3.key).sort((x: any, y: any) => x.game - y.game);
  assert.equal((await ok("PUT", `/predict/markets/${bo3.id}/rounds`, { bestOf: 5 })).bestOf, 5);
  assert.equal((await r3()).length, 5);
  await ok("PUT", `/predict/markets/${bo3.id}/rounds`, { bestOf: 3 });
  let q = await r3();
  assert.equal(q.length, 3);
  assert.equal((await call("PUT", `/predict/markets/${bo3.id}/rounds`, { bestOf: 3 }, reader)).status, 403);
  await ok("POST", `/predict/markets/${q[0].id}/settle`, { winnerTeamId: b.id });
  q = await r3();
  await bet(fan, q[1].id, a.id, 3);
  await ok("POST", `/predict/markets/${q[1].id}/settle`, { winnerTeamId: b.id });
  q = await r3();
  assert.equal((await all()).find((m: any) => m.id === bo3.id).winnerTeamId, b.id);
  assert.equal(q[2].open, false);
  assert.equal(q[2].status, "REFUNDED", "round 3 was never played");

  // Deleting a pair takes its rounds too, coins back.
  const gone = await ok("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: a.id, teamBId: b.id, bestOf: 3 });
  const g1 = (await all()).find((m: any) => m.match === gone.key && m.game === 1);
  const c0 = (await wallet(fan)).coins;
  await bet(fan, g1.id, a.id, 4);
  await ok("DELETE", `/predict/markets/${gone.id}`);
  assert.equal((await wallet(fan)).coins, c0);
  assert.equal((await all()).some((m: any) => m.match === gone.key), false);
});

test("a recorded match settles a hand-made pair and its rounds from the games", async () => {
  const t = await newTournament({ format: null });
  const a = await registerTeam(t.id, "Auto A");
  const b = await registerTeam(t.id, "Auto B");
  const pair = await ok("POST", `/predict/tournaments/${t.id}/markets`, { teamAId: a.id, teamBId: b.id, bestOf: 3 });
  const fan = discord();
  await wallet(fan);
  const r = (await markets(t.id)).markets.filter((m: any) => m.match === pair.key).sort((x: any, y: any) => x.game - y.game);
  await bet(fan, r[0].id, b.id, 10);
  await bet(fan, pair.id, b.id, 10);
  const start = (await wallet(fan)).coins;
  // Recorded the other way round (B as team A): B wins 2-0.
  await ok("POST", "/matches", { tournamentId: t.id, teamAId: b.id, teamBId: a.id, games: [{ scoreA: 21, scoreB: 10 }, { scoreA: 21, scoreB: 15 }] });
  const view = (await markets(t.id)).markets;
  const p = view.find((m: any) => m.id === pair.id);
  assert.equal(p.winnerTeamId, b.id);
  const rr = view.filter((m: any) => m.match === pair.key).sort((x: any, y: any) => x.game - y.game);
  assert.equal(rr[0].winnerTeamId, b.id);
  assert.equal(rr[1].winnerTeamId, b.id);
  assert.equal(rr[2].open, false);
  // Only fan picked: winning back their own stake is a refund either way.
  assert.equal((await wallet(fan)).coins, start + 20);
});

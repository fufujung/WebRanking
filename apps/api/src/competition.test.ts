/** Running a tournament through the HTTP API: registration, seeding, the live bracket, walkovers and corrections. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-comp-test-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: process.env });

const { createApp } = await import("./app.js");
const { createApiKey } = await import("./lib/apiKeys.js");
const { prisma } = await import("./lib/db.js");
const { imageReader } = await import("./lib/extract.js");

let server: Server;
let base: string;
let admin: string;

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
});

after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true });
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

const bracket = (tid: string) => ok("GET", `/tournaments/${tid}/bracket`);
const byCode = async (tid: string, code: string) => (await bracket(tid)).matches.find((m: any) => m.code === code);

/** A played series with one scoreboard per game, side A first. */
function series(wins: ("A" | "B")[], names: { A: string; B: string }) {
  return {
    games: wins.map((w) => ({
      scoreA: w === "A" ? 21 : 15,
      scoreB: w === "B" ? 21 : 15,
      players: [1, 2, 3].flatMap((i) => [
        { name: `${names.A} P${i}`, side: "A", pts: 7, reb: 1, ast: 1 },
        { name: `${names.B} P${i}`, side: "B", pts: 5, reb: 2, ast: 0 },
      ]),
    })),
  };
}

describe("registration", () => {
  test("teams sign up with rosters; the rules are enforced", async () => {
    const t = await newTournament({ maxTeams: 3, registrationOpen: false });
    let res = await call("POST", `/tournaments/${t.id}/registrations`, { teamName: "Alpha", players: [{ name: "a" }, { name: "b" }, { name: "c" }] });
    assert.equal(res.status, 409);
    assert.equal(res.body.details.th, "ปิดรับสมัครแล้ว");
    await ok("PATCH", `/tournaments/${t.id}`, { registrationOpen: true });

    const cap = discord();
    const alpha = await registerTeam(t.id, "Alpha", cap);
    assert.equal(alpha.name, "Alpha");
    assert.equal(alpha.captainDiscordId, cap);
    assert.deepEqual(alpha.roster.map((r: any) => r.name), ["Alpha P1", "Alpha P2", "Alpha P3"]);
    assert.equal(alpha.roster[0].discordId, cap);

    res = await call("POST", `/tournaments/${t.id}/registrations`, { teamName: "alpha", players: [{ name: "x" }, { name: "y" }, { name: "z" }] });
    assert.equal(res.status, 409, "same team name (any case) twice");
    assert.match(res.body.details.th, /สมัครไว้แล้ว/);

    res = await call("POST", `/tournaments/${t.id}/registrations`, { teamName: "Beta", players: [{ name: "x" }, { name: "y" }] });
    assert.equal(res.status, 400);
    assert.match(res.body.details.th, /3-4 คน/);

    res = await call("POST", `/tournaments/${t.id}/registrations`, { teamName: "Beta", players: [{ name: "x" }, { name: "X" }, { name: "y" }] });
    assert.equal(res.status, 400, "duplicate player names");

    res = await call("POST", `/tournaments/${t.id}/registrations`, { teamName: "Beta", players: [{ name: "x", discordId: cap }, { name: "y" }, { name: "z" }] });
    assert.equal(res.status, 409, "a Discord account can only play for one team");
    assert.match(res.body.details.th, /อยู่ในทีม Alpha แล้ว/);

    res = await call("POST", `/tournaments/${t.id}/registrations`, { teamName: "Beta", captainDiscordId: cap, players: [{ name: "x" }, { name: "y" }, { name: "z" }] });
    assert.equal(res.status, 409, "one captain, one team");

    await registerTeam(t.id, "Beta");
    await registerTeam(t.id, "Gamma");
    res = await call("POST", `/tournaments/${t.id}/registrations`, { teamName: "Delta", players: [{ name: "x" }, { name: "y" }, { name: "z" }] });
    assert.equal(res.status, 409);
    assert.match(res.body.details.th, /เต็ม/);

    const detail = await ok("GET", `/tournaments/${t.id}`);
    assert.equal(detail.teams.length, 3);
    assert.equal(detail.teams.find((x: any) => x.name === "Alpha").roster.length, 3);
  });

  test("a returning player keeps their stats: same Discord account, same player", async () => {
    const t1 = await newTournament();
    const cap = discord();
    const first = await registerTeam(t1.id, "Old Team", cap);
    const t2 = await newTournament();
    const again = await ok("POST", `/tournaments/${t2.id}/registrations`, {
      teamName: "New Team",
      players: [{ name: "Renamed", discordId: cap }, { name: "q" }, { name: "r" }],
    });
    assert.equal(again.roster[0].playerId, first.roster[0].playerId);
    const player = await ok("GET", `/players/${first.roster[0].playerId}`);
    assert.equal(player.name, "Renamed");
    assert.equal(player.nickname, "Old Team P1", "old in-game name kept as nickname so old screenshots still match");
    assert.equal(player.team.name, "New Team");
  });

  test("characters (UID + server) and extra Discord members: one character, one account, one team", async () => {
    const t = await newTournament();
    const cap = discord();
    const friend = discord();
    const team = await ok("POST", `/tournaments/${t.id}/registrations`, {
      teamName: "Uid Team",
      captainDiscordId: cap,
      memberDiscordIds: [friend, cap, friend],
      players: [
        { name: "Hero", uid: "800111", server: "Asia" },
        { name: "Mage", uid: "800222", server: "Asia" },
        { name: "Tank", uid: "800111", server: "EU" },
      ],
    });
    assert.deepEqual(team.memberDiscordIds, [friend], "captain and repeats dropped");
    assert.deepEqual(team.roster.map((r: any) => [r.name, r.uid, r.server]), [["Hero", "800111", "Asia"], ["Mage", "800222", "Asia"], ["Tank", "800111", "EU"]]);

    let res = await call("POST", `/tournaments/${t.id}/registrations`, {
      teamName: "Dup Uid",
      players: [{ name: "a", uid: "1", server: "S" }, { name: "b", uid: "1", server: "s" }, { name: "c" }],
    });
    assert.equal(res.status, 400, "same character twice in a roster");
    assert.match(res.body.details.th, /UID ซ้ำ/);

    res = await call("POST", `/tournaments/${t.id}/registrations`, { teamName: "Thief", players: [{ name: "Copy", uid: "800222", server: "asia" }, { name: "b" }, { name: "c" }] });
    assert.equal(res.status, 409, "a character can only play for one team");
    assert.match(res.body.details.th, /UID 800222.*Uid Team/);

    res = await call("POST", `/tournaments/${t.id}/registrations`, { teamName: "Friend Team", captainDiscordId: friend, players: [{ name: "a" }, { name: "b" }, { name: "c" }] });
    assert.equal(res.status, 409, "a team member cannot lead another team");
    assert.match(res.body.details.th, /อยู่ในทีม Uid Team แล้ว/);

    // A roster change without memberDiscordIds keeps the members; the character keeps its player (and stats) when renamed.
    const changed = await ok("PUT", `/tournaments/${t.id}/entries/${team.id}/roster`, {
      players: [{ name: "Hero Renamed", uid: "800111", server: "Asia" }, { name: "Mage", uid: "800222", server: "Asia" }, { name: "Support", uid: "800333", server: "Asia" }],
    });
    assert.deepEqual(changed.memberDiscordIds, [friend]);
    assert.equal(changed.roster[0].playerId, team.roster[0].playerId);
    assert.equal(changed.roster[0].name, "Hero Renamed");
    const cleared = await ok("PUT", `/tournaments/${t.id}/entries/${team.id}/roster`, { players: changed.roster.map((r: any) => ({ name: r.name, uid: r.uid, server: r.server })), memberDiscordIds: [] });
    assert.deepEqual(cleared.memberDiscordIds, []);
    await ok("POST", `/tournaments/${t.id}/registrations`, { teamName: "Friend Team", captainDiscordId: friend, players: [{ name: "a" }, { name: "b" }, { name: "c" }] });
  });
});

describe("seeding and starting", () => {
  test("seed by rating, by hand, then start", async () => {
    const t = await newTournament();
    let res = await call("POST", `/tournaments/${t.id}/bracket/seed`, {});
    assert.equal(res.status, 409, "needs two teams");
    const teams = [];
    for (const name of ["S1", "S2", "S3", "S4", "S5"]) teams.push(await registerTeam(t.id, name));
    const ids = teams.map((x) => x.id);

    let b = await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "rating" });
    assert.equal(b.status, "DRAFT");
    assert.equal(b.positions.length, 8);
    assert.equal(b.matches.length, 7);
    assert.equal(b.matches.filter((m: any) => m.outcome === "BYE").length, 3);

    res = await call("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", positions: [ids[0], ids[1], ids[2], null, null, null, ids[3], ids[4]] });
    assert.equal(res.status, 400);
    assert.match(res.body.details.th, /คู่ที่ 3/);

    const layout = [ids[4], ids[0], ids[1], null, ids[2], null, ids[3], null];
    b = await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", positions: layout });
    assert.deepEqual(b.positions, layout);
    const m1 = b.matches.find((m: any) => m.code === "W1-0");
    assert.deepEqual([m1.teamA.name, m1.teamB.name], ["S5", "S1"]);
    assert.equal(b.teams.find((x: any) => x.name === "S5").seed, 1);

    b = await ok("POST", `/tournaments/${t.id}/bracket/start`);
    assert.equal(b.status, "LIVE");
    assert.equal(b.registrationOpen, false);
    assert.ok(b.matches.filter((m: any) => m.status === "READY").every((m: any) => m.scheduledAt === "2026-11-01T12:00:00.000Z"), "ready matches get the start time");
    const detail = await ok("GET", `/tournaments/${t.id}`);
    assert.equal(detail.status, "ONGOING");

    res = await call("POST", `/tournaments/${t.id}/registrations`, { teamName: "Late", override: true, players: [{ name: "x" }, { name: "y" }, { name: "z" }] });
    assert.equal(res.status, 409, "no new teams once started");
    res = await call("DELETE", `/tournaments/${t.id}/entries/${ids[0]}`);
    assert.equal(res.status, 409, "no withdrawing once started");
    res = await call("PATCH", `/tournaments/${t.id}`, { format: "ROUND_ROBIN" });
    assert.equal(res.status, 409, "format is fixed once started");
    res = await call("POST", `/tournaments/${t.id}/bracket/seed`, { method: "random" });
    assert.equal(res.status, 409);
  });

  test("changes before the start drop the draft", async () => {
    const t = await newTournament();
    const a = await registerTeam(t.id, "D1");
    await registerTeam(t.id, "D2");
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "random" });
    await registerTeam(t.id, "D3");
    assert.equal((await bracket(t.id)).status, "NONE", "a new team drops the draft");
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "rating" });
    await ok("DELETE", `/tournaments/${t.id}/entries/${a.id}`);
    assert.equal((await bracket(t.id)).status, "NONE", "a withdrawal drops the draft");
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "rating" });
    await ok("PATCH", `/tournaments/${t.id}`, { format: "DOUBLE_ELIMINATION" });
    assert.equal((await bracket(t.id)).status, "NONE", "a new format drops the draft");
    const res = await call("POST", `/tournaments/${t.id}/bracket/start`);
    assert.equal(res.status, 409);
  });

  test("teams an organizer adds from the website follow the same rules", async () => {
    const t = await newTournament();
    await registerTeam(t.id, "E1");
    await registerTeam(t.id, "E2");
    const extra = await ok("POST", "/teams", { name: "E3" });
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "rating" });
    await ok("POST", `/tournaments/${t.id}/entries`, { teamId: extra.id });
    assert.equal((await bracket(t.id)).status, "NONE", "an added team drops the draft");
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "rating" });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    const late = await ok("POST", "/teams", { name: "E4" });
    const res = await call("POST", `/tournaments/${t.id}/entries`, { teamId: late.id });
    assert.equal(res.status, 409, "no new teams once the bracket runs");
    assert.equal((await bracket(t.id)).teams.length, 3);
  });
});

describe("live bracket", () => {
  test("results move teams on, record stats and finish the tournament", async () => {
    const t = await newTournament({ thirdPlaceMatch: true, bestOf: 3 });
    const teams: any[] = [];
    for (const name of ["Q1", "Q2", "Q3", "Q4"]) teams.push(await registerTeam(t.id, name));
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: teams.map((x) => x.id) });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);

    // Semis: Q1 v Q4, Q2 v Q3.
    let semi = await byCode(t.id, "W1-0");
    assert.deepEqual([semi.teamA.name, semi.teamB.name], ["Q1", "Q4"]);
    let res = await call("POST", `/tournaments/${t.id}/bracket/matches/${semi.id}/result`, { scoreA: 1, scoreB: 1 });
    assert.equal(res.status, 400, "no draws in knockouts");
    assert.match(res.body.details.th, /ไม่มีผู้ชนะ/);

    const r1 = await ok("POST", `/tournaments/${t.id}/bracket/matches/${semi.id}/result`, { ...series(["A", "B", "A"], { A: "Q1", B: "Q4" }), sourceRef: "discord-msg-1", source: "discord" });
    assert.equal(r1.status, "DONE");
    assert.deepEqual([r1.scoreA, r1.scoreB], [2, 1]);
    assert.ok(r1.matchId);
    const stats = await ok("GET", `/matches/${r1.matchId}`);
    assert.equal(stats.games.length, 3);
    assert.equal(stats.round, "M1 · รอบรองชนะเลิศ");
    assert.deepEqual(stats.bracketSlot, { id: semi.id, code: semi.code, number: 1 }, "the series knows its bracket match");
    assert.equal(stats.players.find((p: any) => p.player.name === "Q1 P1").pts, 21, "stats go to the registered players");
    assert.equal(stats.teamA.rating, 1016, "Elo counts bracket results");

    const again = await ok("POST", `/tournaments/${t.id}/bracket/matches/${semi.id}/result`, { ...series(["A", "B", "A"], { A: "Q1", B: "Q4" }), sourceRef: "discord-msg-1" });
    assert.equal(again.matchId, r1.matchId, "the same post twice is recorded once");

    const final0 = await byCode(t.id, "W2-0");
    assert.equal(final0.teamA.name, "Q1");
    assert.equal(final0.sourceB, "ผู้ชนะ M2");
    const p3 = await byCode(t.id, "P3");
    assert.equal(p3.teamA.name, "Q4");

    // M2 by number, Q3 upsets Q2.
    await ok("POST", `/tournaments/${t.id}/bracket/matches/M2/result`, { scoreA: 0, scoreB: 2 });
    const fin = await byCode(t.id, "W2-0");
    assert.equal(fin.status, "READY");
    assert.equal(fin.teamB.name, "Q3");

    // Rosters lock once the first match has a result.
    res = await call("PUT", `/tournaments/${t.id}/entries/${teams[0].id}/roster`, { players: [{ name: "a" }, { name: "b" }, { name: "c" }] });
    assert.equal(res.status, 409);
    assert.match(res.body.details.th, /เปลี่ยนรายชื่อไม่ได้แล้ว/);
    await ok("PUT", `/tournaments/${t.id}/entries/${teams[0].id}/roster`, { players: [{ name: "Q1 P1" }, { name: "Q1 P2" }, { name: "Q1 P4" }], override: true });

    await ok("POST", `/tournaments/${t.id}/bracket/matches/${p3.id}/result`, { scoreA: 2, scoreB: 0 });
    await ok("POST", `/tournaments/${t.id}/bracket/matches/${fin.id}/result`, { scoreA: 2, scoreB: 1 });
    let b = await bracket(t.id);
    assert.equal(b.status, "DONE");
    assert.deepEqual(b.placements.map((p: any) => [p.placement, p.team.name]), [[1, "Q1"], [2, "Q3"], [3, "Q4"], [4, "Q2"]]);
    let detail = await ok("GET", `/tournaments/${t.id}`);
    assert.equal(detail.status, "COMPLETED");
    assert.equal(detail.teams[0].placement, 1);

    // Correcting the final's score with the same winner keeps everything else.
    res = await call("POST", `/tournaments/${t.id}/bracket/matches/${fin.id}/result`, { scoreA: 2, scoreB: 0 });
    assert.equal(res.status, 409, "a second report doesn't overwrite the first by accident");
    const corrected = await ok("POST", `/tournaments/${t.id}/bracket/matches/${fin.id}/result`, { scoreA: 2, scoreB: 0, replace: true });
    assert.deepEqual([corrected.scoreA, corrected.scoreB], [2, 0]);
    assert.equal((await bracket(t.id)).status, "DONE");

    // Reopening the final un-finishes the tournament.
    await ok("POST", `/tournaments/${t.id}/bracket/matches/${fin.id}/reopen`, {});
    b = await bracket(t.id);
    assert.equal(b.status, "LIVE");
    assert.equal(b.placements.length, 0);
    detail = await ok("GET", `/tournaments/${t.id}`);
    assert.equal(detail.status, "ONGOING");
    assert.equal((await byCode(t.id, "W2-0")).matchId, null, "its series was removed");
  });

  test("changing a winner after later matches were played needs force and wipes them", async () => {
    const t = await newTournament({ format: "DOUBLE_ELIMINATION" });
    const teams: any[] = [];
    for (const name of ["E1", "E2", "E3", "E4"]) teams.push(await registerTeam(t.id, name));
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: teams.map((x) => x.id) });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    const w10 = await ok("POST", `/tournaments/${t.id}/bracket/matches/W1-0/result`, series(["A", "A"], { A: "E1", B: "E4" }));
    await ok("POST", `/tournaments/${t.id}/bracket/matches/W1-1/result`, { scoreA: 2, scoreB: 0 });
    const w2 = await ok("POST", `/tournaments/${t.id}/bracket/matches/W2-0/result`, { scoreA: 2, scoreB: 1 });
    assert.equal((await byCode(t.id, "L1-0")).status, "READY");

    let res = await call("POST", `/tournaments/${t.id}/bracket/matches/W1-0/result`, { ...series(["B", "B"], { A: "E1", B: "E4" }), replace: true });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body.details.affected.map((a: any) => a.code), ["W2-0"]);
    assert.match(res.body.details.th, /M4/);

    const fixed = await ok("POST", `/tournaments/${t.id}/bracket/matches/W1-0/result`, { ...series(["B", "B"], { A: "E1", B: "E4" }), replace: true, force: true });
    assert.equal(fixed.matchId, w10.matchId, "the corrected series keeps its id");
    const after = await bracket(t.id);
    const w2now = after.matches.find((m: any) => m.code === "W2-0");
    assert.equal(w2now.teamA.name, "E4");
    assert.equal(w2now.status, "READY");
    assert.equal(w2now.matchId, null);
    assert.equal((await call("GET", `/matches/${w2.matchId}`)).status, 404, "the wiped series is deleted");
    const l1 = after.matches.find((m: any) => m.code === "L1-0");
    assert.equal(l1.teamA.name, "E1", "E1 dropped to the losers bracket instead");

    // The stats edit form on the website goes through the bracket too.
    res = await call("PUT", `/matches/${w10.matchId}`, { tournamentId: t.id, teamAId: teams[1].id, teamBId: teams[3].id, scoreA: 2, scoreB: 0 });
    assert.equal(res.status, 409, "bracket teams can't be swapped");
    await ok("PUT", `/matches/${w10.matchId}`, { tournamentId: t.id, teamAId: teams[0].id, teamBId: teams[3].id, scoreA: 0, scoreB: 2 });
    res = await call("DELETE", `/matches/${w10.matchId}`);
    assert.equal(res.status, 409, "bracket series are removed by reopening");
  });

  test("check-in, the late allowance and walkovers", async () => {
    const t = await newTournament({ lateMinutes: 15 });
    const a = await registerTeam(t.id, "Early");
    const b = await registerTeam(t.id, "Late");
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: [a.id, b.id] });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    const m = await byCode(t.id, "W1-0");

    await ok("POST", `/tournaments/${t.id}/bracket/schedule`, { match: m.id, scheduledAt: null });
    let res = await call("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/walkover`, { teamId: a.id, mode: "claim" });
    assert.equal(res.status, 409);
    assert.match(res.body.details.th, /ยังไม่ได้กำหนดเวลา/);

    const soon = new Date(Date.now() + 5 * 60_000);
    await ok("POST", `/tournaments/${t.id}/bracket/schedule`, { stage: "W", round: 1, scheduledAt: soon.toISOString() });
    res = await call("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/walkover`, { teamId: a.id, mode: "claim" });
    assert.equal(res.status, 409);
    assert.match(res.body.details.th, /อีกทีมยังมาได้ถึง/);

    // The match started 20 minutes ago; only Early checked in.
    await ok("POST", `/tournaments/${t.id}/bracket/schedule`, { match: "M1", scheduledAt: new Date(Date.now() - 20 * 60_000).toISOString() });
    res = await call("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/walkover`, { teamId: a.id, mode: "claim" });
    assert.equal(res.status, 409);
    assert.match(res.body.details.th, /ต้องกดเช็คอินก่อน/);
    const checked = await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/checkin`, { teamId: a.id });
    assert.ok(checked.checkInA);
    res = await call("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/checkin`, { teamId: "nope" });
    assert.equal(res.status, 400);
    // Late's check-in after the deadline doesn't save them.
    await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/checkin`, { teamId: b.id });
    const wo = await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/walkover`, { teamId: a.id, mode: "claim" });
    assert.equal(wo.outcome, "WALKOVER");
    assert.equal(wo.winnerId, a.id);
    assert.deepEqual([wo.scoreA, wo.scoreB], [2, 0]);
    assert.equal(wo.matchId, null, "a walkover records no stats and no Elo");
    assert.equal((await bracket(t.id)).status, "DONE");

    // Late disputes; the organizer looks into it and overturns.
    const d = await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/dispute`, { note: "เน็ตหลุด มีหลักฐาน" });
    assert.equal(d.disputed, true);
    assert.equal(d.disputeNote, "เน็ตหลุด มีหลักฐาน");
    const over = await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/walkover`, { teamId: b.id, mode: "organizer" });
    assert.equal(over.winnerId, b.id);
    assert.equal(over.disputed, false);
    const placements = (await bracket(t.id)).placements.map((p: any) => p.team.name);
    assert.deepEqual(placements, ["Late", "Early"]);

    // Or replay it: reopen clears the walkover.
    const re = await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/reopen`, {});
    assert.equal(re.status, "READY");
    assert.equal(re.checkInA, null, "check-ins start over");
  });

  test("on-time check-in by both teams means they play", async () => {
    const t = await newTournament({ lateMinutes: 10 });
    const a = await registerTeam(t.id, "OnTime A");
    const b = await registerTeam(t.id, "OnTime B");
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: [a.id, b.id] });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    await ok("POST", `/tournaments/${t.id}/bracket/schedule`, { match: "M1", scheduledAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    await ok("POST", `/tournaments/${t.id}/bracket/matches/M1/checkin`, { teamId: a.id });
    await ok("POST", `/tournaments/${t.id}/bracket/matches/M1/checkin`, { teamId: b.id });
    // An hour later, still no result: both arrived on time, so nobody can claim a walkover.
    const start = new Date(Date.now() - 60 * 60_000);
    const onTime = new Date(start.getTime() + 5 * 60_000);
    await prisma.bracketMatch.updateMany({ where: { tournamentId: t.id }, data: { scheduledAt: start, checkInA: onTime, checkInB: onTime } });
    const res = await call("POST", `/tournaments/${t.id}/bracket/matches/M1/walkover`, { teamId: a.id, mode: "claim" });
    assert.equal(res.status, 409);
    assert.match(res.body.details.th, /ทันเวลา/);
  });

  test("round robin allows draws and ranks by points", async () => {
    const t = await newTournament({ format: "ROUND_ROBIN", bestOf: 1 });
    const teams: any[] = [];
    for (const name of ["R1", "R2", "R3"]) teams.push(await registerTeam(t.id, name));
    const b = await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: teams.map((x) => x.id) });
    assert.equal(b.positions, null);
    assert.equal(b.matches.length, 3);
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    const view = await bracket(t.id);
    for (const m of view.matches) {
      const r1 = [m.teamA.name, m.teamB.name].includes("R1");
      const winnerSide = r1 ? (m.teamA.name === "R1" ? "A" : "B") : null;
      await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/result`, winnerSide === "A" ? { scoreA: 1, scoreB: 0 } : winnerSide === "B" ? { scoreA: 0, scoreB: 1 } : { scoreA: 1, scoreB: 1 });
    }
    const done = await bracket(t.id);
    assert.equal(done.status, "DONE");
    assert.deepEqual(done.standings.map((s: any) => [s.team.name, s.points]), [["R1", 6], ["R2", 1], ["R3", 1]]);
    assert.deepEqual(done.placements.map((p: any) => p.placement), [1, 2, 2]);
  });

  test("two reports at the same moment: exactly one is recorded", async () => {
    const t = await newTournament();
    const a = await registerTeam(t.id, "Race A");
    const b = await registerTeam(t.id, "Race B");
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: [a.id, b.id] });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    const results = await Promise.all([
      call("POST", `/tournaments/${t.id}/bracket/matches/M1/result`, { scoreA: 2, scoreB: 0, sourceRef: "race-1" }),
      call("POST", `/tournaments/${t.id}/bracket/matches/M1/result`, { scoreA: 0, scoreB: 2, sourceRef: "race-2" }),
      call("POST", `/tournaments/${t.id}/bracket/matches/M1/walkover`, { teamId: b.id, mode: "claim" }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
    assert.equal(await prisma.match.count({ where: { tournamentId: t.id } }), 1);
  });

  test("a bracket can be reset; recorded series stay as plain results", async () => {
    const t = await newTournament();
    const a = await registerTeam(t.id, "X1");
    const b = await registerTeam(t.id, "X2");
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: [a.id, b.id] });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    const r = await ok("POST", `/tournaments/${t.id}/bracket/matches/M1/result`, { scoreA: 2, scoreB: 0 });
    assert.equal((await call("DELETE", `/tournaments/${t.id}/bracket`)).status, 409);
    assert.equal((await call("DELETE", `/tournaments/${t.id}/bracket?force=true`)).status, 204);
    const after = await bracket(t.id);
    assert.equal(after.status, "NONE");
    assert.equal(after.matches.length, 0);
    assert.equal((await call("GET", `/matches/${r.matchId}`)).status, 200);
  });

  test("organizers end a tournament early; unplayed matches stay unplayed", async () => {
    const t = await newTournament();
    const notStarted = await call("POST", `/tournaments/${t.id}/bracket/end`);
    assert.equal(notStarted.status, 409);
    assert.match(notStarted.body.error.messageTh ?? JSON.stringify(notStarted.body), /ยังไม่ได้เริ่มแข่ง/);
    const ids = [];
    for (const name of ["E1", "E2", "E3", "E4"]) ids.push((await registerTeam(t.id, name)).id);
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: ids });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    await ok("POST", `/tournaments/${t.id}/bracket/matches/M1/result`, { scoreA: 2, scoreB: 0 });
    const ended = await ok("POST", `/tournaments/${t.id}/bracket/end`);
    assert.equal(ended.status, "DONE");
    assert.equal((await ok("GET", `/tournaments/${t.id}`)).status, "COMPLETED");
    assert.deepEqual(ended.matches.map((m: any) => m.status), ["DONE", "READY", "PENDING"], "nothing is made up");
    const placed = ended.teams.filter((x: any) => x.placement !== null);
    assert.equal(placed.length, 1, "only the team knocked out so far is placed");
    assert.equal(placed[0].placement, 4, "below the three teams still in");
    assert.equal((await ok("POST", `/tournaments/${t.id}/bracket/end`)).status, "DONE", "ending twice is fine");
    const late = await call("POST", `/tournaments/${t.id}/bracket/matches/M2/result`, { scoreA: 2, scoreB: 1 });
    assert.equal(late.status, 409, "no more results once it is over");
  });

  test("a result read from a post written the other way round is turned around", async () => {
    const t = await newTournament();
    const a = await registerTeam(t.id, "Home Side");
    const b = await registerTeam(t.id, "Away Side");
    const original = { ...imageReader };
    try {
      imageReader.enabled = () => true;
      imageReader.read = async () => ({
        teamA: "",
        teamB: "",
        seriesScoreA: null,
        seriesScoreB: null,
        notes: "",
        games: [
          {
            allyScore: 21,
            rivalScore: 10,
            result: "WIN" as const,
            players: [
              ...[1, 2, 3].map((i) => ({ name: `Away Side P${i}`, side: "ally" as const, rating: 10, award: null, pts: 7, reb: 0, blk: 0, stl: 0, ast: 0, lbr: 0 })),
              ...[1, 2, 3].map((i) => ({ name: `Home Side P${i}`, side: "rival" as const, rating: 10, award: null, pts: 3, reb: 0, blk: 0, stl: 0, ast: 0, lbr: 0 })),
            ],
          },
        ],
      });
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
      const form = new FormData();
      form.append("image", new Blob([png], { type: "image/png" }), "g1.png");
      const url = (await ok("POST", "/uploads", form)).url;
      const res = await ok("POST", "/extract/series", { imageUrls: [url], text: "Away Side 1-0 Home Side", teamAId: a.id, teamBId: b.id });
      const d = res.draft;
      assert.deepEqual([d.teamAName, d.teamBName, d.scoreA, d.scoreB], ["Home Side", "Away Side", 0, 1]);
      assert.deepEqual([d.games[0].scoreA, d.games[0].scoreB], [10, 21], "the registered roster puts Away Side on the Ally side");
      assert.ok(!d.warnings.some((w: string) => /ไม่ตรง/.test(w)), d.warnings.join(" / "));
    } finally {
      Object.assign(imageReader, original);
    }
  });
});

/** The blacklist: walkover losers who did not check in lose MMR; organizers lift, add and remove entries. */
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


const player = (id: string) => ok("GET", `/players/${id}`);

/** A started two-team bracket whose first match began 20 minutes ago (15 minutes late allowed). */
async function lateMatch() {
  const t = await newTournament({ lateMinutes: 15 });
  const a = await registerTeam(t.id, `Early ${n}`);
  const b = await registerTeam(t.id, `Late ${n}`);
  await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: [a.id, b.id] });
  await ok("POST", `/tournaments/${t.id}/bracket/start`);
  await ok("POST", `/tournaments/${t.id}/bracket/schedule`, { match: "M1", scheduledAt: new Date(Date.now() - 20 * 60_000).toISOString() });
  const m = await byCode(t.id, "W1-0");
  /** The first team checks in before the match started (on time). */
  const arriveA = async () => {
    await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/checkin`, { teamId: a.id });
    await prisma.bracketMatch.update({ where: { id: m.id }, data: { checkInA: new Date(Date.now() - 25 * 60_000) } });
  };
  return { t, a, b, m, arriveA };
}

describe("blacklist", () => {
  test("a team that loses by walkover without checking in goes on the blacklist and loses 20 MMR each", async () => {
    const { t, a, b, m, arriveA } = await lateMatch();
    await arriveA();
    const wo = await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/walkover`, { teamId: a.id, mode: "claim" });
    assert.equal(wo.blacklist.length, 3, "every player of the team that did not come");
    assert.deepEqual(wo.blacklist.map((e: any) => e.player.name).sort(), b.roster.map((r: any) => r.name).sort());
    assert.equal(wo.blacklist[0].penalty, 20);

    const list = await ok("GET", `/blacklist?tournamentId=${t.id}`);
    assert.equal(list.total, 3);
    assert.equal(list.data[0].reason, "แพ้บาย: ไม่มาเช็คอินตามเวลาแข่ง");
    assert.equal(list.data[0].tournament.id, t.id);
    assert.equal(list.data[0].matchNumber, 1);
    const late = await player(b.roster[0].playerId);
    assert.equal(late.mmr, 980);
    assert.equal(late.blacklist.active, true);
    assert.equal(late.blacklist.penalty, 20);
    const early = await player(a.roster[0].playerId);
    assert.equal(early.mmr, 1000, "the team that came is not touched");
    assert.equal(early.blacklist.active, false);
    assert.equal((await bracket(t.id)).blacklist.length, 3);
  });

  test("overturning or reopening the walkover takes the entries and the penalty away", async () => {
    const { t, a, b, m, arriveA } = await lateMatch();
    await arriveA();
    await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/walkover`, { teamId: a.id, mode: "claim" });
    // The organizer gives it to the late team instead; the early team checked in on time, so nobody is blacklisted.
    const over = await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/walkover`, { teamId: b.id, mode: "organizer", force: true });
    assert.equal(over.blacklist.length, 0);
    assert.equal((await player(b.roster[0].playerId)).mmr, 1000);
    assert.equal((await player(a.roster[0].playerId)).mmr, 1000);
    // Back to the early team: blacklisted again.
    const back = await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/walkover`, { teamId: a.id, mode: "organizer", force: true });
    assert.equal(back.blacklist.length, 3);
    await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/reopen`, {});
    assert.equal((await ok("GET", `/blacklist?tournamentId=${t.id}&status=all`)).total, 0);
    assert.equal((await player(b.roster[1].playerId)).mmr, 1000);
  });

  test("an organizer's walkover counts the same when the losing team never checked in", async () => {
    const { t, a, b, m } = await lateMatch();
    const wo = await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/walkover`, { teamId: b.id, mode: "organizer" });
    assert.deepEqual(wo.blacklist.map((e: any) => e.teamName), Array(3).fill(a.name));
  });

  test("a team added by an organizer without a roster counts its current players", async () => {
    const t = await newTournament({ lateMinutes: 15 });
    const teams = [];
    for (const name of [`Squad A${n}`, `Squad B${n}`]) {
      const team = await ok("POST", "/teams", { name });
      for (const i of [1, 2]) await ok("POST", "/players", { name: `${name} M${i}`, teamId: team.id });
      await ok("POST", `/tournaments/${t.id}/entries`, { teamId: team.id });
      teams.push(team);
    }
    await ok("POST", `/tournaments/${t.id}/bracket/seed`, { method: "manual", order: teams.map((x) => x.id) });
    await ok("POST", `/tournaments/${t.id}/bracket/start`);
    const wo = await ok("POST", `/tournaments/${t.id}/bracket/matches/M1/walkover`, { teamId: teams[0].id, mode: "organizer" });
    assert.deepEqual(wo.blacklist.map((e: any) => e.player.name).sort(), [`${teams[1].name} M1`, `${teams[1].name} M2`]);
  });

  test("lifting gives the MMR back and stays lifted; organizers add and remove entries by hand", async () => {
    const { t, a, b, m, arriveA } = await lateMatch();
    await arriveA();
    const wo = await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/walkover`, { teamId: a.id, mode: "claim" });
    const entry = wo.blacklist[0];
    const lifted = await ok("PATCH", `/blacklist/${entry.id}`, { lifted: true, note: "แจ้งเหตุล่วงหน้าแล้ว" });
    assert.ok(lifted.liftedAt);
    assert.equal(lifted.liftNote, "แจ้งเหตุล่วงหน้าแล้ว");
    assert.equal((await player(entry.player.id)).mmr, 1000);
    assert.equal((await player(entry.player.id)).blacklist.active, false);
    // The bracket changing again does not bring a lifted entry back.
    await ok("POST", `/tournaments/${t.id}/bracket/matches/${m.id}/walkover`, { teamId: a.id, mode: "organizer" });
    assert.equal((await ok("GET", `/blacklist?tournamentId=${t.id}`)).total, 2);
    assert.equal((await ok("GET", `/blacklist?tournamentId=${t.id}&status=lifted`)).total, 1);
    // Force majeure: the organizer keeps the entry but takes nothing (or less).
    const other = wo.blacklist[1];
    assert.equal((await ok("PATCH", `/blacklist/${other.id}`, { penalty: 0 })).penalty, 0);
    assert.equal((await player(other.player.id)).mmr, 1000);
    assert.equal((await ok("PATCH", `/blacklist/${other.id}`, { penalty: 10 })).penalty, 10);
    assert.equal((await player(other.player.id)).mmr, 990);
    assert.equal((await call("PATCH", `/blacklist/${other.id}`, { penalty: -5 })).status, 400);
    let res = await call("DELETE", `/blacklist/${entry.id}`);
    assert.equal(res.status, 409, "automatic entries are lifted, not deleted");
    await ok("PATCH", `/blacklist/${entry.id}`, { lifted: false });
    assert.equal((await player(entry.player.id)).mmr, 980);

    const someone = b.roster[0].playerId === entry.player.id ? a.roster[0].playerId : a.roster[1].playerId;
    const added = await ok("POST", "/blacklist", { playerId: someone, reason: "พูดจาไม่สุภาพ", penalty: 50 });
    assert.equal(added.source, "ADMIN");
    assert.equal((await player(someone)).mmr, 950);
    res = await call("POST", "/blacklist", { playerId: "nope", reason: "x" });
    assert.equal(res.status, 404);
    res = await call("POST", "/blacklist", { playerId: someone, reason: "" });
    assert.equal(res.status, 400);
    await ok("DELETE", `/blacklist/${added.id}`);
    assert.equal((await player(someone)).mmr, 1000);
  });

  test("anyone with a key reads the blacklist; only admin keys change it", async () => {
    const read = (method: string, url: string, body?: unknown) =>
      fetch(`${base}/api/v1${url}`, { method, headers: { "X-API-Key": reader, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await read("GET", "/blacklist")).status, 200);
    const list = await ok("GET", "/blacklist");
    assert.equal((await read("POST", "/blacklist", { playerId: list.data[0].player.id, reason: "x" })).status, 403);
    assert.equal((await read("PATCH", `/blacklist/${list.data[0].id}`, { lifted: true })).status, 403);
    assert.equal((await fetch(`${base}/api/v1/blacklist`)).status, 401);
  });
});

describe("protection", () => {
  test("responses carry hardening headers", async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  test("an internet address that keeps guessing API keys is made to wait; the website and bot on this computer are not", async () => {
    const from = (ip: string, key: string) => fetch(`${base}/api/v1/blacklist`, { headers: { "X-API-Key": key, "CF-Connecting-IP": ip } });
    for (let i = 0; i < 20; i++) assert.equal((await from("203.0.113.7", `trk_wrong${i}`)).status, 401);
    const blocked = await from("203.0.113.7", admin);
    assert.equal(blocked.status, 429, "even the right key waits once the address is blocked");
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.match((await blocked.json()).details.th, /บ่อยเกินไป/);
    assert.equal((await from("203.0.113.8", admin)).status, 200, "other addresses are fine");
    for (let i = 0; i < 25; i++) await fetch(`${base}/api/v1/blacklist`, { headers: { "X-API-Key": `trk_local${i}` } });
    assert.equal((await fetch(`${base}/api/v1/blacklist`, { headers: { "X-API-Key": admin } })).status, 200, "local callers are never blocked");
  });
});

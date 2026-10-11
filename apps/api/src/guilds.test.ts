/** Guilds: leader-only invites by UID, accept on the profile, organizers change leader and size. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-guild-test-"));
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

const D = { lead: "100000000001", amy: "100000000002", bob: "100000000003", cat: "100000000004", eve: "100000000005" };
const ids: Record<string, string> = {};
let gameId: string;

/** A character with a UID, linked to a Discord account (or not). */
async function character(key: string, mmr: number, discordId: string | null, game = gameId) {
  const p = await prisma.player.create({ data: { name: `P-${key}`, uid: `U${key}`, discordId, mmr, gameId: game } });
  ids[key] = p.id;
  return p;
}

const act = (who: string, action: string, body: Record<string, unknown>) => call("POST", `/members/${who}/guild/${action}`, body);

describe("guilds", () => {
  let guildId: string;

  test("anyone starts a guild and leads it; names are unique", async () => {
    gameId = (await prisma.game.create({ data: { name: "Kuroko" } })).id;
    await character("lead", 1500, D.lead);
    await character("amy", 1300, D.amy);
    await character("bob", 1100, D.bob);
    await character("cat", 900, null);
    await character("eve", 1000, D.eve, (await prisma.game.create({ data: { name: "Other" } })).id);

    const made = await act(D.lead, "create", { playerId: ids.lead, name: "Overtime Club", tag: "OTC" });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    guildId = made.body.id;
    assert.equal(made.body.capacity, 200);
    assert.equal(made.body.leaderId, ids.lead);
    assert.equal(made.body.gameId, gameId);

    const dup = await act(D.amy, "create", { playerId: ids.amy, name: "overtime-club" });
    assert.equal(dup.status, 409);
    const notMine = await act(D.amy, "create", { playerId: ids.lead, name: "Other Club" });
    assert.equal(notMine.status, 403);
  });

  test("only the leader invites, by UID; the invited player accepts on their profile", async () => {
    const byMember = await act(D.amy, "invite", { playerId: ids.amy, uid: "Ubob" });
    assert.equal(byMember.status, 409, "amy is not in a guild yet");
    const unknown = await act(D.lead, "invite", { playerId: ids.lead, uid: "nobody" });
    assert.equal(unknown.status, 404);
    const otherGame = await act(D.lead, "invite", { playerId: ids.lead, uid: "Ueve" });
    assert.equal(otherGame.status, 400);

    for (const k of ["amy", "bob", "cat"]) {
      const r = await act(D.lead, "invite", { playerId: ids.lead, uid: `U${k}` });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    // Inviting twice keeps one invite.
    await act(D.lead, "invite", { playerId: ids.lead, uid: "Uamy" });
    const lead = (await ok("GET", `/members/${D.lead}`)).data[0];
    assert.equal(lead.guild.isLeader, true);
    assert.equal(lead.guild.invites.length, 3);

    const amy = (await ok("GET", `/members/${D.amy}`)).data[0];
    assert.equal(amy.guild, null);
    assert.equal(amy.guildInvites.length, 1);
    assert.equal(amy.guildInvites[0].guild.name, "Overtime Club");

    // Someone else can't accept amy's invite.
    const stolen = await act(D.bob, "accept", { playerId: ids.bob, inviteId: amy.guildInvites[0].id });
    assert.equal(stolen.status, 404);
    await ok("POST", `/members/${D.amy}/guild/accept`, { playerId: ids.amy, inviteId: amy.guildInvites[0].id });
    const bob = (await ok("GET", `/members/${D.bob}`)).data[0];
    await ok("POST", `/members/${D.bob}/guild/decline`, { playerId: ids.bob, inviteId: bob.guildInvites[0].id });

    // A member who isn't the leader can't invite or kick.
    assert.equal((await act(D.amy, "invite", { playerId: ids.amy, uid: "Ubob" })).status, 403);
    assert.equal((await act(D.amy, "kick", { playerId: ids.amy, memberId: ids.lead })).status, 403);

    const after = (await ok("GET", `/members/${D.lead}`)).data[0];
    assert.equal(after.guild.memberCount, 2);
    assert.deepEqual(after.guild.invites.map((i: { player: { name: string } }) => i.player.name), ["P-cat"]);
    await ok("POST", `/members/${D.lead}/guild/cancel-invite`, { playerId: ids.lead, inviteId: after.guild.invites[0].id });
    assert.equal((await ok("GET", `/members/${D.lead}`)).data[0].guild.invites.length, 0);
  });

  test("the guild page ranks members by MMR among those who have played", async () => {
    const t = await prisma.tournament.create({ data: { name: "Cup", startDate: new Date() } });
    const [a, b] = await Promise.all([prisma.team.create({ data: { name: "A" } }), prisma.team.create({ data: { name: "B" } })]);
    const match = await prisma.match.create({ data: { tournamentId: t.id, teamAId: a.id, teamBId: b.id, scoreA: 1, scoreB: 0, winnerId: a.id } });
    for (const k of ["lead", "amy"]) await prisma.playerMmrChange.create({ data: { playerId: ids[k], matchId: match.id, before: 1000, delta: 10, result: "W" } });
    // amy outscores the leader.
    await prisma.player.update({ where: { id: ids.amy }, data: { mmr: 1600 } });

    const g = await call("GET", `/guilds/${guildId}`, undefined, reader);
    assert.equal(g.status, 200);
    assert.equal(g.body.memberCount, 2);
    assert.equal(g.body.top.name, "P-amy");
    assert.equal(g.body.leader.name, "P-lead");
    assert.deepEqual(g.body.members.map((m: { name: string; guildRank: number | null }) => [m.name, m.guildRank]), [["P-amy", 1], ["P-lead", 2]]);

    const list = await call("GET", `/guilds?search=Overtime`, undefined, reader);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.data[0].memberCount, 2);
    assert.equal(list.body.data[0].top.name, "P-amy");

    const player = await call("GET", `/players/${ids.amy}`, undefined, reader);
    assert.equal(player.body.guild.name, "Overtime Club");
  });

  test("a full guild refuses invites and joins; organizers raise the size", async () => {
    assert.equal((await call("PATCH", `/guilds/${guildId}`, { capacity: 1 })).status, 400, "below member count");
    await ok("PATCH", `/guilds/${guildId}`, { capacity: 2 });
    const full = await act(D.lead, "invite", { playerId: ids.lead, uid: "Ubob" });
    assert.equal(full.status, 409);
    assert.equal((await call("PATCH", `/guilds/${guildId}`, { capacity: 2 }, reader)).status, 403);

    await ok("PATCH", `/guilds/${guildId}`, { capacity: 3 });
    await ok("POST", `/members/${D.lead}/guild/invite`, { playerId: ids.lead, uid: "Ubob" });
    const bobInvite = (await ok("GET", `/members/${D.bob}`)).data[0].guildInvites[0];
    // The guild filled up after the invite went out: accepting waits for room.
    await ok("PATCH", `/guilds/${guildId}`, { capacity: 2 });
    assert.equal((await act(D.bob, "accept", { playerId: ids.bob, inviteId: bobInvite.id })).status, 409);
    await ok("PATCH", `/guilds/${guildId}`, { capacity: 3 });
    await ok("POST", `/members/${D.bob}/guild/accept`, { playerId: ids.bob, inviteId: bobInvite.id });
    assert.equal((await ok("GET", `/guilds/${guildId}`)).memberCount, 3);
  });

  test("organizers change the leader to a member only", async () => {
    assert.equal((await call("PATCH", `/guilds/${guildId}`, { leaderId: ids.cat })).status, 400);
    await ok("PATCH", `/guilds/${guildId}`, { leaderId: ids.amy, name: "Overtime Club II" });
    const g = await ok("GET", `/guilds/${guildId}`);
    assert.equal(g.leader.name, "P-amy");
    assert.equal(g.name, "Overtime Club II");
    // The old leader is a plain member now.
    assert.equal((await act(D.lead, "kick", { playerId: ids.lead, memberId: ids.bob })).status, 403);
  });

  test("leader hands over, kicks, and leaving last closes the guild", async () => {
    await ok("POST", `/members/${D.amy}/guild/leader`, { playerId: ids.amy, memberId: ids.lead });
    await ok("POST", `/members/${D.lead}/guild/kick`, { playerId: ids.lead, memberId: ids.bob });
    await ok("POST", `/members/${D.lead}/guild/edit`, { playerId: ids.lead, description: "Thai Kuroko club" });
    assert.equal((await ok("GET", `/guilds/${guildId}`)).description, "Thai Kuroko club");

    // The leader leaves: amy (the other member) leads.
    await ok("POST", `/members/${D.lead}/guild/leave`, { playerId: ids.lead });
    assert.equal((await ok("GET", `/guilds/${guildId}`)).leader.name, "P-amy");
    const closed = await ok("POST", `/members/${D.amy}/guild/leave`, { playerId: ids.amy });
    assert.equal(closed.closed, true);
    assert.equal((await call("GET", `/guilds/${guildId}`)).status, 404);
  });

  test("organizers remove members and delete guilds", async () => {
    const g = await ok("POST", `/members/${D.lead}/guild/create`, { playerId: ids.lead, name: "Second" });
    await ok("POST", `/members/${D.lead}/guild/invite`, { playerId: ids.lead, uid: "Uamy" });
    const inv = (await ok("GET", `/members/${D.amy}`)).data[0].guildInvites[0];
    await ok("POST", `/members/${D.amy}/guild/accept`, { playerId: ids.amy, inviteId: inv.id });
    const removed = await ok("DELETE", `/guilds/${g.id}/members/${ids.lead}`);
    assert.equal(removed.leader, ids.amy);
    assert.equal((await call("DELETE", `/guilds/${g.id}`, undefined, reader)).status, 403);
    assert.equal((await call("DELETE", `/guilds/${g.id}`)).status, 204);
    assert.equal((await prisma.player.findUnique({ where: { id: ids.amy } }))!.guildId, null);
  });

  test("guilds rank by the average MMR of their best players who have played", async () => {
    const a = await ok("POST", `/members/${D.lead}/guild/create`, { playerId: ids.lead, name: "Alpha Guild" });
    const b = await ok("POST", `/members/${D.amy}/guild/create`, { playerId: ids.amy, name: "Beta Guild" });
    await ok("POST", `/members/${D.amy}/guild/invite`, { playerId: ids.amy, uid: "Ubob" });
    const inv = (await ok("GET", `/members/${D.bob}`)).data[0].guildInvites[0];
    await ok("POST", `/members/${D.bob}/guild/accept`, { playerId: ids.bob, inviteId: inv.id });
    // bob hasn't played: Beta's score is amy's 1600 alone, above Alpha's 1500.
    const list = await ok("GET", "/guilds");
    assert.deepEqual(list.data.map((g: { name: string; rank: number; score: number }) => [g.name, g.rank, g.score]), [["Beta Guild", 1, 1600], ["Alpha Guild", 2, 1500]]);
    assert.equal(list.data[0].top.name, "P-amy");
    const searched = await ok("GET", "/guilds?search=alpha");
    assert.equal(searched.data[0].rank, 2, "a search keeps the real rank");
    assert.equal((await ok("GET", `/guilds/${a.id}`)).rank, 2);
    assert.equal((await ok("GET", `/guilds/${b.id}`)).score, 1600);
  });
});

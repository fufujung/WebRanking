/** SOLO tournaments: players sign up alone and are drawn into balanced teams. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-solo-test-"));
fs.writeFileSync(path.join(tmp, "test.db"), "");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db").replaceAll("\\", "/")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: process.env });

const { createApp } = await import("./app.js");
const { createApiKey } = await import("./lib/apiKeys.js");
const { prisma } = await import("./lib/db.js");
const { balanceTeams, positionGap } = await import("./lib/solo.js");

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

type Pos = "GUARD" | "FORWARD" | "CENTER" | "ALL";

describe("balanceTeams", () => {
  test("every team covers Guard, Forward and Center and ranks are mixed", () => {
    // 4 of each role; ranks 0-3 so strong players bunch in one role.
    const players = (["GUARD", "FORWARD", "CENTER"] as Pos[]).flatMap((position, r) =>
      [0, 1, 2, 3].map((rank) => ({ id: `${position}-${rank}`, rank, mmr: 1000 + rank * 10 + r, position })),
    );
    for (let i = 0; i < 20; i++) {
      const teams = balanceTeams(players, 3);
      assert.equal(teams.length, 4);
      assert.equal(new Set(teams.flat().map((p) => p.id)).size, 12);
      for (const t of teams) assert.equal(positionGap(t), 0, JSON.stringify(t.map((p) => p.position)));
      const totals = teams.map((t) => t.reduce((n, p) => n + p.rank, 0));
      assert.ok(Math.max(...totals) - Math.min(...totals) <= 1, `rank totals ${totals}`);
    }
  });

  test("All Around fills a missing position; impossible coverage still makes full teams", () => {
    const players = [
      { id: "g1", rank: 3, mmr: 1000, position: "GUARD" as Pos },
      { id: "g2", rank: 0, mmr: 1000, position: "GUARD" as Pos },
      { id: "a1", rank: 2, mmr: 1000, position: "ALL" as Pos },
      { id: "a2", rank: 1, mmr: 1000, position: "ALL" as Pos },
      { id: "c1", rank: 1, mmr: 1000, position: "CENTER" as Pos },
      { id: "c2", rank: 2, mmr: 1000, position: "CENTER" as Pos },
    ];
    const teams = balanceTeams(players, 3);
    for (const t of teams) assert.equal(positionGap(t), 0);
    const allGuards = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, rank: i % 3, mmr: 1000, position: "GUARD" as Pos }));
    const forced = balanceTeams(allGuards, 3);
    assert.equal(forced.length, 2);
    assert.ok(forced.every((t) => t.length === 3));
  });

  test("fewer players than one team gives no teams", () => {
    assert.deepEqual(balanceTeams([{ id: "x", rank: 0, mmr: 1000, position: "ALL" }], 3), []);
  });
});

describe("SOLO tournament", () => {
  const positions: Pos[] = ["GUARD", "FORWARD", "CENTER", "ALL", "GUARD", "FORWARD", "CENTER"];
  const ranks = ["Bronze", "Silver", "Gold", "Diamond"];
  let tid: string;
  const ids: { discord: string; player: string }[] = [];

  before(async () => {
    const t = await ok("POST", "/tournaments", {
      name: "Solo Cup", game: "Kuroko", startDate: new Date().toISOString(), format: "SINGLE_ELIMINATION",
      entryMode: "SOLO", teamSize: 3, registrationOpen: true,
    });
    tid = t.id;
    // The game's ranks (lowest first) are what players pick from; icons are optional.
    assert.deepEqual((await ok("GET", `/tournaments/${tid}/solo`)).ranks.map((r: { name: string }) => r.name), ["แม่ทัพไร้มงกุฎ", "ซูเปอร์สตาร์ ม.ปลาย", "รุ่นแห่งปาฏิหาริย์", "เจ้าแห่ง ZONE"]);
    assert.equal((await call("PATCH", `/games/${t.gameId}`, { ranks: [{ name: "Gold" }, { name: "gold" }] })).status, 400);
    assert.equal((await call("PATCH", `/games/${t.gameId}`, { ranks: [{ name: "Gold", iconUrl: "javascript:alert(1)" }] })).status, 400);
    const game = await ok("PATCH", `/games/${t.gameId}`, { ranks: ranks.map((name, i) => ({ name, iconUrl: i === 3 ? "/uploads/diamond.png" : null })) });
    assert.equal(game.name, "Kuroko");
    assert.deepEqual(game.ranks[3], { name: "Diamond", iconUrl: "/uploads/diamond.png" });
    assert.equal((await ok("GET", `/tournaments/${tid}/solo`)).ranks[3].iconUrl, "/uploads/diamond.png");
    for (let i = 0; i < 7; i++) {
      const discord = `55500000000000000${i}`;
      const player = (await ok("POST", `/players/discord/${discord}/claim`, { uid: `9100${i}`, name: `Solo${i}` })).id;
      ids.push({ discord, player });
    }
  });

  test("members sign up with position and rank; checks ownership, rank and switching", async () => {
    for (const [i, { discord, player }] of ids.entries()) {
      await ok("POST", `/members/${discord}/solo/${tid}`, { playerId: player, position: positions[i], rank: ranks[i % 4] });
    }
    assert.equal((await call("POST", `/members/${ids[0].discord}/solo/${tid}`, { playerId: ids[1].player, position: "GUARD", rank: "Gold" })).status, 403);
    assert.equal((await call("POST", `/members/${ids[0].discord}/solo/${tid}`, { playerId: ids[0].player, position: "GUARD", rank: "Mythic" })).status, 400);
    assert.equal((await call("POST", `/members/${ids[0].discord}/solo/${tid}`, { playerId: ids[0].player, position: "SNIPER", rank: "Gold" })).status, 400);
    // Changing position again updates the same sign-up.
    const view = await ok("POST", `/members/${ids[0].discord}/solo/${tid}`, { playerId: ids[0].player, position: "ALL", rank: "Diamond" });
    assert.equal(view.signups.length, 7);
    assert.equal(view.signups.find((s: { playerId: string }) => s.playerId === ids[0].player).position, "ALL");
    assert.equal((await ok("GET", `/players/${ids[0].player}`)).role, "ALL", "the position picked is the player's position on the website too");
    // Public list; reader key works.
    const pub = await call("GET", `/tournaments/${tid}/solo`, undefined, reader);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.signups.length, 7);
    // Leaving and coming back.
    await ok("DELETE", `/members/${ids[6].discord}/solo/${tid}`);
    assert.equal((await ok("GET", `/tournaments/${tid}/solo`)).signups.length, 6);
    await ok("POST", `/members/${ids[6].discord}/solo/${tid}`, { playerId: ids[6].player, position: "CENTER", rank: "Bronze" });
  });

  test("positions: one of four, set from Discord, typed any common way, older text tidied", async () => {
    const [me] = ids;
    const set = await ok("POST", `/members/${me.discord}/position`, { position: "CENTER" });
    assert.deepEqual(set.players.map((p: { id: string }) => p.id), [me.player]);
    assert.equal((await ok("GET", `/players/${me.player}`)).role, "CENTER");
    assert.equal((await call("POST", `/members/${me.discord}/position`, { position: "SNIPER" })).status, 400);
    assert.equal((await call("POST", `/members/999999999999999999/position`, { position: "GUARD" })).status, 404, "no linked character");

    // The admin and /me forms send a code; older typed words still map to one.
    assert.equal((await ok("PATCH", `/players/${me.player}`, { role: "เซ็นเตอร์" })).role, "CENTER");
    assert.equal((await ok("PATCH", `/players/${me.player}`, { role: "forward" })).role, "FORWARD");
    assert.equal((await ok("PATCH", `/players/${me.player}`, { role: "" })).role, null);
    assert.equal((await call("PATCH", `/players/${me.player}`, { role: "Duelist" })).status, 400);

    // Saved before positions were a fixed choice: words become codes, blanks take the solo sign-up.
    const { prisma } = await import("./lib/db.js");
    const { backfillPositions } = await import("./lib/players.js");
    await prisma.player.update({ where: { id: me.player }, data: { role: null } });
    await prisma.player.update({ where: { id: ids[1].player }, data: { role: "Guard" } });
    await prisma.player.update({ where: { id: ids[2].player }, data: { role: "Duelist" } });
    await backfillPositions();
    const role = async (id: string) => (await ok("GET", `/players/${id}`)).role;
    assert.equal(await role(me.player), "ALL", "from the sign-up");
    assert.equal(await role(ids[1].player), "GUARD");
    assert.equal(await role(ids[2].player), "Duelist", "other text is left alone");
    await prisma.player.update({ where: { id: ids[2].player }, data: { role: "CENTER" } });
  });

  test("a SOLO tournament refuses team registration from the bot", async () => {
    const res = await call("POST", `/tournaments/${tid}/registrations`, { teamName: "Sneaky", players: [{ name: "a" }, { name: "b" }, { name: "c" }] });
    assert.equal(res.status, 409);
  });

  test("a team tournament refuses solo sign-ups", async () => {
    const team = await ok("POST", "/tournaments", { name: "Team Cup", startDate: new Date().toISOString(), registrationOpen: true });
    assert.equal((await call("POST", `/members/${ids[0].discord}/solo/${team.id}`, { playerId: ids[0].player, position: "ALL", rank: "Gold" })).status, 409);
  });

  test("the draw proposes full teams and a reserve, then confirmed teams become entries", async () => {
    assert.equal((await call("POST", `/tournaments/${tid}/solo/draw`, undefined, reader)).status, 403);
    const draw = await ok("POST", `/tournaments/${tid}/solo/draw`);
    assert.equal(draw.teams.length, 2);
    assert.ok(draw.teams.every((t: { players: unknown[] }) => t.players.length === 3));
    assert.equal(draw.reserves.length, 1);
    assert.equal(draw.reserves[0].playerId, ids[6].player, "the latest sign-up is the reserve");
    const teams = draw.teams.map((t: { players: { playerId: string }[] }) => t.players.map((p) => p.playerId));
    assert.equal((await call("POST", `/tournaments/${tid}/solo/teams`, { teams: [teams[0], teams[1].slice(0, 2)] })).status, 400);
    const saved = await ok("POST", `/tournaments/${tid}/solo/teams`, { teams });
    assert.equal(saved.drawn, true);
    const t = await ok("GET", `/tournaments/${tid}`);
    assert.equal(t.teams.length, 2);
    assert.equal(t.teams[0].roster.length, 3);
    assert.ok(t.teams[0].captainDiscordId);
    // The drawn team's page shows who plays for it; players keep their own team.
    const detail = await ok("GET", `/teams/${t.teams[0].id}`);
    assert.equal(detail.players.length, 3);
    assert.equal((await ok("GET", `/players/${ids[0].player}`)).teamId, null);
    // Sign-ups are closed after the draw.
    assert.equal((await call("POST", `/members/${ids[6].discord}/solo/${tid}`, { playerId: ids[6].player, position: "CENTER", rank: "Gold" })).status, 409);
    // Drawing again must replace on purpose; the old drawn teams are removed.
    const again = await call("POST", `/tournaments/${tid}/solo/teams`, { teams });
    assert.equal(again.status, 409);
    assert.equal(again.body.details.needsReplace, true);
    await ok("POST", `/tournaments/${tid}/solo/teams`, { teams: [teams[1], teams[0]], replace: true });
    assert.equal((await call("GET", `/teams/${t.teams[0].id}`)).status, 404);
    assert.equal((await ok("GET", `/tournaments/${tid}`)).teams.length, 2);
  });

  test("a scoreboard name on a drawn team counts for its rostered player", async () => {
    const t = await ok("GET", `/tournaments/${tid}`);
    await ok("POST", `/tournaments/${tid}/bracket/seed`, { method: "random" });
    await ok("POST", `/tournaments/${tid}/bracket/start`);
    const [a, b] = t.teams;
    const bracket = await ok("GET", `/tournaments/${tid}/bracket`);
    const final = bracket.matches.find((m: { teamA: { id: string } | null; teamB: { id: string } | null }) => m.teamA && m.teamB);
    const sideOf = (teamId: string) => (final.teamA.id === teamId ? "A" : "B");
    const row = (side: string, name: string, pts: number) => ({ side, name, pts, reb: 1, blk: 0, stl: 0, ast: 0, lbr: 0 });
    const players = [...a.roster.map((r: { name: string }) => row(sideOf(a.id), r.name, 7)), ...b.roster.map((r: { name: string }) => row(sideOf(b.id), r.name, 5))];
    await ok("POST", `/tournaments/${tid}/bracket/matches/${final.id}/result`, { games: [{ scoreA: 21, scoreB: 15, players }, { scoreA: 21, scoreB: 18, players }] });
    const lines = await prisma.matchPlayerStat.findMany({ where: { match: { tournamentId: tid } }, select: { playerId: true, teamId: true } });
    const rostered = new Set([...a.roster, ...b.roster].map((r: { playerId: string }) => r.playerId));
    assert.ok(lines.length > 0);
    assert.ok(lines.every((l) => rostered.has(l.playerId)), "no new players were made from scoreboard names");
  });
});

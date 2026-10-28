/** Player identity by UID across name changes, name history, merging duplicates, and player MMR. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-players-test-"));
fs.writeFileSync(path.join(tmp, "test.db"), "");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db").replaceAll("\\", "/")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: process.env });

const { createApp } = await import("./app.js");
const { createApiKey } = await import("./lib/apiKeys.js");
const { prisma } = await import("./lib/db.js");
const { scoreSeries, tierOf, tierProgress, TIERS, PLACEMENT_SERIES } = await import("./lib/mmr.js");
const { backfillPlayerUids } = await import("./lib/players.js");

let server: Server;
let base: string;
let admin: string;

async function call(method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = { "X-API-Key": admin };
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
});

after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const row = (side: "A" | "B", who: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ side, pts: 5, reb: 1, blk: 0, stl: 0, ast: 1, lbr: 0, ...who, ...extra });

describe("MMR maths", () => {
  test("equal sides: placement win +24, settled win +16, loss the mirror", () => {
    const ratings = new Map<string, { mmr: number; series: number }>();
    const players = [{ playerId: "a", side: "A" as const, mvp: 0, svp: 0 }, { playerId: "b", side: "B" as const, mvp: 0, svp: 0 }];
    assert.deepEqual(scoreSeries(players, "A", ratings, { A: 1000, B: 1000 }).map((c) => [c.playerId, c.before, c.delta, c.result]), [["a", 1000, 24, "W"], ["b", 1000, -24, "L"]]);
    ratings.set("a", { mmr: 1000, series: PLACEMENT_SERIES });
    ratings.set("b", { mmr: 1000, series: PLACEMENT_SERIES });
    assert.deepEqual(scoreSeries(players, "B", ratings, { A: 1000, B: 1000 }).map((c) => c.delta), [-16, 16]);
  });

  test("MVP and SVP add a bonus; a draw between equals changes only the bonus", () => {
    const ratings = new Map([["a", { mmr: 1000, series: 9 }], ["b", { mmr: 1000, series: 9 }]]);
    const out = scoreSeries([{ playerId: "a", side: "A", mvp: 2, svp: 0 }, { playerId: "b", side: "B", mvp: 0, svp: 1 }], null, ratings, { A: 0, B: 0 });
    assert.deepEqual(out.map((c) => [c.delta, c.result]), [[4, "D"], [1, "D"]]);
    assert.equal(ratings.get("a")!.mmr, 1004);
  });

  test("beating a stronger side pays more; a side without a scoreboard uses its team rating", () => {
    const ratings = new Map([["a", { mmr: 900, series: 9 }]]);
    const [up] = scoreSeries([{ playerId: "a", side: "A", mvp: 0, svp: 0 }], "A", ratings, { A: 0, B: 1100 });
    assert.equal(up.delta, 24);
  });

  test("tiers cover every rating, in order, with progress to the next one", () => {
    assert.equal(tierOf(0).key, "bronze");
    assert.equal(tierOf(1000).key, "gold");
    assert.equal(tierOf(1049).key, "gold");
    assert.equal(tierOf(1050).key, "platinum");
    assert.equal(tierOf(5000).key, "legend");
    for (let i = 1; i < TIERS.length; i++) assert.ok(TIERS[i].min > TIERS[i - 1].min && TIERS[i - 1].next === TIERS[i].min);
    assert.deepEqual(tierProgress(1000), { tier: tierOf(1000), progress: 33, toNext: 50 });
    assert.equal(tierProgress(1400).progress, 100);
    assert.equal(tierProgress(850).progress, 50);
  });
});

describe("player MMR from results", () => {
  const ids: Record<string, string> = {};

  test("each series moves every player on its scoreboard", async () => {
    ids.cup = (await ok("POST", "/tournaments", { name: "MMR Cup", startDate: "2026-01-01" })).id;
    ids.A = (await ok("POST", "/teams", { name: "Aces" })).id;
    ids.B = (await ok("POST", "/teams", { name: "Bolts" })).id;
    for (const [n, t] of [["a1", "A"], ["a2", "A"], ["b1", "B"], ["b2", "B"]]) ids[n] = (await ok("POST", "/players", { name: n, teamId: ids[t] })).id;
    const play = (day: number, winner: "A" | "B", mvp?: string) =>
      ok("POST", "/matches", {
        tournamentId: ids.cup, teamAId: ids.A, teamBId: ids.B, playedAt: `2026-01-0${day}T12:00:00Z`,
        games: [{
          scoreA: winner === "A" ? 21 : 10, scoreB: winner === "A" ? 10 : 21,
          players: ["a1", "a2", "b1", "b2"].map((p) => row(p.startsWith("a") ? "A" : "B", { playerId: ids[p] }, p === mvp ? { award: "MVP" } : {})),
        }],
      });
    ids.m1 = (await play(1, "A", "a1")).id;
    let a1 = await ok("GET", `/players/${ids.a1}`);
    assert.equal(a1.mmr, 1026, "placement win (+24) plus MVP bonus (+2)");
    assert.equal(a1.peakMmr, 1026);
    assert.equal(a1.series, 1);
    assert.equal(a1.placed, false);
    assert.equal(a1.seriesToPlace, 2);
    assert.equal(a1.mmrRank, null, "not ranked while placing");
    assert.equal((await ok("GET", `/players/${ids.b1}`)).mmr, 976);

    await play(2, "B");
    ids.m3 = (await play(3, "A")).id;
    a1 = await ok("GET", `/players/${ids.a1}`);
    assert.equal(a1.series, 3);
    assert.equal(a1.placed, true);
    assert.deepEqual(a1.mmrHistory.map((h: any) => h.result), ["W", "L", "W"], "history oldest first");
    assert.equal(a1.mmrHistory.at(-1).after, a1.mmr);
    assert.equal(a1.mmrHistory[1].before, a1.mmrHistory[0].after, "each series starts where the last ended");
    assert.equal(a1.tier.key, tierOf(a1.mmr).key);
    assert.equal(a1.mmrRank, 1);
  });

  test("the ladder: ranked players with tier, form and movement; tier counts and rules", async () => {
    const ladder = await ok("GET", "/rankings/mmr");
    assert.deepEqual(ladder.data.map((p: any) => p.name), ["a1", "a2", "b1", "b2"], "the MVP bonus puts a1 ahead of a2");
    assert.equal(ladder.data[0].rank, 1);
    assert.deepEqual(ladder.data[0].form, ["W", "L", "W"], "newest first");
    assert.equal(ladder.data[0].rankChange, 0, "all results are older than a week: no movement");
    assert.equal(ladder.placing.length, 0);
    assert.equal(ladder.tiers.reduce((n: number, t: any) => n + t.players, 0), 4);
    assert.equal(ladder.rules.placementSeries, PLACEMENT_SERIES);
    const byMmr = await ok("GET", "/rankings/players?sort=mmr&minGames=1");
    assert.equal(byMmr.data[0].name, "a1");
    assert.ok(byMmr.data[0].tier.key);
    const top = await ok("GET", "/stats/overview");
    assert.equal(top.topPlayers[0].name, "a1");
  });

  test("editing or deleting a series replays MMR", async () => {
    const before = (await ok("GET", `/players/${ids.a1}`)).mmr;
    await ok("DELETE", `/matches/${ids.m3}`);
    const after = await ok("GET", `/players/${ids.a1}`);
    assert.equal(after.series, 2);
    assert.ok(after.mmr < before);
    assert.equal(after.peakMmr, 1026, "peak is replayed too");
    assert.equal(await prisma.playerMmrChange.count({ where: { matchId: ids.m3 } }), 0);
  });

  test("deleting a player replays everyone else's MMR", async () => {
    const extra = await ok("POST", "/players", { name: "temp", teamId: ids.A });
    await ok("POST", "/matches", {
      tournamentId: ids.cup, teamAId: ids.A, teamBId: ids.B, playedAt: "2026-01-05T12:00:00Z",
      games: [{ scoreA: 21, scoreB: 0, players: [row("A", { playerId: extra.id }), row("B", { playerId: ids.b2 })] }],
    });
    assert.equal((await ok("GET", `/players/${ids.b2}`)).series, 3);
    await ok("DELETE", `/players/${extra.id}`);
    const b2 = await ok("GET", `/players/${ids.b2}`);
    assert.equal(b2.series, 3, "the series still counts for b2: side A's strength falls back to the team rating");
    assert.equal(b2.mmrHistory.at(-1).after, b2.mmr);
    assert.equal(await prisma.playerMmrChange.count({ where: { playerId: extra.id } }), 0);
  });

  test("rank movement over the last week, for players and teams", async () => {
    const cup = (await ok("POST", "/tournaments", { name: "Week Cup", startDate: "2026-01-01" })).id;
    const X = (await ok("POST", "/teams", { name: "Xenon" })).id;
    const Y = (await ok("POST", "/teams", { name: "Yeti" })).id;
    const x = (await ok("POST", "/players", { name: "xx", teamId: X })).id;
    const y = (await ok("POST", "/players", { name: "yy", teamId: Y })).id;
    const old = (i: number) => new Date(Date.now() - (20 - i) * 86400_000).toISOString();
    for (let i = 0; i < 3; i++) {
      await ok("POST", "/matches", { tournamentId: cup, teamAId: X, teamBId: Y, playedAt: old(i), games: [{ scoreA: 21, scoreB: 3, players: [row("A", { playerId: x }), row("B", { playerId: y })] }] });
    }
    // This week y wins a lot.
    for (let i = 0; i < 4; i++) {
      await ok("POST", "/matches", { tournamentId: cup, teamAId: X, teamBId: Y, playedAt: new Date(Date.now() - i * 3600_000).toISOString(), games: [{ scoreA: 3, scoreB: 21, players: [row("A", { playerId: x }), row("B", { playerId: y })] }] });
    }
    const ladder = await ok("GET", "/rankings/mmr");
    const yy = ladder.data.find((p: any) => p.name === "yy");
    const xx = ladder.data.find((p: any) => p.name === "xx");
    assert.ok(yy.rankChange > 0, `yy climbed: ${yy.rankChange}`);
    assert.ok(xx.rankChange < 0, `xx dropped: ${xx.rankChange}`);
    assert.deepEqual(yy.form, ["W", "W", "W", "W", "L"]);
    const teams = await ok("GET", "/rankings/teams");
    const yeti = teams.data.find((t: any) => t.name === "Yeti");
    assert.ok(yeti.rankChange > 0);
    assert.ok(yeti.tier.key);
    assert.equal(yeti.form.length, 5);
    const team = await ok("GET", `/teams/${Y}`);
    assert.equal(team.rankChange, yeti.rankChange);
    assert.equal(team.players[0].name, "yy");
    assert.ok(team.players[0].tier);
  });
});

describe("UID: one player across name changes", () => {
  const ids: Record<string, string> = {};

  test("a UID belongs to one player; the same UID on another server is another character", async () => {
    ids.p = (await ok("POST", "/players", { name: "Shadow", uid: "700100", server: "Asia" })).id;
    const dupe = await call("POST", "/players", { name: "Copycat", uid: "700100", server: "asia" });
    assert.equal(dupe.status, 409);
    assert.match(dupe.body.details.th, /Shadow/);
    assert.equal(dupe.body.details.playerId, ids.p);
    const noServer = await call("POST", "/players", { name: "Copycat", uid: "700100" });
    assert.equal(noServer.status, 409, "a blank server matches the only player with that UID");
    ids.eu = (await ok("POST", "/players", { name: "Shadow EU", uid: "700100", server: "EU" })).id;
    const edit = await call("PATCH", `/players/${ids.eu}`, { server: "Asia" });
    assert.equal(edit.status, 409, "editing into someone else's UID is refused too");
    assert.equal((await ok("GET", "/players/uid/700100?server=EU")).id, ids.eu);
    assert.equal((await call("GET", "/players/uid/700100")).status, 404, "ambiguous without a server");
    assert.equal((await ok("GET", "/players/uid/700100?server=asia")).id, ids.p);
  });

  test("registering with a new name but the same UID keeps the player and their history", async () => {
    const t = await ok("POST", "/tournaments", { name: "Rename Cup", startDate: "2026-11-01T12:00:00Z", format: "SINGLE_ELIMINATION", registrationOpen: true, rosterMin: 3, rosterMax: 4 });
    const entry = await ok("POST", `/tournaments/${t.id}/registrations`, {
      teamName: "Night Riders",
      players: [{ name: "ShadowKing", uid: "700100", server: "Asia" }, { name: "r2", uid: "700200", server: "Asia" }, { name: "r3" }],
    });
    assert.equal(entry.roster[0].playerId, ids.p);
    const p = await ok("GET", `/players/${ids.p}`);
    assert.equal(p.name, "ShadowKing");
    assert.deepEqual(p.names.map((n: any) => n.name), ["Shadow"]);
    assert.equal(p.team.name, "Night Riders");
    const r2 = await ok("GET", `/players/${entry.roster[1].playerId}`);
    assert.deepEqual([r2.uid, r2.server], ["700200", "Asia"], "a roster UID is stored on the player");
    ids.team = entry.id;
  });

  test("scoreboards with the old or the new name count for the same player", async () => {
    const cup = (await ok("POST", "/tournaments", { name: "Score Cup", startDate: "2026-01-01" })).id;
    const other = (await ok("POST", "/teams", { name: "Other Side" })).id;
    const m = await ok("POST", "/matches", {
      tournamentId: cup, teamAId: ids.team, teamBId: other, playedAt: "2026-02-01T10:00:00Z",
      games: [
        { scoreA: 21, scoreB: 9, players: [row("A", { name: "Shadow" }), row("B", { name: "opp" })] },
        { scoreA: 21, scoreB: 9, players: [row("A", { name: "shadowking" }), row("B", { name: "opp" })] },
      ],
    });
    assert.deepEqual(m.games.map((g: any) => g.playerStats.find((s: any) => s.teamId === ids.team).playerId), [ids.p, ids.p]);
    const p = await ok("GET", `/players/${ids.p}`);
    assert.equal(p.stats.games, 2);
  });

  test("search finds a player by an old name or by UID", async () => {
    assert.ok((await ok("GET", "/players?search=Shadow")).data.some((p: any) => p.id === ids.p));
    const byUid = await ok("GET", "/players?search=700200");
    assert.equal(byUid.data.length, 1);
    const all = await ok("GET", "/stats/search?q=Shadow");
    assert.ok(all.players.some((p: any) => p.id === ids.p));
  });

  test("same name, different UID: a different character, not merged", async () => {
    const t = await ok("POST", "/tournaments", { name: "Twin Cup", startDate: "2026-11-01T12:00:00Z", format: "SINGLE_ELIMINATION", registrationOpen: true, rosterMin: 3, rosterMax: 4 });
    const entry = await ok("POST", `/tournaments/${t.id}/registrations`, {
      teamName: "Twins",
      players: [{ name: "r2", uid: "999999", server: "Asia" }, { name: "t2" }, { name: "t3" }],
    });
    const twin = entry.roster[0].playerId;
    const r2 = (await ok("GET", "/players/uid/700200")).id;
    assert.notEqual(twin, r2);
  });

  test("renaming in the admin keeps the old name", async () => {
    await ok("PATCH", `/players/${ids.p}`, { name: "Shadow King" });
    const p = await ok("GET", `/players/${ids.p}`);
    assert.equal(p.name, "Shadow King");
    assert.deepEqual(p.names.map((n: any) => n.name).sort(), ["Shadow"], "a spacing change is not a new name");
    await ok("PATCH", `/players/${ids.p}`, { name: "Umbra" });
    assert.deepEqual((await ok("GET", `/players/${ids.p}`)).names.map((n: any) => n.name).sort(), ["Shadow", "Shadow King"]);
  });

  test("players saved before they had a UID get it from their roster", async () => {
    const pl = await prisma.player.findFirstOrThrow({ where: { uid: "700200" } });
    await prisma.player.update({ where: { id: pl.id }, data: { uid: null, server: null } });
    assert.equal(await backfillPlayerUids(), 1);
    assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: pl.id } })).uid, "700200");
    assert.equal(await backfillPlayerUids(), 0, "running again changes nothing");
  });
});

describe("merging duplicate players", () => {
  test("stats, rosters and names move onto the kept player and MMR is replayed", async () => {
    const cup = (await ok("POST", "/tournaments", { name: "Merge Cup", startDate: "2026-01-01" })).id;
    const A = (await ok("POST", "/teams", { name: "Merge A" })).id;
    const B = (await ok("POST", "/teams", { name: "Merge B" })).id;
    const keep = (await ok("POST", "/players", { name: "Keeper", teamId: A, uid: "555001" })).id;
    const dupe = (await ok("POST", "/players", { name: "Keeper2", teamId: A, avatarUrl: "https://img.example/k.png" })).id;
    const opp = (await ok("POST", "/players", { name: "Opp", teamId: B })).id;
    const play = (who: string, day: number) =>
      ok("POST", "/matches", { tournamentId: cup, teamAId: A, teamBId: B, playedAt: `2026-03-0${day}T10:00:00Z`, games: [{ scoreA: 21, scoreB: 5, players: [row("A", { playerId: who }), row("B", { playerId: opp })] }] });
    await play(keep, 1);
    await play(dupe, 2);
    await play(keep, 3);

    const clash = await ok("POST", "/matches", { tournamentId: cup, teamAId: A, teamBId: B, playedAt: "2026-03-04T10:00:00Z", games: [{ scoreA: 21, scoreB: 5, players: [row("A", { playerId: keep }), row("A", { playerId: dupe })] }] });
    const refused = await call("POST", `/players/${keep}/merge`, { fromId: dupe });
    assert.equal(refused.status, 409, "two people on one scoreboard are not the same person");
    assert.match(refused.body.details.th, /เกมเดียวกัน/);
    await ok("DELETE", `/matches/${clash.id}`);

    const merged = await ok("POST", `/players/${keep}/merge`, { fromId: dupe });
    assert.equal(merged.series, 3);
    assert.equal(merged.stats.games, 3);
    assert.equal(merged.avatarUrl, "https://img.example/k.png", "missing profile fields are taken from the duplicate");
    assert.deepEqual(merged.names.map((n: any) => n.name), ["Keeper2"]);
    assert.equal((await call("GET", `/players/${dupe}`)).status, 404);
    assert.equal(merged.mmrHistory[1].before, merged.mmrHistory[0].after, "one continuous MMR line");

    const other = (await ok("POST", "/players", { name: "Other", uid: "555002" })).id;
    const wrong = await call("POST", `/players/${keep}/merge`, { fromId: other });
    assert.equal(wrong.status, 409);
    assert.match(wrong.body.details.th, /UID ต่างกัน/);
    assert.equal((await call("POST", `/players/${keep}/merge`, { fromId: keep })).status, 400);
    assert.equal((await call("POST", `/players/${keep}/merge`, { fromId: "nope" })).status, 404);
  });
});

describe("Discord accounts (log in with Discord on the website)", () => {
  const me = "111122223333444455";
  const other = "999988887777666655";
  const ids: Record<string, string> = {};

  test("players the bot put on a roster with this Discord account belong to it", async () => {
    const t = await ok("POST", "/tournaments", { name: "Discord Cup", startDate: "2026-11-02T12:00:00Z", format: "SINGLE_ELIMINATION", registrationOpen: true, rosterMin: 3, rosterMax: 4 });
    const entry = await ok("POST", `/tournaments/${t.id}/registrations`, {
      teamName: "Disc Wolves",
      players: [{ name: "Howl", uid: "800100", server: "Asia", discordId: me }, { name: "d2" }, { name: "d3" }],
    });
    const mine = await ok("GET", `/players/discord/${me}`);
    assert.deepEqual(mine.data.map((p: any) => p.name), ["Howl"]);
    assert.equal(mine.data[0].id, entry.roster[0].playerId);
    assert.equal(mine.data[0].discordId, me);
    assert.deepEqual((await ok("GET", `/players/discord/${other}`)).data, []);
    assert.equal((await call("GET", "/players/discord/not-a-snowflake")).status, 400);
  });

  test("claiming by UID links an existing player, refuses one linked to someone else, creates a new one", async () => {
    // ShadowKing (UID 700100) has no Discord link yet.
    ids.p = (await ok("GET", "/players/uid/700100?server=Asia")).id;
    // UIDs are public: linking a character that exists waits for an organizer.
    const asked = await call("POST", `/players/discord/${me}/claim`, { uid: "700100", server: "Asia", discordName: "me#1" });
    assert.equal(asked.status, 202);
    assert.equal(asked.body.pending, true);
    assert.equal(asked.body.discordId, null, "not linked before approval");
    const rival = await call("POST", `/players/discord/${other}/claim`, { uid: "700100", server: "Asia" });
    assert.equal(rival.status, 202, "someone else can ask too; the organizer decides");
    const waiting = (await ok("GET", "/players/link-requests")).data.filter((r: any) => r.playerId === ids.p);
    assert.deepEqual(waiting.map((r: any) => r.discordId).sort(), [me, other].sort());
    assert.equal(waiting.find((r: any) => r.discordId === me).name, "me#1");
    assert.deepEqual((await ok("GET", `/players/discord/${me}`)).pending.map((r: any) => r.player.uid), ["700100"]);
    const approved = await ok("POST", `/players/link-requests/${waiting.find((r: any) => r.discordId === me).id}/approve`);
    assert.equal(approved.player.discordId, me);
    assert.deepEqual(approved.denied, [other], "the other request is dropped");
    assert.equal((await ok("GET", "/players/link-requests")).data.some((r: any) => r.playerId === ids.p), false);
    const claimed = await ok("POST", `/players/discord/${me}/claim`, { uid: "700100", server: "Asia" });
    assert.equal(claimed.id, ids.p);
    assert.equal(claimed.discordId, me);
    assert.equal(claimed.pending, false, "already theirs: no new request");
    const taken = await call("POST", `/players/discord/${other}/claim`, { uid: "700100", server: "Asia" });
    assert.equal(taken.status, 409);
    assert.match(taken.body.details.th, /ผูกกับบัญชี Discord อื่น/);
    const unknown = await call("POST", `/players/discord/${other}/claim`, { uid: "800999" });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.details.needsName, true);
    const created = await call("POST", `/players/discord/${other}/claim`, { uid: "800999", server: "Asia", name: "Newbie" });
    assert.equal(created.status, 201);
    assert.deepEqual([created.body.name, created.body.uid, created.body.discordId], ["Newbie", "800999", other]);
    // One account can play several characters.
    assert.deepEqual((await ok("GET", `/players/discord/${me}`)).data.map((p: any) => p.name).sort(), ["Howl", claimed.name].sort());
  });

  test("the admin can unlink; a later roster does not steal a player linked to someone else", async () => {
    const unlinked = await ok("DELETE", `/players/${ids.p}/discord`);
    assert.equal(unlinked.discordId, null);
    assert.equal((await call("DELETE", "/players/nope/discord")).status, 404);
    // PATCH cannot set the link.
    const patched = await ok("PATCH", `/players/${ids.p}`, { discordId: other, nickname: "Shady" });
    assert.equal(patched.discordId, null);
    const newbie = (await ok("GET", `/players/discord/${other}`)).data[0];
    const t = await ok("POST", "/tournaments", { name: "Discord Cup 2", startDate: "2026-11-03T12:00:00Z", format: "SINGLE_ELIMINATION", registrationOpen: true, rosterMin: 3, rosterMax: 4 });
    await ok("POST", `/tournaments/${t.id}/registrations`, {
      teamName: "Disc Foxes",
      players: [{ name: "Newbie", uid: "800999", server: "Asia", discordId: me }, { name: "f2" }, { name: "f3" }],
    });
    const stillTheirs = await ok("GET", `/players/${newbie.id}`);
    assert.equal(stillTheirs.discordId, other, "a linked player keeps their account");
  });
});

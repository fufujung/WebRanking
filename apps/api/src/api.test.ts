import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Isolated database and upload folder for this test run.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-api-test-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
process.env.CORS_ORIGINS = "https://my-site.example";
delete process.env.ANTHROPIC_API_KEY;
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: process.env });

const { createApp } = await import("./app.js");
const { createApiKey } = await import("./lib/apiKeys.js");
const { prisma } = await import("./lib/db.js");
const { eloDelta } = await import("./lib/elo.js");
const { imageReader } = await import("./lib/extract.js");

let server: Server;
let base: string;
let admin: string;
let reader: string;

async function call(method: string, url: string, body?: unknown, key: string | null = admin) {
  const headers: Record<string, string> = {};
  if (key) headers["X-API-Key"] = key;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (typeof body === "string") {
    headers["Content-Type"] = "application/json";
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers, body: payload });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
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

describe("elo", () => {
  test("equal ratings: win gives +16, loss -16", () => {
    assert.deepEqual(eloDelta(1000, 1000, 1), [16, -16]);
  });
  test("draw between equal teams changes nothing", () => {
    assert.deepEqual(eloDelta(1000, 1000, 0.5), [0, -0]);
  });
  test("upset win pays more than an expected win", () => {
    assert.ok(eloDelta(900, 1100, 1)[0] > eloDelta(1100, 900, 1)[0]);
  });
});

describe("auth", () => {
  test("public endpoints need no key", async () => {
    assert.equal((await call("GET", "/health", undefined, null)).status, 200);
    assert.equal((await call("GET", "/openapi.json", undefined, null)).status, 200);
  });
  test("missing key is 401", async () => {
    assert.equal((await call("GET", "/api/v1/teams", undefined, null)).status, 401);
  });
  test("wrong key is 401", async () => {
    assert.equal((await call("GET", "/api/v1/teams", undefined, "trk_nope")).status, 401);
  });
  test("Bearer header works", async () => {
    const res = await fetch(`${base}/api/v1/teams`, { headers: { Authorization: `Bearer ${reader}` } });
    assert.equal(res.status, 200);
  });
  test("read key can read but not write", async () => {
    assert.equal((await call("GET", "/api/v1/teams", undefined, reader)).status, 200);
    assert.equal((await call("POST", "/api/v1/teams", { name: "X" }, reader)).status, 403);
  });
  test("read key cannot manage keys", async () => {
    assert.equal((await call("GET", "/api/v1/keys", undefined, reader)).status, 403);
  });
  test("CORS allows configured origin only", async () => {
    const ok = await fetch(`${base}/health`, { headers: { Origin: "https://my-site.example" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://my-site.example");
    const bad = await fetch(`${base}/health`, { headers: { Origin: "https://evil.example" } });
    assert.equal(bad.headers.get("access-control-allow-origin"), null);
  });
});

describe("tournament flow", () => {
  const ids: Record<string, string> = {};

  test("create teams, reject duplicates and bad input", async () => {
    for (const name of ["Alpha", "Bravo", "Charlie"]) {
      const res = await call("POST", "/api/v1/teams", { name, tag: name.slice(0, 3).toUpperCase() });
      assert.equal(res.status, 201);
      assert.equal(res.body.rating, 1000);
      ids[name] = res.body.id;
    }
    assert.equal((await call("POST", "/api/v1/teams", { name: "Alpha" })).status, 409);
    assert.equal((await call("POST", "/api/v1/teams", { name: "  " })).status, 400);
    assert.equal((await call("POST", "/api/v1/teams", { name: "Z", logoUrl: "javascript:alert(1)" })).status, 400);
    assert.equal((await call("POST", "/api/v1/teams", "{bad json")).status, 400);
  });

  test("search teams for the dropdown", async () => {
    const res = await call("GET", "/api/v1/teams?search=br");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((t: any) => t.name), ["Bravo"]);
    const lower = await call("GET", "/api/v1/teams?search=ALPHA");
    assert.equal(lower.body.data.length, 1, "search is case-insensitive");
  });

  test("create players on teams", async () => {
    for (const [name, team] of [["a1", "Alpha"], ["a2", "Alpha"], ["b1", "Bravo"], ["c1", "Charlie"], ["free", null]] as const) {
      const res = await call("POST", "/api/v1/players", { name, teamId: team ? ids[team] : null });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      ids[name] = res.body.id;
    }
    assert.equal((await call("POST", "/api/v1/players", { name: "x", teamId: "missing" })).status, 400);
    const roster = await call("GET", `/api/v1/players?teamId=${ids.Alpha}`);
    assert.equal(roster.body.total, 2);
  });

  test("create tournament and validate dates", async () => {
    assert.equal(
      (await call("POST", "/api/v1/tournaments", { name: "Bad", startDate: "2026-05-02", endDate: "2026-05-01" })).status,
      400,
    );
    assert.equal((await call("POST", "/api/v1/tournaments", { name: "No date" })).status, 400);
    const res = await call("POST", "/api/v1/tournaments", { name: "Cup", game: "Valorant", startDate: "2026-05-01" });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, "UPCOMING");
    ids.cup = res.body.id;
    const patched = await call("PATCH", `/api/v1/tournaments/${ids.cup}`, { endDate: "2026-04-01" });
    assert.equal(patched.status, 400, "end before existing start is rejected on update too");
  });

  test("match validation", async () => {
    const base = { tournamentId: ids.cup, teamAId: ids.Alpha, teamBId: ids.Bravo, scoreA: 13, scoreB: 7 };
    assert.equal((await call("POST", "/api/v1/matches", { ...base, teamBId: ids.Alpha })).status, 400);
    assert.equal((await call("POST", "/api/v1/matches", { ...base, scoreA: -1 })).status, 400);
    assert.equal((await call("POST", "/api/v1/matches", { ...base, tournamentId: "nope" })).status, 404);
    assert.equal((await call("POST", "/api/v1/matches", { ...base, teamAId: "nope" })).status, 404);
    // c1 plays for Charlie, who is not in this match.
    const wrongTeam = await call("POST", "/api/v1/matches", { ...base, playerStats: [{ playerId: ids.c1 }] });
    assert.equal(wrongTeam.status, 400);
    // A free agent must be given a side explicitly.
    assert.equal((await call("POST", "/api/v1/matches", { ...base, playerStats: [{ playerId: ids.free }] })).status, 400);
    const dup = await call("POST", "/api/v1/matches", { ...base, playerStats: [{ playerId: ids.a1 }, { playerId: ids.a1 }] });
    assert.equal(dup.status, 400);
    assert.equal((await call("GET", "/api/v1/matches")).body.total, 0, "nothing saved by rejected requests");
  });

  test("record a match: winner, ratings, auto-registration, stat lines", async () => {
    const res = await call("POST", "/api/v1/matches", {
      tournamentId: ids.cup,
      teamAId: ids.Alpha,
      teamBId: ids.Bravo,
      scoreA: 13,
      scoreB: 7,
      round: "Final",
      playedAt: "2026-05-01T10:00:00Z",
      playerStats: [
        { playerId: ids.a1, kills: 20, deaths: 10, assists: 5, score: 300 },
        { playerId: ids.a2, kills: 10, deaths: 0, assists: 2, score: 150 },
        { playerId: ids.b1, kills: 12, deaths: 15, assists: 3, score: 200 },
        { playerId: ids.free, teamId: ids.Bravo, kills: 1, deaths: 2, assists: 3, score: 4 },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.winnerId, ids.Alpha);
    assert.equal(res.body.ratingDeltaA, 16);
    assert.equal(res.body.ratingDeltaB, -16);
    assert.equal(res.body.playerStats.length, 4);
    ids.m1 = res.body.id;

    const cup = await call("GET", `/api/v1/tournaments/${ids.cup}`);
    assert.equal(cup.body.teams.length, 2);
    assert.equal(cup.body.standings[0].team.name, "Alpha");
    assert.equal(cup.body.standings[0].points, 3);
  });

  test("draw has no winner and equal teams keep their rating", async () => {
    const res = await call("POST", "/api/v1/matches", {
      tournamentId: ids.cup, teamAId: ids.Charlie, teamBId: ids.Bravo, scoreA: 5, scoreB: 5, playedAt: "2026-05-01T09:00:00Z",
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.winnerId, null);
    ids.m2 = res.body.id;
  });

  test("ratings are replayed in date order", async () => {
    // m2 (draw, 09:00) happened before m1 (10:00) even though it was recorded later.
    const teams = await call("GET", "/api/v1/rankings/teams");
    const byName = Object.fromEntries(teams.body.data.map((t: any) => [t.name, t]));
    assert.equal(byName.Alpha.rating, 1016);
    assert.equal(byName.Bravo.rating, 984);
    assert.equal(byName.Charlie.rating, 1000);
    assert.equal(teams.body.data[0].rank, 1);
    const total = teams.body.data.reduce((s: number, t: any) => s + t.rating, 0);
    assert.equal(total, 3000, "Elo is zero-sum");
  });

  test("player stats and ranking", async () => {
    const a1 = await call("GET", `/api/v1/players/${ids.a1}`);
    assert.equal(a1.body.stats.matches, 1);
    assert.equal(a1.body.stats.wins, 1);
    assert.equal(a1.body.stats.kda, 2.5);
    const a2 = await call("GET", `/api/v1/players/${ids.a2}`);
    assert.equal(a2.body.stats.kda, 12, "zero deaths counts as one");
    const free = await call("GET", `/api/v1/players/${ids.free}`);
    assert.equal(free.body.stats.losses, 1, "result follows the side played, not the current team");

    const byKda = await call("GET", "/api/v1/rankings/players?sort=kda");
    assert.equal(byKda.body.data[0].name, "a2");
    const byScore = await call("GET", "/api/v1/rankings/players?sort=score&minMatches=1");
    assert.equal(byScore.body.data[0].name, "a1");
    assert.equal(byScore.body.total, 4);
    assert.equal((await call("GET", "/api/v1/rankings/players?sort=bogus")).status, 400);
  });

  test("edit a match flips the result and ratings", async () => {
    const res = await call("PUT", `/api/v1/matches/${ids.m1}`, {
      tournamentId: ids.cup, teamAId: ids.Alpha, teamBId: ids.Bravo, scoreA: 7, scoreB: 13,
      playerStats: [{ playerId: ids.a1, kills: 1, deaths: 1, assists: 1, score: 1 }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.winnerId, ids.Bravo);
    assert.equal(res.body.playerStats.length, 1);
    assert.equal(new Date(res.body.playedAt).toISOString(), "2026-05-01T10:00:00.000Z", "playedAt kept when omitted");
    const alpha = await call("GET", `/api/v1/teams/${ids.Alpha}`);
    assert.equal(alpha.body.rating, 984);
    assert.equal(alpha.body.stats.losses, 1);
    const a2 = await call("GET", `/api/v1/players/${ids.a2}`);
    assert.equal(a2.body.stats.matches, 0, "old stat lines replaced");
  });

  test("placements, titles and entry removal rules", async () => {
    assert.equal((await call("POST", `/api/v1/tournaments/${ids.cup}/entries`, { teamId: ids.Bravo, placement: 1 })).status, 201);
    const ranking = await call("GET", "/api/v1/rankings/teams");
    assert.equal(ranking.body.data.find((t: any) => t.name === "Bravo").stats.titles, 1);
    assert.equal((await call("DELETE", `/api/v1/tournaments/${ids.cup}/entries/${ids.Bravo}`)).status, 409);
    assert.equal((await call("POST", `/api/v1/tournaments/${ids.cup}/entries`, { teamId: "nope" })).status, 404);
  });

  test("search across everything", async () => {
    const res = await call("GET", "/api/v1/stats/search?q=cup");
    assert.equal(res.body.tournaments.length, 1);
    const empty = await call("GET", "/api/v1/stats/search?q=");
    assert.deepEqual(empty.body, { teams: [], players: [], tournaments: [] });
  });

  test("overview totals", async () => {
    const res = await call("GET", "/api/v1/stats/overview");
    assert.deepEqual(res.body.totals, { teams: 3, players: 5, tournaments: 1, matches: 2, ongoingTournaments: 0 });
  });

  test("deleting matches resets ratings", async () => {
    assert.equal((await call("DELETE", `/api/v1/matches/${ids.m1}`)).status, 204);
    assert.equal((await call("DELETE", `/api/v1/matches/${ids.m1}`)).status, 404);
    assert.equal((await call("DELETE", `/api/v1/matches/${ids.m2}`)).status, 204);
    const ranking = await call("GET", "/api/v1/rankings/teams");
    assert.ok(ranking.body.data.every((t: any) => t.rating === 1000));
  });

  test("deleting a team removes it and its players stay as free agents", async () => {
    assert.equal((await call("DELETE", `/api/v1/teams/${ids.Charlie}`)).status, 204);
    const c1 = await call("GET", `/api/v1/players/${ids.c1}`);
    assert.equal(c1.body.teamId, null);
    assert.equal((await call("GET", `/api/v1/teams/${ids.Charlie}`)).status, 404);
  });
});

describe("images", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

  test("upload a png and serve it", async () => {
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "shot.png");
    const res = await call("POST", "/api/v1/uploads", form);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.url, /^\/uploads\/[\w.-]+\.png$/);
    const file = await fetch(base + res.body.url);
    assert.equal(file.status, 200);
    assert.equal(Buffer.from(await file.arrayBuffer()).length, png.length);

    const team = await call("POST", "/api/v1/teams", { name: "With logo", logoUrl: res.body.url });
    assert.equal(team.status, 201);
  });

  test("reject non-images and missing files", async () => {
    const form = new FormData();
    form.append("image", new Blob(["hello"], { type: "text/plain" }), "a.txt");
    assert.equal((await call("POST", "/api/v1/uploads", form)).status, 400);
    assert.equal((await call("POST", "/api/v1/uploads", new FormData())).status, 400);
    const ro = new FormData();
    ro.append("image", new Blob([png], { type: "image/png" }), "a.png");
    assert.equal((await call("POST", "/api/v1/uploads", ro, reader)).status, 403);
  });

  test("reject oversized images", async () => {
    const form = new FormData();
    form.append("image", new Blob([Buffer.alloc(9 * 1024 * 1024)], { type: "image/png" }), "big.png");
    assert.equal((await call("POST", "/api/v1/uploads", form)).status, 413);
  });

  test("image reading reports when it is not configured", async () => {
    assert.deepEqual((await call("GET", "/api/v1/extract/status")).body, { enabled: false });
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "shot.png");
    const up = await call("POST", "/api/v1/uploads", form);
    assert.equal((await call("POST", "/api/v1/extract/match", { imageUrl: up.body.url })).status, 503);
    assert.equal((await call("POST", "/api/v1/extract/match", { imageUrl: "/uploads/../../etc/passwd" })).status, 404);
  });
});

describe("reading results from images", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const original = { ...imageReader };
  after(() => Object.assign(imageReader, original));

  test("matches read names to teams and players, and saves nothing", async () => {
    const red = (await call("POST", "/api/v1/teams", { name: "Red Fox", tag: "RFX" })).body;
    const blue = (await call("POST", "/api/v1/teams", { name: "Blue Jay" })).body;
    const neo = (await call("POST", "/api/v1/players", { name: "Neo Tan", nickname: "neo", teamId: red.id })).body;
    const kai = (await call("POST", "/api/v1/players", { name: "Kai", teamId: blue.id })).body;
    let seenRoster: string[] = [];
    imageReader.enabled = () => true;
    imageReader.read = async (_file, _type, ctx) => {
      seenRoster = ctx.roster;
      return {
        teamA: { name: "rfx", score: 13 },
        teamB: { name: "BLUE JAY", score: null },
        players: [
          { name: "NEO", side: "A", kills: 20, deaths: 5, assists: 3, score: 310 },
          { name: "kai", side: "B", kills: 9, deaths: null, assists: 1, score: 150 },
          { name: "Stranger", side: "B", kills: 1, deaths: 1, assists: 1, score: 1 },
        ],
        notes: "Team B score is blurry",
      };
    };
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "result.png");
    const up = await call("POST", "/api/v1/uploads", form);
    const matchesBefore = (await call("GET", "/api/v1/matches")).body.total;

    const res = await call("POST", "/api/v1/extract/match", { imageUrl: up.body.url });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const s = res.body.suggestion;
    assert.equal(s.teamAId, red.id, "tag matched case-insensitively");
    assert.equal(s.teamBId, blue.id);
    assert.equal(s.scoreA, 13);
    assert.equal(s.scoreB, null, "unreadable numbers stay empty");
    assert.deepEqual(
      s.playerStats.map((p: any) => [p.readName, p.playerId, p.teamId]),
      [["NEO", neo.id, red.id], ["kai", kai.id, blue.id], ["Stranger", null, blue.id]],
    );
    assert.equal(s.notes, "Team B score is blurry");
    assert.ok(seenRoster.includes("Neo Tan") && seenRoster.includes("neo"), "roster hints passed to the reader");
    assert.equal((await call("GET", "/api/v1/matches")).body.total, matchesBefore, "nothing saved");
    assert.deepEqual((await call("GET", "/api/v1/extract/status")).body, { enabled: true });
  });

  test("teams chosen in the form win over names read from the image", async () => {
    const teams = (await call("GET", "/api/v1/teams?search=Red Fox")).body.data;
    const other = (await call("POST", "/api/v1/teams", { name: "Other" })).body;
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "result.png");
    const up = await call("POST", "/api/v1/uploads", form);
    const res = await call("POST", "/api/v1/extract/match", { imageUrl: up.body.url, teamAId: other.id, teamBId: teams[0].id });
    assert.equal(res.body.suggestion.teamAId, other.id);
    assert.equal(res.body.suggestion.teamBId, teams[0].id);
  });

  test("reader errors are passed through", async () => {
    const { HttpError } = await import("./lib/errors.js");
    imageReader.read = async () => {
      throw new HttpError(422, "The image could not be read. Please enter the result manually.");
    };
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "result.png");
    const up = await call("POST", "/api/v1/uploads", form);
    assert.equal((await call("POST", "/api/v1/extract/match", { imageUrl: up.body.url })).status, 422);
  });
});

describe("api keys", () => {
  test("create, use and revoke a key", async () => {
    const created = await call("POST", "/api/v1/keys", { name: "partner site" });
    assert.equal(created.status, 201);
    assert.equal(created.body.scope, "read");
    assert.equal((await call("GET", "/api/v1/teams", undefined, created.body.key)).status, 200);
    const list = await call("GET", "/api/v1/keys");
    assert.ok(list.body.data.every((k: any) => !("keyHash" in k) && !("key" in k)), "secrets never listed");
    assert.equal((await call("DELETE", `/api/v1/keys/${created.body.id}`)).status, 204);
    assert.equal((await call("GET", "/api/v1/teams", undefined, created.body.key)).status, 401);
  });
});

describe("misc", () => {
  test("unknown routes are JSON 404s", async () => {
    const res = await call("GET", "/api/v1/nope");
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "Route not found");
  });
  test("unknown ids are 404s", async () => {
    for (const path of ["teams", "players", "tournaments", "matches"]) {
      assert.equal((await call("GET", `/api/v1/${path}/missing`)).status, 404, path);
    }
    assert.equal((await call("PATCH", "/api/v1/teams/missing", { name: "x" })).status, 404);
  });
  test("pagination bounds are validated", async () => {
    assert.equal((await call("GET", "/api/v1/teams?limit=0")).status, 400);
    assert.equal((await call("GET", "/api/v1/teams?limit=1")).body.data.length, 1);
  });
});

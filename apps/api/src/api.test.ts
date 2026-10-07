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

  /** A scoreboard row with every stat set to n. */
  const row = (side: "A" | "B", who: Record<string, unknown>, n = 1, extra: Record<string, unknown> = {}) => ({
    side, pts: n, reb: n, blk: n, stl: n, ast: n, lbr: n, ...who, ...extra,
  });

  test("match validation", async () => {
    const base = { tournamentId: ids.cup, teamAId: ids.Alpha, teamBId: ids.Bravo, scoreA: 2, scoreB: 0 };
    const post = (body: unknown) => call("POST", "/api/v1/matches", body);
    assert.equal((await post({ ...base, teamBId: ids.Alpha })).status, 400);
    assert.equal((await post({ ...base, scoreA: -1 })).status, 400);
    assert.equal((await post({ ...base, scoreA: undefined, scoreB: undefined })).status, 400, "needs a series score or games");
    assert.equal((await post({ ...base, tournamentId: "nope" })).status, 404);
    assert.equal((await post({ ...base, teamAId: "nope" })).status, 404);
    assert.equal((await post({ ...base, teamAId: undefined })).status, 400, "team A is required");
    assert.equal((await post({ ...base, teamAId: undefined, teamBId: undefined, teamAName: "x y", teamBName: "X-Y" })).status, 400, "same name twice");
    const game = (players: unknown[]) => ({ ...base, games: [{ scoreA: 21, scoreB: 10, players }] });
    assert.equal((await post(game([{ side: "A" }]))).status, 400, "a row needs a player");
    assert.equal((await post(game([row("C" as "A", { playerId: ids.a1 })]))).status, 400, "side must be A or B");
    assert.equal((await post(game([row("A", { playerId: ids.a1 }), row("B", { playerId: ids.a1 })]))).status, 400, "same player twice in a game");
    assert.equal((await post(game([row("A", { name: "New One" }), row("A", { name: "new one" })]))).status, 400, "same name twice in a game");
    assert.equal((await post(game([row("A", { playerId: "ghost" })]))).status, 404);
    assert.equal((await post(game([row("A", { playerId: ids.a1, award: "GOAT" })]))).status, 400);
    assert.equal((await call("GET", "/api/v1/matches")).body.total, 0, "nothing saved by rejected requests");
    assert.equal((await call("GET", "/api/v1/players?search=New One")).body.total, 0, "no players created by rejected requests");
  });

  test("record a series: games, winner, ratings, auto-registration, scoreboards", async () => {
    const res = await call("POST", "/api/v1/matches", {
      tournamentId: ids.cup,
      teamAId: ids.Alpha,
      teamBId: ids.Bravo,
      round: "Final",
      playedAt: "2026-05-01T10:00:00Z",
      games: [
        {
          scoreA: 26,
          scoreB: 13,
          players: [
            row("A", { playerId: ids.a1 }, 10, { rating: 20.4, award: "MVP" }),
            row("A", { playerId: ids.a2 }, 2, { rating: 12.5 }),
            row("B", { playerId: ids.b1 }, 4, { rating: 13.1, award: "SVP" }),
            row("B", { playerId: ids.free }, 1, { rating: "" }),
          ],
        },
        { scoreA: 14, scoreB: 8, players: [row("A", { playerId: ids.a1 }, 6, { rating: 18.4 })] },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.scoreA, 2, "series score counted from games");
    assert.equal(res.body.scoreB, 0);
    assert.equal(res.body.winnerId, ids.Alpha);
    assert.equal(res.body.ratingDeltaA, 16);
    assert.equal(res.body.ratingDeltaB, -16);
    assert.deepEqual(res.body.games.map((g: any) => [g.number, g.scoreA, g.scoreB, g.playerStats.length]), [[1, 26, 13, 4], [2, 14, 8, 1]]);
    const a1 = res.body.players.find((p: any) => p.player.id === ids.a1);
    assert.deepEqual([a1.games, a1.pts, a1.mvp, a1.avgRating], [2, 16, 1, 19.4], "series totals per player");
    assert.equal(res.body.games[0].playerStats.find((s: any) => s.playerId === ids.free).teamId, ids.Bravo, "a free agent plays for the side given");
    ids.m1 = res.body.id;

    const cup = await call("GET", `/api/v1/tournaments/${ids.cup}`);
    assert.equal(cup.body.teams.length, 2);
    assert.equal(cup.body.standings[0].team.name, "Alpha");
    assert.equal(cup.body.standings[0].points, 3);
  });

  test("a series score given explicitly wins over counting games", async () => {
    const res = await call("POST", "/api/v1/matches", {
      tournamentId: ids.cup, teamAId: ids.Charlie, teamBId: ids.Bravo, scoreA: 1, scoreB: 1, playedAt: "2026-05-01T09:00:00Z",
      games: [{ scoreA: 21, scoreB: 3, players: [] }],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.winnerId, null, "1-1 is a draw");
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
    assert.deepEqual(
      [a1.body.stats.matches, a1.body.stats.games, a1.body.stats.wins, a1.body.stats.pts, a1.body.stats.ppg, a1.body.stats.avgRating, a1.body.stats.mvp],
      [1, 2, 2, 16, 8, 19.4, 1],
    );
    assert.equal(a1.body.recentGames.length, 2);
    assert.equal(a1.body.recentGames[0].game.number, 1);
    const free = await call("GET", `/api/v1/players/${ids.free}`);
    assert.equal(free.body.stats.losses, 1, "result follows the side played, not the current team");
    assert.equal(free.body.stats.avgRating, 0, "no rating read means no average");

    const byPts = await call("GET", "/api/v1/rankings/players?sort=pts");
    assert.equal(byPts.body.data[0].name, "a1");
    assert.equal(byPts.body.total, 5);
    const byRating = await call("GET", "/api/v1/rankings/players?sort=avgRating&minGames=1");
    assert.deepEqual(byRating.body.data.map((p: any) => p.name), ["a1", "b1", "a2", "free"]);
    assert.equal((await call("GET", "/api/v1/rankings/players?minMatches=2")).body.total, 1, "old parameter name still works");
    assert.equal((await call("GET", "/api/v1/rankings/players?sort=bogus")).status, 400);
  });

  test("edit a series flips the result and ratings", async () => {
    const res = await call("PUT", `/api/v1/matches/${ids.m1}`, {
      tournamentId: ids.cup, teamAId: ids.Alpha, teamBId: ids.Bravo,
      games: [{ scoreA: 7, scoreB: 13, players: [row("A", { playerId: ids.a1 }, 1)] }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.winnerId, ids.Bravo);
    assert.equal(res.body.games.length, 1);
    assert.equal(new Date(res.body.playedAt).toISOString(), "2026-05-01T10:00:00.000Z", "playedAt kept when omitted");
    const alpha = await call("GET", `/api/v1/teams/${ids.Alpha}`);
    assert.equal(alpha.body.rating, 984);
    assert.equal(alpha.body.stats.losses, 1);
    const a2 = await call("GET", `/api/v1/players/${ids.a2}`);
    assert.equal(a2.body.stats.games, 0, "old scoreboards replaced");
  });

  test("teams and players given by name are matched, or created", async () => {
    const res = await call("POST", "/api/v1/matches", {
      tournamentId: ids.cup,
      teamAName: "alpha",
      teamBName: "Pai Nai",
      source: "discord",
      sourceRef: "discord-msg-1",
      playedAt: "2026-05-02T10:00:00Z",
      games: [
        { scoreA: 21, scoreB: 12, players: [row("A", { name: "A1" }), row("A", { name: "Rookie" }), row("B", { name: "EGOIST<1>" }), row("B", { name: "b1" })] },
        { scoreA: 21, scoreB: 9, players: [row("A", { name: "rookie" }), row("B", { name: "egoist<1>" })] },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.teamAId, ids.Alpha, "existing team matched by name, ignoring case");
    assert.equal(res.body.teamB.name, "Pai Nai", "unknown team created");
    const g1 = res.body.games[0].playerStats;
    const idOf = (name: string) => g1.find((s: any) => s.player.name === name)?.playerId;
    assert.equal(idOf("a1"), ids.a1, "existing player matched by name");
    assert.equal(idOf("b1"), ids.b1, "a player from another team can play as a substitute");
    const rookie = await call("GET", `/api/v1/players/${idOf("Rookie")}`);
    assert.equal(rookie.body.teamId, ids.Alpha, "new player joins the side's team");
    assert.equal(rookie.body.stats.games, 2, "the same new name in two games is one player");
    assert.equal((await call("GET", `/api/v1/players?teamId=${res.body.teamBId}`)).body.total, 1, "EGOIST<1> created once, b1 not moved");

    const again = await call("POST", "/api/v1/matches", { tournamentId: ids.cup, teamAName: "x", teamBName: "y", scoreA: 1, scoreB: 0, sourceRef: "discord-msg-1" });
    assert.equal(again.status, 409, "the same Discord post cannot be recorded twice");
    assert.equal(again.body.details.matchId, res.body.id);
    assert.equal((await call("GET", "/api/v1/teams?search=x")).body.total, 0, "nothing created by the rejected duplicate");
    assert.equal((await call("GET", "/api/v1/matches/by-source?ref=discord-msg-1")).body.matchId, res.body.id);
    assert.equal((await call("GET", "/api/v1/matches/by-source?ref=nope")).body.matchId, null);
    const recorded = await call("GET", "/api/v1/matches?sort=created&limit=1");
    assert.equal(recorded.body.data[0].id, res.body.id, "sort=created lists the latest recorded first, whatever its date");
    assert.equal((await call("DELETE", `/api/v1/matches/${res.body.id}`)).status, 204);
    assert.equal((await call("DELETE", `/api/v1/teams/${res.body.teamBId}`)).status, 204);
    for (const name of ["Rookie", "EGOIST<1>"]) assert.equal((await call("DELETE", `/api/v1/players/${idOf(name)}`)).status, 204);
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
    assert.equal((await call("POST", "/api/v1/extract/series", { imageUrls: [up.body.url] })).status, 503);
    assert.equal((await call("POST", "/api/v1/extract/series", { imageUrls: ["/uploads/../../etc/passwd"] })).status, 404);
    assert.equal((await call("POST", "/api/v1/extract/series", { imageUrls: [] })).status, 400);
  });
});

describe("reading results from images", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const original = { ...imageReader };
  after(() => Object.assign(imageReader, original));

  const upload = async () => {
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "result.png");
    return (await call("POST", "/api/v1/uploads", form)).body.url as string;
  };
  type Read = Awaited<ReturnType<typeof imageReader.read>>;
  const p = (name: string, side: "ally" | "rival", pts: number | null, award: "MVP" | "SVP" | null = null) => ({
    name, side, rating: 15.5, award, pts, reb: 1, blk: 0, stl: 0, ast: 2, lbr: 1,
  });
  /** One scoreboard as the game shows it: Ally first. */
  const board = (ally: string[], rival: string[], allyScore: number | null, rivalScore: number | null, result: "WIN" | "LOSE" | "unknown" = "unknown") => ({
    allyScore, rivalScore, result,
    players: [...ally.map((n) => p(n, "ally", 5)), ...rival.map((n) => p(n, "rival", 3))],
  });
  const fakeRead = (out: Read) => {
    imageReader.enabled = () => true;
    imageReader.read = async () => out;
  };

  test("a Discord-style post becomes a draft that saves nothing", async () => {
    const red = (await call("POST", "/api/v1/teams", { name: "Red Fox", tag: "RFX" })).body;
    const neo = (await call("POST", "/api/v1/players", { name: "Neo Tan", nickname: "neo", teamId: red.id })).body;
    await call("POST", "/api/v1/players", { name: "Mo", teamId: red.id });
    let seen: { images: number; text: string; teams: string[] } | undefined;
    imageReader.enabled = () => true;
    imageReader.read = async (images, text, ctx) => {
      seen = { images: images.length, text, teams: ctx.teams.map((t) => t.name) };
      return {
        teamA: "ignored", teamB: "ignored", seriesScoreA: 2, seriesScoreB: 1,
        games: [
          // The poster played for Blue Jay, so Ally is team B in every game.
          board(["Kai", "Lee", "Max"], ["NEO", "Mo", "Zed"], 21, 10, "WIN"),
          board(["Kai", "Lee", "Max"], ["neo", "Mo", "Zed"], 8, 21, "LOSE"),
          { ...board(["Kai", "Lee"], ["neo", "Mo", "Zed"], null, 21), players: [p("Kai", "ally", null), p("Lee", "ally", 4), p("neo", "rival", 9, "MVP")] },
        ],
        notes: "เกม 3 สกอร์ไม่ชัด",
      } satisfies Read;
    };
    const urls = [await upload(), await upload(), await upload()];
    const before = (await call("GET", "/api/v1/matches")).body.total;
    const res = await call("POST", "/api/v1/extract/series", { imageUrls: urls, text: "RFX 2 - 1 Blue Jay\nGG" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const d = res.body.draft;
    assert.deepEqual([d.teamAId, d.teamAName, d.teamBId, d.teamBName], [red.id, "Red Fox", null, "Blue Jay"], "team names come from the text");
    assert.deepEqual([d.scoreA, d.scoreB], [2, 1]);
    assert.deepEqual(d.games.map((g: any) => [g.scoreA, g.scoreB, g.imageUrl]), [[10, 21, urls[0]], [21, 8, urls[1]], [21, 0, urls[2]]], "Red Fox's registered players put it on the Rival side");
    const neoRow = d.games[0].players.find((x: any) => x.side === "A" && x.playerId === neo.id);
    assert.equal(neoRow.name, "Neo Tan", "nickname matched to the registered player");
    assert.equal(d.games[2].players.find((x: any) => x.name === "Kai").pts, 0, "unreadable numbers become 0");
    assert.equal(d.games[2].players.find((x: any) => x.award === "MVP").name, "Neo Tan");
    const w = d.warnings.join("\n");
    assert.match(w, /ทีม "Blue Jay" ยังไม่มีในเว็บ/);
    assert.match(w, /อ่านไม่ออก/);
    assert.match(w, /ผู้เล่นใหม่.*Kai/);
    assert.match(w, /ผลในข้อความ 2-1 ไม่ตรงกับเกมในรูป \(2-1\)|เกม 3: อ่านผู้เล่นทีม B ได้ 2 คน/);
    assert.equal(d.notes, "เกม 3 สกอร์ไม่ชัด");
    assert.deepEqual(seen, { images: 3, text: "RFX 2 - 1 Blue Jay\nGG", teams: seen!.teams });
    assert.ok(seen!.teams.includes("Red Fox"));
    assert.equal((await call("GET", "/api/v1/matches")).body.total, before, "nothing saved");
    assert.equal((await call("GET", "/api/v1/teams?search=Blue Jay")).body.total, 0, "no team created by reading");

    // The draft is accepted by POST /matches as it is.
    const saved = await call("POST", "/api/v1/matches", { ...d, tournamentId: (await call("GET", "/api/v1/tournaments")).body.data[0].id, sourceRef: "draft-test" });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.equal(saved.body.teamB.name, "Blue Jay");
    assert.equal(saved.body.winnerId, red.id);
    assert.equal((await call("DELETE", `/api/v1/matches/${saved.body.id}`)).status, 204);
  });

  test("without registered players, the series score decides which side is Ally", async () => {
    fakeRead({
      teamA: "WD", teamB: "Late", seriesScoreA: 2, seriesScoreB: 0,
      games: [board(["p1", "p2", "p3"], ["q1", "q2", "q3"], 26, 13, "WIN"), board(["q1", "q2", "q3"], ["p1", "p2", "p3"], 8, 14, "LOSE")],
      notes: "",
    });
    const res = await call("POST", "/api/v1/extract/series", { imageUrls: [await upload(), await upload()], text: "WD 2-0 Late" });
    const d = res.body.draft;
    assert.deepEqual(d.games.map((g: any) => [g.scoreA, g.scoreB]), [[26, 13], [14, 8]], "same players across games keep the same side");
    assert.ok(d.games[1].players.filter((x: any) => x.side === "A").every((x: any) => x.name.startsWith("p")));
    assert.ok(!d.warnings.some((x: string) => x.includes("ไม่ตรง")), d.warnings.join());
  });

  test("teams chosen in the form win over names in the text", async () => {
    const other = (await call("POST", "/api/v1/teams", { name: "Other" })).body;
    const red = (await call("GET", "/api/v1/teams?search=Red Fox")).body.data[0];
    fakeRead({ teamA: "", teamB: "", seriesScoreA: null, seriesScoreB: null, games: [board(["a"], ["b"], 21, 3)], notes: "" });
    const res = await call("POST", "/api/v1/extract/series", { imageUrls: [await upload()], teamAId: other.id, teamBId: red.id });
    assert.equal(res.body.draft.teamAId, other.id);
    assert.equal(res.body.draft.teamBId, red.id);
    assert.deepEqual([res.body.draft.scoreA, res.body.draft.scoreB], [1, 0], "series score counted from games when the text has none");
  });

  test("reader errors are passed through", async () => {
    const { HttpError } = await import("./lib/errors.js");
    imageReader.read = async () => {
      throw new HttpError(422, "The image could not be read. Please enter the result manually.");
    };
    assert.equal((await call("POST", "/api/v1/extract/series", { imageUrls: [await upload()] })).status, 422);
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

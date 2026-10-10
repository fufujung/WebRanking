import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { closeReader, closestName, ocrSeries, readScoreboard } from "./lib/ocr.js";

after(closeReader);

// A made-up scoreboard drawn in the game's layout (blue Ally rows, pink Rival rows, yellow best numbers).
const scoreboard = fileURLToPath(new URL("./fixtures/scoreboard.png", import.meta.url));
const players = ["Tester01", "Hoopster", "Ballboy", "Dribbler", "Shooter", "Rookie"];
const row = (p: { side: string; name: string; rating: number | null; award: string | null; pts: number | null; reb: number | null; blk: number | null; stl: number | null; ast: number | null; lbr: number | null }) =>
  [p.side, p.name, p.rating, p.award, p.pts, p.reb, p.blk, p.stl, p.ast, p.lbr].join(" ");

test("the free reader reads every number, name, rating and award on a scoreboard", { timeout: 120_000 }, async () => {
  const game = await readScoreboard(scoreboard, players);
  assert.ok(game);
  assert.deepEqual(game.players.map(row), [
    "ally Tester01 16.9  3 9 2 0 3 1",
    "ally Hoopster 20.4 MVP 14 6 1 0 2 1",
    "ally Ballboy 19  12 1 0 1 6 2",
    "rival Dribbler 10.8  0 1 3 0 4 1",
    "rival Shooter 13.1 SVP 13 0 0 1 0 4",
    "rival Rookie 7.5  5 0 0 0 0 0",
  ]);
  // The game score is each side's points added up.
  assert.equal(game.allyScore, 29);
  assert.equal(game.rivalScore, 18);
  assert.equal(game.result, "WIN");
});

test("the free reader answers in the same shape as the AI reader", { timeout: 120_000 }, async () => {
  const read = await ocrSeries([{ file: scoreboard }], "", { teams: [{ name: "Home", players: players.slice(0, 3) }, { name: "Away", players: players.slice(3) }] });
  assert.equal(read.games.length, 1);
  assert.equal(read.seriesScoreA, null);
  assert.match(read.notes, /ไม่ใช่ AI/);
});

test("names read slightly wrong are matched to registered players", () => {
  assert.equal(closestName("Tester(01", players), "Tester01");
  assert.equal(closestName("Hoopstr", players), "Hoopster");
  assert.equal(closestName("Somebody", players), null);
  assert.equal(closestName("", players), null);
});

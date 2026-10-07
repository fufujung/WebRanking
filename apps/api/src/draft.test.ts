import { test } from "node:test";
import assert from "node:assert/strict";
import { allySides, parseResultText } from "./lib/draft.js";
import { announcementFor } from "./lib/announce.js";

test("reads teams and series score from a post", () => {
  assert.deepEqual(parseResultText("Pai Nai 2 - 0 ฉันมีไม่ตาย"), { teamA: "Pai Nai", scoreA: 2, teamB: "ฉันมีไม่ตาย", scoreB: 0 });
  assert.deepEqual(parseResultText("WD 2-0 มาช้าแต่ทันไหม"), { teamA: "WD", scoreA: 2, teamB: "มาช้าแต่ทันไหม", scoreB: 0 });
  assert.deepEqual(parseResultText("\n  Team 7 1:2 X  \nGG"), { teamA: "Team 7", scoreA: 1, teamB: "X", scoreB: 2 }, "digits inside a name, colon, later lines ignored");
  assert.equal(parseResultText("gg wp"), null);
  assert.equal(parseResultText(""), null);
});

const game = (ally: string[], rival: string[], allyScore: number, rivalScore: number) => ({
  allyScore, rivalScore, result: "unknown" as const,
  players: [...ally, ...rival].map((name, i) => ({
    name, side: (i < ally.length ? "ally" : "rival") as "ally" | "rival",
    rating: null, award: null, pts: 0, reb: 0, blk: 0, stl: 0, ast: 0, lbr: 0,
  })),
});

test("registered rosters decide the sides", () => {
  const out = allySides([game(["x", "y"], ["a", "b"], 21, 3)], new Set(["a"]), new Set(), null);
  assert.deepEqual(out, { sides: ["B"], confident: true });
});

test("the series score decides when nobody is registered", () => {
  // The Ally side lost both games, so Ally is whichever team lost the series.
  const lost = [game(["p"], ["q"], 10, 21), game(["p"], ["q"], 9, 21)];
  assert.deepEqual(allySides(lost, new Set(), new Set(), { scoreA: 0, scoreB: 2 }), { sides: ["A", "A"], confident: true });
  assert.deepEqual(allySides(lost, new Set(), new Set(), { scoreA: 2, scoreB: 0 }), { sides: ["B", "B"], confident: true });
});

test("the same players keep the same side across games", () => {
  const games = [game(["p"], ["q"], 21, 10), game(["q"], ["p"], 10, 21)];
  assert.deepEqual(allySides(games, new Set(), new Set(), { scoreA: 2, scoreB: 0 }), { sides: ["A", "B"], confident: true });
});

test("no evidence falls back to Ally = team A and says it is unsure", () => {
  const games = [game(["p"], ["q"], 21, 10), game(["r"], ["s"], 21, 10)];
  assert.deepEqual(allySides(games, new Set(), new Set(), null), { sides: ["A", "A"], confident: false });
});

test("the announcement shows the series, games, MVPs and rating changes", () => {
  const team = (id: string, name: string, rating: number) => ({ id, name, rating });
  const msg = announcementFor(
    {
      id: "m1", scoreA: 2, scoreB: 0, winnerId: "a", ratingDeltaA: 16, ratingDeltaB: -16, round: "Final",
      teamA: team("a", "WD", 1016), teamB: team("b", "Late", 984), tournament: { name: "Cup" },
      games: [{ number: 1, scoreA: 26, scoreB: 13, playerStats: [{ teamId: "a", pts: 14, rating: 20.4, award: "MVP", player: { name: "NinOverlord" } }] }],
    },
    "https://rank.example/",
  );
  const embed = msg.embeds[0];
  assert.equal(embed.title, "WD 2 - 0 Late");
  assert.equal(embed.url, "https://rank.example/matches/m1");
  assert.match(embed.description, /WD.*ชนะ/);
  assert.match(embed.description, /Cup · Final/);
  assert.match(embed.fields[0].value, /เกม 1: \*\*26 - 13\*\* · MVP NinOverlord/);
  assert.match(embed.fields[1].value, /WD 1016 \(\+16\)\nLate 984 \(-16\)/);
});

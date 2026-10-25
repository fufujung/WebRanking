// Ladder rules on plain data: no server, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLadder, withRanks } from "./ladder.js";
import { tierCounts } from "./tiers.js";

const now = new Date("2026-10-25T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);
const player = (id: string, mmr: number, extra: Record<string, unknown> = {}) => ({ id, name: id, mmr, teamId: null as string | null, ...extra });
/** n series for one player, newest first, all on the given day. */
const series = (playerId: string, results: [string, number][], when: Date) => results.map(([result, delta]) => ({ playerId, result, delta, playedAt: when }));

test("players need 3 series to be ranked; fewer are placing, none are left out", () => {
  const board = buildLadder({
    players: [player("a", 1100), player("b", 1050), player("c", 990)],
    changes: [...series("a", [["W", 20], ["W", 20], ["L", -10]], daysAgo(1)), ...series("b", [["W", 25]], daysAgo(1))],
    blacklisted: [],
    now,
  });
  assert.deepEqual(board.ranked.map((p) => p.id), ["a"]);
  assert.deepEqual(board.placing.map((p) => [p.id, p.seriesToPlace]), [["b", 2]]);
  assert.equal(board.unplayed, 1);
});

test("equal MMR shares a rank, then more series, then name decides the order", () => {
  const three = (id: string, n = 3) => series(id, Array.from({ length: n }, () => ["W", 1] as [string, number]), daysAgo(30));
  const board = buildLadder({
    players: [player("zed", 1000), player("amy", 1000), player("bob", 1200), player("cat", 1000)],
    changes: [...three("zed", 5), ...three("amy"), ...three("bob"), ...three("cat")],
    blacklisted: [],
    now,
  });
  assert.deepEqual(board.ranked.map((p) => [p.rank, p.id]), [[1, "bob"], [2, "zed"], [2, "amy"], [2, "cat"]]);
});

test("form is the last five results newest first, lastDelta the newest change, W/L counted", () => {
  const board = buildLadder({
    players: [player("a", 1000)],
    changes: series("a", [["W", 9], ["L", -5], ["D", 0], ["W", 4], ["W", 3], ["L", -2]], daysAgo(10)),
    blacklisted: ["a"],
    now,
  });
  const a = board.ranked[0];
  assert.deepEqual(a.form, ["W", "L", "D", "W", "W"]);
  assert.equal(a.lastDelta, 9);
  assert.equal(a.wins, 3);
  assert.equal(a.losses, 2);
  assert.equal(a.series, 6);
  assert.equal(a.blacklisted, true);
  assert.equal(a.tier.key, "gold");
});

test("rank movement compares with a week ago; players unranked then show null", () => {
  const old = (id: string) => series(id, [["W", 0], ["W", 0], ["W", 0]], daysAgo(20));
  const board = buildLadder({
    // A week ago: b 1100 (1st), a 1050 (2nd), "new" not ranked. Now: new 1st, a 2nd (won 100 this week), b 3rd.
    players: [player("a", 1150), player("b", 1100), player("new", 1300)],
    changes: [...series("a", [["W", 100]], daysAgo(2)), ...old("a"), ...old("b"), ...series("new", [["W", 0], ["W", 0], ["W", 0]], daysAgo(1))],
    blacklisted: [],
    now,
  });
  const move = Object.fromEntries(board.ranked.map((p) => [p.id, p.rankChange]));
  assert.deepEqual(move, { new: null, a: 0, b: -2 });
});

test("rows keep every field of the player they came from", () => {
  const board = buildLadder({ players: [player("a", 1000, { uid: "81000100", team: { id: "t" } })], changes: series("a", [["W", 1], ["W", 1], ["W", 1]], daysAgo(1)), blacklisted: [], now });
  assert.equal(board.ranked[0].uid, "81000100");
  assert.deepEqual(board.ranked[0].team, { id: "t" });
  assert.equal("weekAgo" in board.ranked[0], false);
});

test("withRanks gives competition ranks and tierCounts counts per tier", () => {
  assert.deepEqual(withRanks([{ v: 5 }, { v: 5 }, { v: 3 }], (r) => r.v).map((r) => r.rank), [1, 1, 3]);
  const counts = tierCounts([{ tier: { key: "gold" } }, { tier: { key: "gold" } }, { tier: { key: "legend" } }]);
  assert.deepEqual(counts.filter((t) => t.players).map((t) => [t.key, t.players]), [["gold", 2], ["legend", 1]]);
});

test("movement: a series played exactly 7 days ago counts as this week, one millisecond older does not", () => {
  const week = 7 * 86400_000;
  const at = (ms: number) => new Date(now.getTime() - ms);
  const old3 = (id: string) => series(id, [["W", 1], ["W", 1], ["W", 1]], daysAgo(30));
  const board = buildLadder({
    players: [player("edge", 1000), player("late", 990)],
    changes: [
      { playerId: "edge", result: "W", delta: 50, playedAt: at(week) },
      ...old3("edge"),
      { playerId: "late", result: "W", delta: 50, playedAt: at(week + 1) },
      ...old3("late"),
    ],
    blacklisted: [],
    now,
  });
  const by = Object.fromEntries(board.ranked.map((p) => [p.id, p.rankChange]));
  // A week ago: late 990 (its +50 is older than the week), edge 950 (its +50 is inside it) → edge 2nd, now 1st.
  assert.deepEqual(by, { edge: 1, late: -1 });
});

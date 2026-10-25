// The ladder use cases with an in-memory source: no server, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LadderPlayerRecord, LadderSource } from "../ports/ladderSource.js";
import { makeMmrLadder, makePlayerLadder } from "./playerLadder.js";

const now = new Date("2026-10-25T12:00:00Z");
const record = (id: string, mmr: number, teamId: string | null, specialMmr = 1000): LadderPlayerRecord => ({
  id, name: id, nickname: null, country: null, role: null, avatarUrl: null, teamId, uid: null, server: null, discordId: null,
  mmr, peakMmr: mmr, specialMmr, specialPeakMmr: specialMmr, gameId: "g1", guildId: null, createdAt: now, updatedAt: now,
  team: teamId ? { id: teamId, name: teamId, tag: null, logoUrl: null, rating: 1000 } : null,
});
const three = (playerId: string) => [1, 2, 3].map(() => ({ playerId, delta: 1, result: "W", playedAt: new Date("2026-10-01") }));

function fakeSource() {
  const calls: unknown[] = [];
  const source: LadderSource = {
    async load(q) {
      calls.push(q);
      return {
        players: [record("a", 1200, "t1", 900), record("b", 1100, "t2", 1300), record("c", 1000, "t1"), record("d", 1000, "t1")],
        changes: [...three("a"), ...three("b"), ...three("c"), { playerId: "d", delta: 5, result: "W", playedAt: now }],
        blacklistedPlayerIds: [],
      };
    },
  };
  return { source, calls };
}

test("mmrLadder pages the ranked players and returns the tier counts and rules", async () => {
  const { source, calls } = fakeSource();
  const mmrLadder = makeMmrLadder({ playerLadder: makePlayerLadder({ source, clock: () => now }) });
  const page = await mmrLadder({ gameId: "g1", offset: 1, limit: 1 });
  assert.deepEqual(calls, [{ gameId: "g1", board: "main" }]);
  assert.deepEqual(page.data.map((p) => [p.rank, p.id]), [[2, "b"]]);
  assert.equal(page.total, 3);
  assert.deepEqual(page.placing.map((p) => p.id), ["d"]);
  assert.equal(page.tiers.reduce((n, t) => n + t.players, 0), 3);
  assert.deepEqual(page.rules, { start: 1000, k: 32, placementK: 48, placementSeries: 3, mvpBonus: 2, svpBonus: 1, movementDays: 7 });
});

test("teamId keeps the overall rank and filters ranked and placing players", async () => {
  const { source } = fakeSource();
  const mmrLadder = makeMmrLadder({ playerLadder: makePlayerLadder({ source, clock: () => now }) });
  const page = await mmrLadder({ teamId: "t1", offset: 0, limit: 50 });
  assert.deepEqual(page.data.map((p) => [p.rank, p.id]), [[1, "a"], [3, "c"]]);
  assert.equal(page.total, 2);
  assert.deepEqual(page.placing.map((p) => p.id), ["d"]);
});

test("the special board ranks the special rating and reads special changes", async () => {
  const { source, calls } = fakeSource();
  const board = await makePlayerLadder({ source, clock: () => now })(null, now, true);
  assert.deepEqual(calls, [{ gameId: null, board: "special" }]);
  assert.deepEqual(board.ranked.map((p) => [p.id, p.mmr]), [["b", 1300], ["c", 1000], ["a", 900]]);
});

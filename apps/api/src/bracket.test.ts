import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  affectedBy,
  buildBracket,
  complete,
  firstRoundPositions,
  FORMATS,
  isFinished,
  placements,
  positionsProblem,
  reopen,
  roundLabel,
  roundRobinTable,
  seededPositions,
  seedOrder,
  type Format,
  type Slot,
} from "./lib/bracket.js";

const teams = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

/** A small seeded random generator so failures can be replayed. */
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

/** Plays every READY slot (lowest number first) with a chosen winner until the bracket finishes. */
function playOut(slots: Slot[], pick: (s: Slot) => string | null) {
  let guard = 0;
  while (!isFinished(slots)) {
    const ready = slots.filter((s) => s.status === "READY").sort((a, b) => a.number - b.number);
    assert.ok(ready.length > 0, "bracket is stuck: nothing ready but not finished");
    const s = ready[0];
    const w = pick(s);
    complete(slots, s.code, { winnerId: w, scoreA: w === s.teamAId ? 2 : w === null ? 1 : 0, scoreB: w === s.teamBId ? 2 : w === null ? 1 : 0, outcome: "PLAYED" });
    assert.ok(++guard < 5000);
  }
}

/** Checks things that must hold for any finished bracket. */
function checkFinished(format: Format, slots: Slot[], ids: string[]) {
  const played = slots.filter((s) => s.outcome === "PLAYED");
  for (const s of played) {
    assert.ok(s.teamAId && s.teamBId && s.teamAId !== s.teamBId, `${s.code} has two different teams`);
  }
  // Nobody plays twice in the same round of the same stage.
  const seen = new Set<string>();
  for (const s of played) {
    for (const t of [s.teamAId!, s.teamBId!]) {
      const key = `${s.stage}${s.round}:${t}`;
      assert.ok(!seen.has(key), `${t} plays twice in ${s.stage}${s.round}`);
      seen.add(key);
    }
  }
  const losses = new Map<string, number>();
  for (const s of played) if (s.loserId) losses.set(s.loserId, (losses.get(s.loserId) ?? 0) + 1);
  const place = placements(format, slots, ids);
  assert.equal(place.size, ids.length, "every team gets a placement");
  const champions = [...place.entries()].filter(([, p]) => p === 1);
  if (format !== "ROUND_ROBIN") {
    assert.equal(champions.length, 1, "exactly one champion");
    const champ = champions[0][0];
    if (format === "SINGLE_ELIMINATION") {
      for (const id of ids) {
        const l = losses.get(id) ?? 0;
        // Third-place match: a semifinal loser can lose twice (semi + third place).
        assert.ok(id === champ ? l === 0 : l === 1 || (l === 2 && slots.some((s) => s.code === "P3")), `${id} lost ${l} times`);
      }
    } else {
      for (const id of ids) {
        const l = losses.get(id) ?? 0;
        // Everyone but the champion is out after exactly two losses; the champion has at most one
        // (lost the first grand final, then won the reset).
        const gf = slots.find((s) => s.code === "GF1")!;
        const noResetFinalist = !slots.some((s) => s.code === "GF2") && gf.loserId === id && gf.teamAId === id;
        if (id === champ) assert.ok(l <= 1, `champion lost ${l} times`);
        else if (noResetFinalist) assert.equal(l, 1, "without a reset the winners-bracket finalist is out after one loss");
        else assert.equal(l, 2, `${id} should be out after two losses, lost ${l}`);
      }
    }
  } else {
    // Every pair meets exactly once.
    const pairs = new Set(played.map((s) => [s.teamAId, s.teamBId].sort().join("|")));
    assert.equal(pairs.size, (ids.length * (ids.length - 1)) / 2);
    assert.equal(played.length, pairs.size);
  }
  const numbers = slots.map((s) => s.number).sort((a, b) => a - b);
  assert.deepEqual(numbers, slots.map((_, i) => i + 1), "match numbers are 1..n");
}

describe("seeding", () => {
  test("standard seed order keeps top seeds apart", () => {
    assert.deepEqual(seedOrder(2), [1, 2]);
    assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
    assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  });

  test("byes go to the top seeds and never pair two byes", () => {
    for (let n = 2; n <= 40; n++) {
      const pos = seededPositions(teams(n));
      assert.equal(positionsProblem(pos, teams(n)), null, `n=${n}`);
      const byes = pos.filter((p) => p === null).length;
      assert.equal(byes, pos.length - n);
      for (let i = 0; i < pos.length; i += 2) {
        if (pos[i] === null || pos[i + 1] === null) {
          const team = pos[i] ?? pos[i + 1];
          assert.ok(Number(team!.slice(1)) <= byes, `n=${n}: ${team} got a bye but is not a top seed`);
        }
      }
    }
  });

  test("hand-made layouts are checked", () => {
    const ids = teams(5);
    assert.match(positionsProblem(["t1", "t2"], ids)!, /8 ช่อง/);
    assert.match(positionsProblem(["t1", "t1", "t2", "t3", "t4", "t5", null, null], ids)!, /ซ้ำ/);
    assert.match(positionsProblem(["t1", "t2", "t3", "t4", null, null, null, "x"], ids)!, /ทุกทีม/);
    assert.match(positionsProblem(["t1", "t2", "t3", "t4", null, null, "t5", null], ids)!, /คู่ที่ 3/);
    assert.equal(positionsProblem(["t1", null, "t2", "t3", "t4", null, "t5", null], ids), null);
  });
});

describe("every format, every size, random results", () => {
  for (const format of FORMATS) {
    test(format, () => {
      for (let n = 2; n <= (format === "ROUND_ROBIN" ? 12 : 33); n++) {
        for (const opts of [{}, { thirdPlaceMatch: true, grandFinalReset: false }]) {
          for (let seed = 1; seed <= 4; seed++) {
            const r = rng(seed * 97 + n);
            const ids = teams(n);
            const slots = buildBracket(format, ids, opts);
            playOut(slots, (s) => (format === "ROUND_ROBIN" && r() < 0.15 ? null : r() < 0.5 ? s.teamAId : s.teamBId));
            checkFinished(format, slots, ids);
          }
        }
      }
    });
  }
});

describe("single elimination", () => {
  test("8 teams: final placements 1, 2, 3, 3, 5 x4", () => {
    const ids = teams(8);
    const slots = buildBracket("SINGLE_ELIMINATION", ids);
    assert.equal(slots.length, 7);
    playOut(slots, (s) => (Number(s.teamAId!.slice(1)) < Number(s.teamBId!.slice(1)) ? s.teamAId : s.teamBId)); // better seed wins
    const p = placements("SINGLE_ELIMINATION", slots, ids);
    assert.deepEqual(ids.map((id) => p.get(id)), [1, 2, 3, 3, 5, 5, 5, 5]);
    assert.equal(roundLabel("SINGLE_ELIMINATION", slots.find((s) => s.round === 3)!, slots), "รอบชิงชนะเลิศ");
    assert.equal(roundLabel("SINGLE_ELIMINATION", slots.find((s) => s.round === 2)!, slots), "รอบรองชนะเลิศ");
    assert.equal(roundLabel("SINGLE_ELIMINATION", slots.find((s) => s.round === 1)!, slots), "รอบ 8 ทีมสุดท้าย");
  });

  test("third-place match decides 3rd and 4th", () => {
    const ids = teams(4);
    const slots = buildBracket("SINGLE_ELIMINATION", ids, { thirdPlaceMatch: true });
    playOut(slots, (s) => (Number(s.teamAId!.slice(1)) < Number(s.teamBId!.slice(1)) ? s.teamAId : s.teamBId));
    const p = placements("SINGLE_ELIMINATION", slots, ids);
    assert.deepEqual(ids.map((id) => p.get(id)), [1, 2, 3, 4]);
  });

  test("5 teams: three byes resolve straight away", () => {
    const slots = buildBracket("SINGLE_ELIMINATION", teams(5));
    const r1 = slots.filter((s) => s.round === 1);
    assert.equal(r1.filter((s) => s.outcome === "BYE").length, 3);
    assert.equal(r1.filter((s) => s.status === "READY").length, 1); // t4 v t5
    // t1's next opponent waits for t4/t5; t2 and t3 already meet in round 2.
    const r2 = slots.filter((s) => s.round === 2);
    assert.ok(r2.some((s) => s.status === "READY" && [s.teamAId, s.teamBId].sort().join() === "t2,t3"));
  });

  test("a hand-made layout is used as given", () => {
    const pos = ["t3", "t1", "t2", null];
    const slots = buildBracket("SINGLE_ELIMINATION", teams(3), {}, pos);
    assert.deepEqual(firstRoundPositions(slots), pos);
    const first = slots.find((s) => s.code === "W1-0")!;
    assert.deepEqual([first.teamAId, first.teamBId], ["t3", "t1"]);
  });
});

describe("double elimination", () => {
  test("4 teams: structure and a grand final reset", () => {
    const ids = teams(4);
    const slots = buildBracket("DOUBLE_ELIMINATION", ids);
    // W1 x2, W2, L1, L2, GF1, GF2
    assert.equal(slots.length, 7);
    const play = (code: string, winner: string) => {
      const s = slots.find((x) => x.code === code)!;
      assert.equal(s.status, "READY", `${code} should be ready`);
      complete(slots, code, { winnerId: winner, scoreA: 2, scoreB: 0, outcome: "PLAYED" });
    };
    play("W1-0", "t1"); // t1 beats t4
    play("W1-1", "t2"); // t2 beats t3
    play("L1-0", "t3"); // t3 knocks out t4
    play("W2-0", "t1"); // t1 wins the winners final, t2 drops
    play("L2-0", "t2"); // t2 knocks out t3
    const gf1 = slots.find((x) => x.code === "GF1")!;
    assert.deepEqual([gf1.teamAId, gf1.teamBId], ["t1", "t2"]);
    play("GF1", "t2"); // losers-bracket team wins: reset
    const gf2 = slots.find((x) => x.code === "GF2")!;
    assert.equal(gf2.status, "READY");
    play("GF2", "t2");
    assert.ok(isFinished(slots));
    const p = placements("DOUBLE_ELIMINATION", slots, ids);
    assert.deepEqual(ids.map((id) => p.get(id)), [2, 1, 3, 4]);
  });

  test("the grand final reset is skipped when the winners-bracket team wins", () => {
    const slots = buildBracket("DOUBLE_ELIMINATION", teams(2));
    complete(slots, "W1-0", { winnerId: "t1", scoreA: 2, scoreB: 0, outcome: "PLAYED" });
    complete(slots, "GF1", { winnerId: "t1", scoreA: 2, scoreB: 0, outcome: "PLAYED" });
    assert.equal(slots.find((s) => s.code === "GF2")!.status, "SKIPPED");
    assert.ok(isFinished(slots));
    assert.deepEqual([...placements("DOUBLE_ELIMINATION", slots, teams(2)).entries()].sort(), [["t1", 1], ["t2", 2]]);
  });

  test("without a reset there is a single grand final", () => {
    const slots = buildBracket("DOUBLE_ELIMINATION", teams(4), { grandFinalReset: false });
    assert.ok(!slots.some((s) => s.code === "GF2"));
  });

  test("labels", () => {
    const slots = buildBracket("DOUBLE_ELIMINATION", teams(8));
    const label = (code: string) => roundLabel("DOUBLE_ELIMINATION", slots.find((s) => s.code === code)!, slots);
    assert.equal(label("W1-0"), "สายบน รอบ 1");
    assert.equal(label("W3-0"), "ชิงชนะเลิศสายบน");
    assert.equal(label("L1-0"), "สายล่าง รอบ 1");
    assert.equal(label("L4-0"), "ชิงชนะเลิศสายล่าง");
    assert.equal(label("GF1"), "แกรนด์ไฟนอล");
    assert.equal(label("GF2"), "แกรนด์ไฟนอล (นัดตัดสิน)");
  });
});

describe("round robin", () => {
  test("odd count: each team rests once and the table ranks by points", () => {
    const ids = teams(5);
    const slots = buildBracket("ROUND_ROBIN", ids);
    assert.equal(slots.length, 10);
    assert.equal(new Set(slots.map((s) => s.round)).size, 5);
    assert.ok(slots.every((s) => s.status === "READY"));
    playOut(slots, (s) => (Number(s.teamAId!.slice(1)) < Number(s.teamBId!.slice(1)) ? s.teamAId : s.teamBId));
    const table = roundRobinTable(slots, ids);
    assert.deepEqual(table.map((r) => r.teamId), ids);
    assert.deepEqual(table.map((r) => r.points), [12, 9, 6, 3, 0]);
    const p = placements("ROUND_ROBIN", slots, ids);
    assert.deepEqual(ids.map((id) => p.get(id)), [1, 2, 3, 4, 5]);
  });

  test("equal records share a placement", () => {
    const ids = teams(3);
    const slots = buildBracket("ROUND_ROBIN", ids);
    // Rock-paper-scissors, all 2-0: everyone 3 points, +0.
    const beats: Record<string, string> = { t1: "t2", t2: "t3", t3: "t1" };
    playOut(slots, (s) => (beats[s.teamAId!] === s.teamBId ? s.teamAId : s.teamBId));
    const p = placements("ROUND_ROBIN", slots, ids);
    assert.deepEqual(ids.map((id) => p.get(id)), [1, 1, 1]);
  });
});

describe("undoing results", () => {
  test("reopening a match pulls its teams back out of later matches", () => {
    const slots = buildBracket("DOUBLE_ELIMINATION", teams(8));
    const before = JSON.stringify(slots);
    complete(slots, "W1-0", { winnerId: "t1", scoreA: 2, scoreB: 0, outcome: "PLAYED" });
    complete(slots, "W1-1", { winnerId: "t4", scoreA: 2, scoreB: 1, outcome: "PLAYED" });
    complete(slots, "W2-0", { winnerId: "t1", scoreA: 2, scoreB: 0, outcome: "PLAYED" });
    assert.deepEqual(affectedBy(slots, "W1-0").map((s) => s.code), ["W2-0"]);
    const undone = reopen(slots, "W1-0");
    assert.deepEqual(undone.sort(), ["W1-0", "W2-0"]);
    const w2 = slots.find((s) => s.code === "W2-0")!;
    assert.equal(w2.teamAId, null);
    assert.equal(w2.teamBId, "t4");
    assert.equal(w2.status, "PENDING");
    const l1 = slots.find((s) => s.code === "L1-0")!;
    assert.equal(l1.teamAId, null); // t8 taken back out of the losers bracket
    assert.equal(l1.teamBId, "t5"); // loser of W1-1 stays
    reopen(slots, "W1-1");
    assert.equal(JSON.stringify(slots), before, "undoing everything restores the fresh bracket");
  });

  test("reopening then replaying with the other winner gives a consistent bracket", () => {
    for (let n = 3; n <= 17; n++) {
      for (const format of ["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION"] as const) {
        const r = rng(n * 13);
        const ids = teams(n);
        const slots = buildBracket(format, ids, { thirdPlaceMatch: true });
        // Play half, flip a random finished match, then finish.
        let played = 0;
        while (played < n && !isFinished(slots)) {
          const s = slots.filter((x) => x.status === "READY").sort((a, b) => a.number - b.number)[0];
          complete(slots, s.code, { winnerId: s.teamAId, scoreA: 2, scoreB: 0, outcome: "PLAYED" });
          played++;
        }
        const done = slots.filter((s) => s.outcome === "PLAYED");
        const target = done[Math.floor(r() * done.length)];
        const old = target.winnerId;
        reopen(slots, target.code);
        const again = slots.find((s) => s.code === target.code)!;
        assert.equal(again.status, "READY");
        complete(slots, target.code, { winnerId: old === again.teamAId ? again.teamBId : again.teamAId, scoreA: 0, scoreB: 2, outcome: "PLAYED" });
        playOut(slots, (s) => (r() < 0.5 ? s.teamAId : s.teamBId));
        checkFinished(format, slots, ids);
      }
    }
  });

  test("reopening the first grand final clears the reset", () => {
    const slots = buildBracket("DOUBLE_ELIMINATION", teams(2));
    complete(slots, "W1-0", { winnerId: "t1", scoreA: 2, scoreB: 0, outcome: "PLAYED" });
    complete(slots, "GF1", { winnerId: "t2", scoreA: 0, scoreB: 2, outcome: "PLAYED" });
    complete(slots, "GF2", { winnerId: "t2", scoreA: 0, scoreB: 2, outcome: "PLAYED" });
    assert.deepEqual(reopen(slots, "GF1").sort(), ["GF1", "GF2"]);
    const gf2 = slots.find((s) => s.code === "GF2")!;
    assert.equal(gf2.status, "PENDING");
    assert.equal(gf2.teamAId, null);
    complete(slots, "GF1", { winnerId: "t1", scoreA: 2, scoreB: 0, outcome: "PLAYED" });
    assert.equal(gf2.status, "SKIPPED");
  });

  test("results are refused where they do not fit", () => {
    const slots = buildBracket("SINGLE_ELIMINATION", teams(4));
    assert.throws(() => complete(slots, "W2-0", { winnerId: "t1", scoreA: 1, scoreB: 0, outcome: "PLAYED" }), /not ready/);
    assert.throws(() => complete(slots, "W1-0", { winnerId: "t2", scoreA: 1, scoreB: 0, outcome: "PLAYED" }), /not in this match/);
    assert.throws(() => complete(slots, "W1-0", { winnerId: null, scoreA: 1, scoreB: 1, outcome: "PLAYED" }), /need a winner/);
  });
});

/** The read-side refresh of prediction markets: real work on stale reads, one refresh per crowd, retry after failure. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeReadRefresh } from "./lib/readRefresh.js";

function setup(opts: { fail?: () => boolean; slow?: () => Promise<void> } = {}) {
  let clock = 0;
  const calls: string[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  const schedule = <T,>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const errors: unknown[] = [];
  const r = makeReadRefresh({
    refresh: async (key) => {
      calls.push(key);
      await opts.slow?.();
      if (opts.fail?.()) throw new Error("sync failed");
    },
    schedule,
    maxAgeMs: 30_000,
    now: () => clock,
    onBackgroundError: (_k, e) => errors.push(e),
  });
  const settle = () => queue.then(() => new Promise((res) => setImmediate(res)));
  return { r, calls, errors, settle, tick: (ms: number) => (clock += ms) };
}

test("first read waits for a real refresh; fresh reads do nothing", async () => {
  const s = setup();
  await s.r.forRead("t1");
  assert.deepEqual(s.calls, ["t1"]);
  s.tick(10_000);
  await s.r.forRead("t1");
  await s.settle();
  assert.deepEqual(s.calls, ["t1"]);
});

test("stale reads at 31 s and 62 s really refresh (the old code only moved the timestamp)", async () => {
  const s = setup();
  await s.r.forRead("t1");
  s.tick(31_000);
  await s.r.forRead("t1");
  await s.settle();
  s.tick(31_000);
  await s.r.forRead("t1");
  await s.settle();
  assert.equal(s.calls.length, 3);
  assert.equal(s.r.lastSuccess("t1"), 62_000);
});

test("200 readers of a stale tournament start one refresh and do not wait for it", async () => {
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  let slow = false;
  const s = setup({ slow: () => (slow ? gate : Promise.resolve()) });
  await s.r.forRead("t1");
  s.tick(31_000);
  slow = true;
  await Promise.all(Array.from({ length: 200 }, () => s.r.forRead("t1")));
  assert.equal(s.r.inFlight("t1"), true);
  release();
  await s.settle();
  assert.equal(s.calls.length, 2);
  assert.equal(s.r.inFlight("t1"), false);
});

test("a failed background refresh keeps the old time and the next read tries again", async () => {
  let failing = false;
  const s = setup({ fail: () => failing });
  await s.r.forRead("t1");
  s.tick(31_000);
  failing = true;
  await s.r.forRead("t1");
  await s.settle();
  assert.equal(s.errors.length, 1);
  assert.equal(s.r.lastSuccess("t1"), 0, "failure is not recorded as success");
  failing = false;
  await s.r.forRead("t1");
  await s.settle();
  assert.equal(s.calls.length, 3);
  assert.equal(s.r.lastSuccess("t1"), 31_000);
});

test("a failed first refresh rejects the waiting read, and the next read retries", async () => {
  let failing = true;
  const s = setup({ fail: () => failing });
  await assert.rejects(s.r.forRead("t1"), /sync failed/);
  failing = false;
  await s.r.forRead("t1");
  assert.equal(s.calls.length, 2);
});

test("an explicit sync always runs, and a read right after it is fresh", async () => {
  const s = setup();
  await s.r.forRead("t1");
  await s.r.now("t1");
  await s.r.now("t1");
  assert.equal(s.calls.length, 3);
  await s.r.forRead("t1");
  await s.settle();
  assert.equal(s.calls.length, 3);
});

test("tournaments are tracked separately", async () => {
  const s = setup();
  await s.r.forRead("a");
  await s.r.forRead("b");
  s.tick(31_000);
  await s.r.now("a");
  await s.r.forRead("b");
  await s.settle();
  assert.deepEqual(s.calls, ["a", "b", "a", "b"]);
});

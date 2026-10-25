/**
 * HTTP contract of GET /api/v1/rankings/mmr: the new module path must answer exactly like the old
 * handler (frozen in contract/legacyMmrLadder.ts) on the same database, for every query shape,
 * plus the auth and error responses.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ZodError } from "zod";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-mmr-contract-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: process.env });

const { createApp } = await import("../../app.js");
const { createApiKey } = await import("../../lib/apiKeys.js");
const { prisma } = await import("../../lib/db.js");
const { legacyMmrLadder, legacyMmrQuery } = await import("./contract/legacyMmrLadder.js");
const { seedLadder } = await import("./contract/fixtures.js");

let server: Server;
let base: string;
let key: string;

async function get(query: string, apiKey: string | null = key) {
  const res = await fetch(`${base}/api/v1/rankings/mmr${query}`, { headers: apiKey ? { "X-API-Key": apiKey } : {} });
  return { status: res.status, body: await res.json() };
}

/** What the old handler answered for this query string: its JSON, or its validation error. */
async function legacy(query: string) {
  const parsed = legacyMmrQuery.safeParse(Object.fromEntries(new URLSearchParams(query)));
  if (!parsed.success) return { status: 400, body: { error: "Validation failed", details: (parsed.error as ZodError).flatten() } };
  return { status: 200, body: JSON.parse(JSON.stringify(await legacyMmrLadder(prisma, parsed.data))) };
}

async function same(query: string) {
  const [now, old] = await Promise.all([get(query), legacy(query)]);
  assert.deepEqual(now, old, `GET /rankings/mmr${query}`);
  return now.body;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  key = (await createApiKey("contract reader", "read")).key;
});

after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("GET /rankings/mmr matches the old handler", () => {
  test("no data: empty ladder, every tier at 0, defaults echoed", async () => {
    const body = await same("");
    assert.deepEqual(body.data, []);
    assert.equal(body.total, 0);
    assert.equal(body.limit, 50);
    assert.equal(body.offset, 0);
    assert.deepEqual(body.placing, []);
    assert.ok(body.tiers.every((t: { players: number }) => t.players === 0));
  });

  let f: Awaited<ReturnType<typeof seedLadder>>;
  test("with data, every query shape", async () => {
    f = await seedLadder(prisma);
    const queries = [
      "",
      `?gameId=${f.g1.id}`,
      `?gameId=${f.g2.id}`,
      "?gameId=no-such-game",
      `?gameId=%20${f.g1.id}%20`,
      `?teamId=${f.t1.id}`,
      `?teamId=${f.t2.id}&gameId=${f.g1.id}`,
      "?teamId=no-such-team",
      "?limit=2",
      "?limit=2&offset=2",
      "?limit=3&offset=9",
      "?offset=100",
      "?limit=200",
      "?limit=1&offset=0&unknown=1",
    ];
    for (const q of queries) await same(q);
  });

  test("ties share a rank and break by series then name; movement against a week ago", async () => {
    const { data } = await same("?limit=200");
    const at = (id: string) => data.find((p: { id: string }) => p.id === id);
    const { a, b, c, d, h } = f.ids;
    assert.deepEqual([b, c, d].map((id) => at(id).rank), [3, 3, 3]);
    const order = data.map((p: { id: string }) => p.id);
    assert.ok(order.indexOf(b) < order.indexOf(c) && order.indexOf(c) < order.indexOf(d), "B (more series), then Cove, then Dune");
    // A week ago: Moss 1310, Bolt 1210, Cove/Dune 1180, Ace 1160 (5th). Now Ace is 2nd, Bolt 3rd.
    assert.equal(at(a).rankChange, 3);
    assert.equal(at(b).rankChange, -1);
    assert.equal(at(h).blacklisted, false, "a lifted entry does not flag");
  });

  test("placing, unplayed, blacklist and special-only players", async () => {
    const all = await same("");
    const { e, g, i } = f.ids;
    assert.deepEqual(all.placing.map((p: { id: string; seriesToPlace: number; lastDelta: number; form: string[] }) => [p.id, p.seriesToPlace, p.lastDelta, p.form]), [[e, 1, -5, ["L", "W"]]]);
    assert.ok(!all.data.some((p: { id: string }) => p.id === i), "special-only series do not rank on the main board");
    const g2 = await same(`?gameId=${f.g2.id}`);
    assert.deepEqual(g2.data.map((p: { id: string; blacklisted: boolean }) => [p.id, p.blacklisted]), [[g, true]]);
  });

  test("pages cover the ladder once, in order", async () => {
    const full = (await same("?limit=200")).data.map((p: { id: string }) => p.id);
    const paged: string[] = [];
    for (let offset = 0; offset < full.length; offset += 3) paged.push(...(await same(`?limit=3&offset=${offset}`)).data.map((p: { id: string }) => p.id));
    assert.deepEqual(paged, full);
  });

  test("bad queries: same 400 and error body", async () => {
    for (const q of ["?limit=0", "?limit=201", "?limit=abc", "?limit=1.5", "?offset=-1", "?gameId=", "?gameId=%20%20", `?gameId=${"x".repeat(41)}`]) {
      const res = await same(q);
      assert.equal(res.error, "Validation failed", q);
    }
  });

  test("needs an API key (any scope reads)", async () => {
    const res = await get("", null);
    assert.equal(res.status, 401);
    const other = await fetch(`${base}/api/v1/teams`);
    assert.deepEqual(res.body, await other.json(), "same error body as every other endpoint");
  });
});

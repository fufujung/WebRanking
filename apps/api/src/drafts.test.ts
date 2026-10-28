/** Pick/ban drafts from the broadcast bot: a "draft" key sends them, the site adds up per-character stats. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-drafts-test-"));
fs.writeFileSync(path.join(tmp, "test.db"), "");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db").replaceAll("\\", "/")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: process.env });

const { createApp } = await import("./app.js");
const { createApiKey } = await import("./lib/apiKeys.js");
const { prisma } = await import("./lib/db.js");

let server: Server;
let base: string;
let admin: string;
let reader: string;

async function call(method: string, url: string, body?: unknown, key = admin) {
  const headers: Record<string, string> = { "X-API-Key": key };
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
  reader = (await createApiKey("test reader", "read")).key;
});

after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const slots = (bans: [string, string], a: string[], b: string[]) => [
  { side: "A", kind: "ban", char: bans[0], name: bans[0].toUpperCase() },
  { side: "B", kind: "ban", char: bans[1], name: bans[1].toUpperCase() },
  ...a.map((char) => ({ side: "A", kind: "pick", char, name: char.toUpperCase() })),
  ...b.map((char) => ({ side: "B", kind: "pick", char, name: char.toUpperCase() })),
];

describe("pick/ban drafts", () => {
  let tid: string;
  let bot: string;
  let tigers: string;

  test("a draft key sends a game's draft; sending it again replaces it", async () => {
    tid = (await ok("POST", "/tournaments", { name: "Street Rivals Cup", startDate: "2026-10-26" })).id;
    tigers = (await ok("POST", "/teams", { name: "Red Tigers" })).id;
    const keyRes = await ok("POST", "/keys", { name: "vMix bot", scope: "draft" });
    assert.equal(keyRes.scope, "draft");
    bot = keyRes.key;

    const g1 = { teamA: "Red Tigers", teamB: "Siam Dragons", gameNo: 1, slots: slots(["kise", "akashi"], ["kagami", "hyuga", "kobori"], ["moriyama", "otsubo", "kise2"]) };
    const first = await call("PUT", `/tournaments/${tid}/drafts/20261026_200101`, g1, bot);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.teamAId, tigers, "the blue team's name matches a site team");
    assert.equal(first.body.teamBId, null);
    assert.equal(first.body.winner, null);
    // The winner is pressed later: the bot sends the same game again.
    const again = await call("PUT", `/tournaments/${tid}/drafts/20261026_200101`, { ...g1, winner: "A" }, bot);
    assert.equal(again.status, 200);
    assert.equal(again.body.id, first.body.id);
    const list = await ok("GET", `/tournaments/${tid}/drafts`);
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].winner, "A");
    assert.equal(list.data[0].slots.length, 8);
  });

  test("characters add up across games: picks, bans, presence and win rate", async () => {
    await call("PUT", `/tournaments/${tid}/drafts/g2`, { teamA: "Red Tigers", teamB: "Siam Dragons", gameNo: 2, winner: "B", slots: slots(["kagami", "kise"], ["akashi", "hyuga", "otsubo"], ["moriyama", "kobori", "kise2"]) }, bot);
    await call("PUT", `/tournaments/${tid}/drafts/g3`, { teamA: "Red Tigers", teamB: "Siam Dragons", gameNo: 3, slots: slots(["kise", "hyuga"], ["kagami", "akashi", "kobori"], ["moriyama", "otsubo", "kise2"]) }, bot);
    const res = await ok("GET", `/tournaments/${tid}/drafts`);
    assert.equal(res.games, 3);
    assert.equal(res.decided, 2);
    assert.deepEqual(res.data.map((d: { ref: string }) => d.ref).sort(), ["20261026_200101", "g2", "g3"]);
    const by = Object.fromEntries(res.characters.map((c: { char: string }) => [c.char, c]));
    assert.deepEqual(
      { picks: by.kobori.picks, wins: by.kobori.wins, losses: by.kobori.losses, winRate: by.kobori.winRate, pickRate: by.kobori.pickRate },
      { picks: 3, wins: 2, losses: 0, winRate: 100, pickRate: 100 },
      "won game 1 on blue and game 2 on red; game 3 has no result",
    );
    assert.deepEqual({ bans: by.kise.bans, picks: by.kise.picks, presence: by.kise.presence, winRate: by.kise.winRate }, { bans: 3, picks: 0, presence: 100, winRate: null });
    assert.equal(by.kagami.banRate, 33.3);
    assert.equal(by.kagami.name, "KAGAMI", "the name the bot shows");
  });

  test("a draft key can only send drafts; read keys cannot send them", async () => {
    assert.equal((await call("POST", "/teams", { name: "Sneaky" }, bot)).status, 403);
    assert.equal((await call("PATCH", `/tournaments/${tid}`, { name: "Hacked" }, bot)).status, 403);
    assert.equal((await call("PUT", `/tournaments/${tid}/stories`, { stories: [] }, bot)).status, 403);
    assert.equal((await call("GET", `/tournaments/${tid}`, undefined, bot)).status, 200, "it can still read");
    assert.equal((await call("PUT", `/tournaments/${tid}/drafts/g9`, { teamA: "a", teamB: "b", slots: [] }, reader)).status, 403);
  });

  test("bad drafts are refused", async () => {
    const put = (ref: string, body: unknown, t = tid) => call("PUT", `/tournaments/${t}/drafts/${ref}`, body, bot);
    assert.equal((await put("g9", { teamA: "a", teamB: "b", slots: [{ side: "C", kind: "pick", char: "x" }] })).status, 400);
    assert.equal((await put("g9", { teamA: "", teamB: "b", slots: [] })).status, 400);
    assert.equal((await put("g9", { teamA: "a", teamB: "b", slots: [], winner: "draw" })).status, 400);
    assert.equal((await put("bad%20ref", { teamA: "a", teamB: "b", slots: [] })).status, 400);
    assert.equal((await put("g9", { teamA: "a", teamB: "b", slots: [] }, "nope")).status, 404);
    assert.equal((await ok("GET", `/tournaments/${tid}/drafts`)).games, 3, "nothing was saved");
  });

  test("a draft can be removed, and drafts come back with a restored tournament", async () => {
    assert.equal((await call("DELETE", `/tournaments/${tid}/drafts/g3`, undefined, bot)).status, 204);
    assert.equal((await call("DELETE", `/tournaments/${tid}/drafts/g3`, undefined, bot)).status, 404);
    assert.equal((await ok("GET", `/tournaments/${tid}/drafts`)).games, 2);

    await ok("DELETE", `/tournaments/${tid}`);
    assert.equal(await prisma.draft.count(), 0, "deleting the tournament takes its drafts along");
    const [item] = (await ok("GET", "/trash")).data;
    await ok("POST", `/trash/${item.id}/restore`);
    const back = await ok("GET", `/tournaments/${tid}/drafts`);
    assert.equal(back.games, 2);
    assert.equal(back.data.find((d: { ref: string }) => d.ref === "20261026_200101").teamAId, tigers);
  });
});

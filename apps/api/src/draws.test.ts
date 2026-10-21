/** Lucky draws: entries from the YouTube live chat, Discord and typed lists, fair draws and redraws. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-draw-test-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
execSync("npx prisma db push --skip-generate", { stdio: "ignore", env: process.env });

// A stand-in for YouTube's API: one live video and its chat, served page by page.
const VIDEO = "abcdefghijk";
let chatPages: Record<string, unknown>[] = [];
let youtubeError: { status: number; reason: string } | null = null;
const seen: string[] = [];
const youtube = http.createServer((req, res) => {
  const url = new URL(req.url!, "http://x");
  seen.push(`${url.pathname}?${url.searchParams.get("pageToken") ?? ""}|${url.searchParams.get("key")}`);
  res.setHeader("Content-Type", "application/json");
  if (youtubeError) {
    res.statusCode = youtubeError.status;
    return void res.end(JSON.stringify({ error: { message: youtubeError.reason, errors: [{ reason: youtubeError.reason }] } }));
  }
  if (url.pathname.endsWith("/videos")) {
    const live = url.searchParams.get("id") === VIDEO;
    return void res.end(JSON.stringify({ items: live ? [{ liveStreamingDetails: { activeLiveChatId: "chat-1" } }] : [] }));
  }
  const at = Number(url.searchParams.get("pageToken") ?? 0);
  res.end(JSON.stringify({ ...(chatPages[at] ?? { items: [] }), nextPageToken: String(Math.min(at + 1, chatPages.length)), pollingIntervalMillis: 1000 }));
});
await new Promise<void>((r) => youtube.listen(0, r));
process.env.YOUTUBE_API_URL = `http://127.0.0.1:${(youtube.address() as AddressInfo).port}/youtube/v3`;
process.env.YOUTUBE_API_KEY = "test-key";

const { createApp } = await import("./app.js");
const { createApiKey } = await import("./lib/apiKeys.js");
const { prisma } = await import("./lib/db.js");
const { pollDraws, videoIdOf } = await import("./lib/draws.js");

let server: Server;
let base: string;
let admin: string;
let reader: string;

async function call(method: string, url: string, body?: unknown, key = admin) {
  const headers: Record<string, string> = { "X-API-Key": key };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}/api/v1${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
  youtube.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const msg = (channelId: string, text: string, extra: Record<string, unknown> = {}) => ({
  snippet: { type: "textMessageEvent", displayMessage: text, publishedAt: new Date(Date.now() + 1000).toISOString() },
  authorDetails: { channelId, displayName: `ช่อง ${channelId}`, profileImageUrl: `https://yt3.example/${channelId}.jpg`, isChatOwner: false, isChatModerator: false, ...extra },
});
/** Runs the chat reader as if its next turn were due now. */
async function poll(drawId: string) {
  await prisma.luckyDraw.update({ where: { id: drawId }, data: { nextPollAt: new Date(Date.now() - 1) } });
  await pollDraws();
}
const discord = (n: number) => String(200000000000000000n + BigInt(n));

describe("lucky draw links", () => {
  test("reads the video id from every kind of YouTube link", () => {
    assert.equal(videoIdOf("https://www.youtube.com/watch?v=abcdefghijk&t=3"), VIDEO);
    assert.equal(videoIdOf("https://youtu.be/abcdefghijk?si=x"), VIDEO);
    assert.equal(videoIdOf("youtube.com/live/abcdefghijk"), VIDEO);
    assert.equal(videoIdOf("https://m.youtube.com/watch?v=abcdefghijk"), VIDEO);
    assert.equal(videoIdOf(VIDEO), VIDEO);
    assert.equal(videoIdOf("https://evil.example/watch?v=abcdefghijk"), null);
    assert.equal(videoIdOf("not a link"), null);
  });

  test("a link that is not YouTube is refused", async () => {
    const r = await call("POST", "/draws", { title: "x", keyword: "#a", youtubeUrl: "https://example.com/x" });
    assert.equal(r.status, 400);
    assert.equal(r.body.details.field, "youtubeUrl");
  });
});

describe("entries from the YouTube live chat", () => {
  test("whoever types the keyword gets one entry; the streamer, mods and others do not", async () => {
    const d = await ok("POST", "/draws", { title: "แจกคีย์บอร์ด", keyword: "#OT500", winners: 2, minutes: 10, youtubeUrl: `https://youtu.be/${VIDEO}` });
    assert.equal(d.videoId, VIDEO);
    assert.equal(d.status, "DRAFT");
    chatPages = [
      { items: [msg("UC1", "ขอด้วยครับ #ot500"), msg("UC2", "สวัสดี"), msg("UCowner", "#OT500", { isChatOwner: true }), msg("UCmod", "#OT500", { isChatModerator: true })] },
      { items: [msg("UC1", "#OT500 อีกที"), msg("UC3", "#OT500!!")] },
    ];
    // Not open yet: the chat is not read.
    await pollDraws();
    assert.equal((await ok("GET", `/draws/${d.id}`)).entries.length, 0);

    const opened = await ok("POST", `/draws/${d.id}/open`);
    assert.equal(opened.status, "OPEN");
    assert.ok(new Date(opened.closesAt).getTime() > Date.now() + 9 * 60_000);
    seen.length = 0;
    await poll(d.id);
    await poll(d.id);
    const detail = await ok("GET", `/draws/${d.id}`);
    assert.deepEqual(detail.entries.map((e: { externalId: string }) => e.externalId).sort(), ["UC1", "UC3"]);
    assert.ok(detail.entries.every((e: { source: string }) => e.source === "YOUTUBE"));
    assert.equal(detail.chatError, null);
    // Looked up the live chat once, then followed the pages with the key.
    assert.deepEqual(seen, ["/youtube/v3/videos?|test-key", "/youtube/v3/liveChat/messages?|test-key", "/youtube/v3/liveChat/messages?1|test-key"]);
    // The private chat position never leaves the API.
    assert.equal(detail.pageToken, undefined);
    assert.equal(detail.liveChatId, undefined);
  });

  test("messages from before the draw opened do not count", async () => {
    const d = await ok("POST", "/draws", { title: "รอบ 2", keyword: "#late", youtubeUrl: VIDEO });
    await ok("POST", `/draws/${d.id}/open`);
    const old = msg("UC9", "#late");
    old.snippet.publishedAt = new Date(Date.now() - 3600_000).toISOString();
    chatPages = [{ items: [old, msg("UC10", "#LATE")] }];
    await poll(d.id);
    assert.deepEqual((await ok("GET", `/draws/${d.id}`)).entries.map((e: { externalId: string }) => e.externalId), ["UC10"]);
  });

  test("YouTube problems are shown to the organizer in Thai and retried later", async () => {
    const d = await ok("POST", "/draws", { title: "รอบ 3", keyword: "#q", youtubeUrl: VIDEO });
    await ok("POST", `/draws/${d.id}/open`);
    youtubeError = { status: 403, reason: "quotaExceeded" };
    try {
      await poll(d.id);
    } finally {
      youtubeError = null;
    }
    const after = await ok("GET", `/draws/${d.id}`);
    assert.match(after.chatError, /โควตา/);
    assert.ok(new Date(after.nextPollAt).getTime() > Date.now() + 5 * 60_000);
    // A video that is not live says so.
    const notLive = await ok("POST", "/draws", { title: "รอบ 4", keyword: "#q", youtubeUrl: "zzzzzzzzzzz" });
    await ok("POST", `/draws/${notLive.id}/open`);
    await poll(notLive.id);
    assert.match((await ok("GET", `/draws/${notLive.id}`)).chatError, /ยังไม่พบแชทสด/);
  });

  test("without a YOUTUBE_API_KEY the organizer is told how to fix it", async () => {
    const d = await ok("POST", "/draws", { title: "รอบ 5", keyword: "#k", youtubeUrl: VIDEO });
    await ok("POST", `/draws/${d.id}/open`);
    delete process.env.YOUTUBE_API_KEY;
    try {
      await poll(d.id);
    } finally {
      process.env.YOUTUBE_API_KEY = "test-key";
    }
    assert.match((await ok("GET", `/draws/${d.id}`)).chatError, /YOUTUBE_API_KEY/);
  });
});

describe("entries from Discord and typed lists", () => {
  test("Discord joins once, only while open, and only if allowed", async () => {
    const d = await ok("POST", "/draws", { title: "ดิส", keyword: "#d" });
    const join = (n: number) => call("POST", `/draws/${d.id}/entries`, { source: "DISCORD", externalId: discord(n), name: `คน ${n}` });
    assert.equal((await join(1)).status, 409);
    await ok("POST", `/draws/${d.id}/open`);
    assert.equal((await join(1)).status, 201);
    const again = await join(1);
    assert.equal(again.status, 200);
    assert.equal(again.body.added, false);
    assert.equal((await call("POST", `/draws/${d.id}/entries`, { source: "DISCORD", externalId: "nope", name: "x" })).status, 400);
    await ok("POST", `/draws/${d.id}/close`);
    const late = await join(2);
    assert.equal(late.status, 409);
    assert.equal(late.body.details.th, "ปิดรับแล้ว");

    const ytOnly = await ok("POST", "/draws", { title: "YT only", keyword: "#y", allowDiscord: false });
    await ok("POST", `/draws/${ytOnly.id}/open`);
    assert.equal((await call("POST", `/draws/${ytOnly.id}/entries`, { source: "DISCORD", externalId: discord(3), name: "x" })).status, 409);
  });

  test("a pasted list adds each name once, any case", async () => {
    const d = await ok("POST", "/draws", { title: "วางรายชื่อ", keyword: "#l" });
    const r = await ok("POST", `/draws/${d.id}/entries`, { lines: "Alice\nbob\n\nALICE\n  Carol  " });
    assert.deepEqual(r, { added: 3, skipped: 1 });
    const detail = await ok("GET", `/draws/${d.id}`);
    const carol = detail.entries.find((e: { name: string }) => e.name === "Carol");
    await call("DELETE", `/draws/${d.id}/entries/${carol.id}`);
    assert.equal((await ok("GET", `/draws/${d.id}`)).entries.length, 2);
  });

  test("an open draw closes by itself when its time is up", async () => {
    const d = await ok("POST", "/draws", { title: "หมดเวลา", keyword: "#t", minutes: 1 });
    await ok("POST", `/draws/${d.id}/open`);
    await prisma.luckyDraw.update({ where: { id: d.id }, data: { closesAt: new Date(Date.now() - 1000) } });
    assert.equal((await ok("GET", `/draws/${d.id}/public`)).status, "CLOSED");
  });
});

describe("drawing winners", () => {
  test("draws distinct winners, closes entries first, and redraws after striking one out", async () => {
    const d = await ok("POST", "/draws", { title: "สุ่มจริง", keyword: "#w", winners: 3 });
    assert.equal((await call("POST", `/draws/${d.id}/draw`, {})).status, 409);
    await ok("POST", `/draws/${d.id}/open`);
    await ok("POST", `/draws/${d.id}/entries`, { lines: Array.from({ length: 10 }, (_, i) => `คนที่ ${i + 1}`).join("\n") });
    const first = (await ok("POST", `/draws/${d.id}/draw`, {})).data;
    assert.equal(first.length, 3);
    assert.deepEqual(first.map((w: { place: number }) => w.place), [1, 2, 3]);
    assert.equal(new Set(first.map((w: { id: string }) => w.id)).size, 3);
    assert.equal((await ok("GET", `/draws/${d.id}/public`)).status, "CLOSED");

    // Number 2 did not claim: struck out, kept on record, and one more is drawn among the rest.
    const voided = await ok("POST", `/draws/${d.id}/entries/${first[1].id}/void`, { voided: true });
    assert.equal(voided.voided, true);
    const redraw = (await ok("POST", `/draws/${d.id}/draw`, { count: 1 })).data;
    assert.equal(redraw.length, 1);
    assert.equal(redraw[0].place, 4);
    assert.ok(!first.some((w: { id: string }) => w.id === redraw[0].id));

    const pub = await call("GET", `/draws/${d.id}/public`, undefined, reader);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.count, 10);
    assert.deepEqual(pub.body.winnerList.map((w: { place: number; voided: boolean }) => [w.place, w.voided]), [[1, false], [2, true], [3, false], [4, false]]);
    // Nothing that identifies an entry in the public view.
    assert.ok(pub.body.winnerList.every((w: Record<string, unknown>) => !("externalId" in w) && !("id" in w)));

    // Everybody won: nothing left to draw.
    await ok("POST", `/draws/${d.id}/draw`, { count: 50 });
    const empty = await call("POST", `/draws/${d.id}/draw`, {});
    assert.equal(empty.status, 409);
    assert.equal(empty.body.details.th, "ไม่มีรายชื่อเหลือให้สุ่ม");
  });

  test("two presses at once never pick the same person twice", async () => {
    const d = await ok("POST", "/draws", { title: "กดรัว", keyword: "#r", winners: 1 });
    await ok("POST", `/draws/${d.id}/open`);
    await ok("POST", `/draws/${d.id}/entries`, { lines: "a\nb\nc" });
    const both = await Promise.all([ok("POST", `/draws/${d.id}/draw`, {}), ok("POST", `/draws/${d.id}/draw`, {})]);
    const ids = both.flatMap((b) => b.data.map((w: { id: string }) => w.id));
    assert.equal(new Set(ids).size, 2);
  });

  test("every name has the same chance", async () => {
    const d = await ok("POST", "/draws", { title: "ยุติธรรม", keyword: "#f" });
    await ok("POST", `/draws/${d.id}/open`);
    await ok("POST", `/draws/${d.id}/entries`, { lines: "a\nb\nc\nd" });
    const wins: Record<string, number> = {};
    for (let i = 0; i < 200; i++) {
      const [w] = (await ok("POST", `/draws/${d.id}/draw`, {})).data;
      wins[w.name] = (wins[w.name] ?? 0) + 1;
      await prisma.drawEntry.updateMany({ where: { drawId: d.id }, data: { place: null, wonAt: null } });
    }
    for (const name of ["a", "b", "c", "d"]) assert.ok(wins[name] > 25 && wins[name] < 75, JSON.stringify(wins));
  });

  test("only the organizer manages draws; anyone with a key sees the public view", async () => {
    const d = await ok("POST", "/draws", { title: "สิทธิ์", keyword: "#p" });
    for (const [m, u] of [["GET", "/draws"], ["POST", "/draws"], ["GET", `/draws/${d.id}`], ["POST", `/draws/${d.id}/open`], ["POST", `/draws/${d.id}/draw`], ["DELETE", `/draws/${d.id}`]])
      assert.equal((await call(m, u, m === "GET" || m === "DELETE" ? undefined : {}, reader)).status, 403, `${m} ${u}`);
    assert.equal((await call("GET", "/draws/active", undefined, reader)).status, 200);
    await ok("DELETE", `/draws/${d.id}`);
    assert.equal((await call("GET", `/draws/${d.id}/public`)).status, 404);
  });
});

describe("extra chances", () => {
  test("channel members and Discord accounts linked to the website get the set number of chances", async () => {
    const d = await ok("POST", "/draws", { title: "ตัวคูณ", keyword: "#x", youtubeUrl: VIDEO, memberWeight: 10, linkedWeight: 3 });
    assert.equal(d.memberWeight, 10);
    await ok("POST", `/draws/${d.id}/open`);
    chatPages = [{ items: [msg("UCmember", "#x", { isChatSponsor: true }), msg("UCplain", "#x")] }];
    await poll(d.id);
    const linkedId = discord(900);
    await prisma.player.create({ data: { name: "Linked One", discordId: linkedId } });
    await ok("POST", `/draws/${d.id}/entries`, { source: "DISCORD", externalId: linkedId, name: "Linked One" });
    await ok("POST", `/draws/${d.id}/entries`, { source: "DISCORD", externalId: discord(901), name: "Not Linked" });
    const detail = await ok("GET", `/draws/${d.id}`);
    const by = (n: string) => detail.entries.find((e: { name: string }) => e.name === n);
    assert.equal(by("ช่อง UCmember").member, true);
    assert.equal(by("ช่อง UCplain").member, false);
    assert.equal(by("Linked One").linked, true);
    assert.equal(by("Not Linked").linked, false);
    const pub = await ok("GET", `/draws/${d.id}/public`);
    assert.deepEqual([pub.memberWeight, pub.linkedWeight], [10, 3]);

    // 10 : 1 : 3 : 1 chances, so out of 450 draws the member wins about 300 times.
    const wins: Record<string, number> = {};
    for (let i = 0; i < 450; i++) {
      const [w] = (await ok("POST", `/draws/${d.id}/draw`, { count: 1 })).data;
      wins[w.name] = (wins[w.name] ?? 0) + 1;
      await prisma.drawEntry.updateMany({ where: { drawId: d.id }, data: { place: null, wonAt: null } });
    }
    const share = (n: string) => (wins[n] ?? 0) / 450;
    assert.ok(share("ช่อง UCmember") > 0.55 && share("ช่อง UCmember") < 0.78, JSON.stringify(wins));
    assert.ok(share("Linked One") > 0.1 && share("Linked One") < 0.3, JSON.stringify(wins));
    assert.ok(share("ช่อง UCplain") < 0.15 && share("Not Linked") < 0.15, JSON.stringify(wins));

    // Back to x1: everyone equal again.
    await ok("PATCH", `/draws/${d.id}`, { memberWeight: 1, linkedWeight: 1 });
    assert.equal((await call("PATCH", `/draws/${d.id}`, { memberWeight: 11 })).status, 400);
  });
});

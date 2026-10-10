import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

// A stand-in for the Claude API so the request shape and response handling can be checked offline.
let lastRequest: { headers: http.IncomingHttpHeaders; body: any } | undefined;
let reply: { status: number; body: unknown } = { status: 200, body: {} };
const server = http.createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    lastRequest = { headers: req.headers, body: JSON.parse(data) };
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
});

const image = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tr-extract-")), "shot.png");
fs.writeFileSync(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

let extract: typeof import("./lib/extract.js");
before(async () => {
  server.listen(0);
  await new Promise((r) => server.once("listening", r));
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  extract = await import("./lib/extract.js");
});
after(() => server.close());

const message = (text: string, stop_reason = "end_turn") => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text }],
  stop_reason,
  usage: { input_tokens: 1, output_tokens: 1 },
});

const read = (images = [{ file: image, mediaType: "image/png" }]) =>
  extract.extractSeries(images, "WD 2-0 Late", { teams: [{ name: "WD", players: ["Dunken", "Chipi01"] }, { name: "Empty", players: [] }] });

test("sends every screenshot and the post text with structured output, and parses the result", async () => {
  const result = {
    teamA: "WD", teamB: "Late", seriesScoreA: 2, seriesScoreB: 0,
    games: [{ allyScore: 26, rivalScore: 13, result: "WIN", players: [{ name: "Dunken", side: "ally", rating: 16.9, award: "none", pts: 0, reb: 9, blk: 2, stl: 0, ast: 3, lbr: 1 }] }],
    notes: "",
  };
  reply = { status: 200, body: message(JSON.stringify(result)) };
  const out = await read([{ file: image, mediaType: "image/png" }, { file: image, mediaType: "image/png" }]);
  assert.equal(out.games[0].players[0].award, null, "\"none\" becomes null");
  assert.equal(out.games[0].players[0].rating, 16.9);
  const body = lastRequest!.body;
  assert.equal(body.model, "claude-haiku-5-5", "the lowest-cost model unless .env says otherwise");
  assert.equal(body.fallbacks, undefined, "Haiku has no server-side fallback");
  assert.doesNotMatch(String(lastRequest!.headers["anthropic-beta"] ?? ""), /server-side-fallback/);
  assert.equal(body.output_config.format.type, "json_schema");
  const content = body.messages[0].content;
  assert.deepEqual(content.map((c: any) => c.type), ["text", "image", "text", "image", "text"], "images labelled in order");
  assert.equal(content[1].source.media_type, "image/png");
  const prompt = content.at(-1).text;
  assert.match(prompt, /WD 2-0 Late/);
  assert.match(prompt, /- WD: Dunken, Chipi01/);
  assert.doesNotMatch(prompt, /- Empty/, "teams without players are left out");
});

test("ANTHROPIC_MODEL picks another model; Opus asks for the server-side fallback", async () => {
  const result = { teamA: "WD", teamB: "Late", seriesScoreA: 2, seriesScoreB: 0, games: [], notes: "" };
  reply = { status: 200, body: message(JSON.stringify(result)) };
  process.env.ANTHROPIC_MODEL = "claude-opus-5-5";
  try {
    await read();
  } finally {
    delete process.env.ANTHROPIC_MODEL;
  }
  assert.equal(lastRequest!.body.model, "claude-opus-5-5");
  assert.equal(lastRequest!.body.fallbacks, "default");
  assert.match(String(lastRequest!.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
});

test("a refusal becomes a friendly 422", async () => {
  reply = { status: 200, body: message("", "refusal") };
  await assert.rejects(read(), (e: any) => e.status === 422);
});

test("an unexpected shape becomes a 502", async () => {
  reply = { status: 200, body: message(JSON.stringify({ hello: "world" })) };
  await assert.rejects(read(), (e: any) => e.status === 502);
});

test("invalid JSON and upstream errors become a 502", async () => {
  reply = { status: 200, body: message("not json") };
  await assert.rejects(read(), (e: any) => e.status === 502);
  reply = { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "bad" } } };
  await assert.rejects(read(), (e: any) => e.status === 502);
});

test("without an API key the feature reports itself disabled", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(extract.extractionEnabled(), false);
  } finally {
    process.env.ANTHROPIC_API_KEY = saved;
  }
});

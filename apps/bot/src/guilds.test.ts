/** Which Discord servers may use the bot. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TrustedGuilds } from "./guilds.js";

test("the servers from the first start are remembered; one added later is not trusted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tr-guilds-"));
  const file = path.join(dir, "guilds.json");
  const first = new TrustedGuilds(file, "");
  assert.equal(first.has("1"), false, "nothing is trusted before the list is loaded");
  first.load(["1", "2"]);
  assert.ok(first.has("1") && first.has("2"));
  // Restarted after a stranger added the bot to server 3.
  const later = new TrustedGuilds(file, "");
  later.load(["1", "2", "3"]);
  assert.equal(later.has("3"), false);
  assert.equal(later.has(null), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("DISCORD_GUILD_IDS decides when it is set", () => {
  const g = new TrustedGuilds(path.join(os.tmpdir(), "never-written.json"), " 7, 8 ");
  g.load(["1"]);
  assert.deepEqual([g.has("7"), g.has("8"), g.has("1")], [true, true, false]);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  checkDiscordMembership,
  decodePendingDiscord,
  encodePendingDiscord,
} from "../lib/discordMembership";

const identity = {
  id: "424242424242424242",
  name: "Player",
  avatar: null,
  next: "/me",
  guildId: "123456789012345678",
};
const options = {
  guildId: identity.guildId,
  botToken: "test-only-token",
  apiUrl: "https://discord.test/api",
};
const response = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test("pending Discord identity is signed, expires, and cannot be edited or replayed as a member session", () => {
  const cookie = encodePendingDiscord(identity, "test-secret", 1000);
  assert.equal(
    decodePendingDiscord(cookie, "test-secret", 2000)?.id,
    identity.id,
  );
  assert.equal(decodePendingDiscord(cookie, "wrong-secret", 2000), null);
  assert.equal(decodePendingDiscord(cookie, "test-secret", 601001), null);
  const [payload, sig] = cookie.split(".");
  const changed = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(payload, "base64url").toString()),
      id: "999999999999999999",
    }),
  ).toString("base64url");
  assert.equal(
    decodePendingDiscord(`${changed}.${sig}`, "test-secret", 2000),
    null,
  );
  assert.equal(
    decodePendingDiscord(`${cookie}.extra`, "test-secret", 2000),
    null,
  );
  assert.equal(decodePendingDiscord(undefined, "test-secret", 2000), null);
});

test("membership is verified against the required guild and authenticated Discord identity", async () => {
  const fetcher = (async (url, init) => {
    assert.equal(
      url,
      `https://discord.test/api/guilds/${identity.guildId}/members/${identity.id}`,
    );
    assert.deepEqual(init?.headers, { Authorization: "Bot test-only-token" });
    assert.equal(init?.cache, "no-store");
    return new Response(
      JSON.stringify({ user: { id: identity.id }, pending: false }),
    );
  }) as typeof fetch;
  assert.equal(
    await checkDiscordMembership(identity.id, options, fetcher),
    true,
  );
  assert.equal(
    await checkDiscordMembership(
      identity.id,
      options,
      response(404, { code: 10007 }),
    ),
    false,
  );
  assert.equal(
    await checkDiscordMembership(
      identity.id,
      options,
      response(200, { user: { id: identity.id }, pending: true }),
    ),
    false,
  );
});

test("bad credentials, unknown guild, rate limits, outages and mismatched identity fail closed", async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    await assert.rejects(
      checkDiscordMembership(
        identity.id,
        options,
        response(status, { code: 10004 }),
      ),
    );
  }
  await assert.rejects(
    checkDiscordMembership(
      identity.id,
      options,
      response(200, { user: { id: "999999999999999999" } }),
    ),
  );
  await assert.rejects(
    checkDiscordMembership(identity.id, options, (async () => {
      throw new Error("network unavailable");
    }) as typeof fetch),
  );
  await assert.rejects(
    checkDiscordMembership(
      identity.id,
      { ...options, guildId: "" },
      response(200, {}),
    ),
  );
});

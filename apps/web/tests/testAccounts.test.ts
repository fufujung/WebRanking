import test from "node:test";
import assert from "node:assert/strict";
import { findTestAccount, testAccounts, testLoginEnabled } from "../lib/testAccounts";

test("developer accounts are distinct and reject unknown identities", () => {
  assert.equal(new Set(testAccounts.map((account) => account.id)).size, testAccounts.length);
  assert.equal(testAccounts.length, 24);
  const ranks = new Map<string, number>();
  for (const account of testAccounts) ranks.set(account.rank, (ranks.get(account.rank) ?? 0) + 1);
  assert.deepEqual([...ranks.values()], [6, 6, 6, 6]);
  assert.equal(new Set(testAccounts.map((account) => account.playerId)).size, 24);
  assert.equal(findTestAccount(testAccounts[1].id)?.name, "Client 02");
  assert.equal(findTestAccount("another-user"), undefined);
  assert.equal(findTestAccount(null), undefined);
});

test("test login is available only with development opt-in on localhost", () => {
  const dev: NodeJS.ProcessEnv = { NODE_ENV: "development", TEST_LOGIN_ENABLED: "1" };
  assert.equal(testLoginEnabled("localhost:3000", dev), true);
  assert.equal(testLoginEnabled("127.0.0.1:3000", dev), true);
  assert.equal(testLoginEnabled("example.com", dev), false);
  assert.equal(testLoginEnabled("localhost.example.com", dev), false);
  assert.equal(testLoginEnabled("localhost:3000", { ...dev, NODE_ENV: "production" }), false);
  assert.equal(testLoginEnabled("localhost:3000", { ...dev, TEST_LOGIN_ENABLED: "0" }), false);
});

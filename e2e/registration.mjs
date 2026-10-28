/** Isolated browser checks: no development database, real Discord or production credentials. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), "..");
const secret = "isolated-registration-browser-fixture";
const users = { captain: "880000000000000001", mate: "880000000000000002" };

if (process.argv[2] === "--fixture-api") {
  const { createApp } = await import("../apps/api/src/app.ts");
  const { prisma } = await import("../apps/api/src/lib/db.ts");
  const { createApiKey } = await import("../apps/api/src/lib/apiKeys.ts");
  const game = await prisma.game.create({ data: { name: "Browser Basketball", ranks: JSON.stringify([{ name: "Gold", iconUrl: null }, { name: "Silver", iconUrl: null }]) } });
  const captain = await prisma.player.create({ data: { name: "Browser Captain", uid: "881001", discordId: users.captain, gameId: game.id } });
  const mate = await prisma.player.create({ data: { name: "Browser Mate", uid: "881002", discordId: users.mate, gameId: game.id } });
  const cup = (name, extra = {}) => prisma.tournament.create({ data: { name, gameId: game.id, game: game.name, startDate: new Date(), registrationOpen: true, rosterMin: 2, rosterMax: 3, ...extra } });
  const normal = await cup("Normal Browser Cup");
  const special = await cup("Special Browser Cup", { special: true });
  const solo = await cup("Solo Browser Cup", { entryMode: "SOLO", teamSize: 2 });
  const otherGame = await prisma.game.create({ data: { name: "Browser Other Game" } });
  const other = await prisma.tournament.create({ data: { name: "Other Browser Cup", gameId: otherGame.id, game: otherGame.name, startDate: new Date(), registrationOpen: true } });
  for (let i = 0; i < 3; i++) {
    for (const isSpecial of [false, true]) await prisma.tournament.create({ data: { name: `Extra ${isSpecial ? "Special" : "Normal"} ${i}`, gameId: otherGame.id, game: otherGame.name, special: isSpecial, startDate: new Date(), registrationOpen: true } });
  }
  await prisma.tournament.create({ data: { name: "Extra Special 3", gameId: otherGame.id, game: otherGame.name, special: true, startDate: new Date(), registrationOpen: true } });
  const teamA = await prisma.team.create({ data: { name: "Browser Fixture Team A", gameId: game.id } });
  const teamB = await prisma.team.create({ data: { name: "Browser Fixture Team B", gameId: game.id } });
  await prisma.match.create({ data: { tournamentId: normal.id, teamAId: teamA.id, teamBId: teamB.id, scoreA: 1, scoreB: 0 } });
  await prisma.match.create({ data: { tournamentId: other.id, teamAId: teamA.id, teamBId: teamB.id, scoreA: 2, scoreB: 0 } });
  for (let i = 0; i < 3; i++) await prisma.match.create({ data: { tournamentId: other.id, teamAId: teamA.id, teamBId: teamB.id, scoreA: 3, scoreB: 0 } });
  const key = (await createApiKey("isolated browser", "admin")).key;
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  fs.writeFileSync(path.join(process.argv[3], "fixture.json"), JSON.stringify({ api: `http://127.0.0.1:${server.address().port}`, key, game, otherGame, captain, mate, normal, special, solo, other }));
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-registration-browser-"));
  const out = path.join(root, "e2e/screenshots");
  fs.mkdirSync(out, { recursive: true });
  const db = path.join(tmp, "test.db");
  fs.writeFileSync(db, "");
  const env = { ...process.env, DATABASE_URL: `file:${db.replaceAll("\\", "/")}`, UPLOAD_DIR: path.join(tmp, "uploads"), SESSION_SECRET: secret, ADMIN_PASSWORD: "isolated-test-password", ADMIN_PATH: "admin-registration-fixture", DISCORD_REQUIRED_GUILD_ID: "", DISCORD_MEMBERSHIP_BOT_TOKEN: "", DISCORD_CLIENT_ID: "", DISCORD_CLIENT_SECRET: "", DISCORD_WEBHOOK_URL: "", ANTHROPIC_API_KEY: "", COOKIE_SECURE: "false" };
  execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "db", "push", "--schema", path.join(root, "apps/api/prisma/schema.prisma"), "--skip-generate"], { cwd: root, env, stdio: "pipe" });
  const children = [];
  let browser;
  const logs = [];
  const child = (args, childEnv, cwd = root) => {
    const p = spawn(process.execPath, args, { cwd, env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    children.push(p);
    p.stdout.on("data", (v) => logs.push(String(v)));
    p.stderr.on("data", (v) => logs.push(String(v)));
    return p;
  };
  try {
    child(["--import", "tsx", self, "--fixture-api", tmp], env);
    const fixtureFile = path.join(tmp, "fixture.json");
    for (let i = 0; i < 100 && !fs.existsSync(fixtureFile); i++) await new Promise((r) => setTimeout(r, 100));
    const f = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
    const socket = net.createServer().listen(0, "127.0.0.1"); await once(socket, "listening");
    const port = socket.address().port; await new Promise((r) => socket.close(r));
    const base = `http://127.0.0.1:${port}`;
    child([path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], { ...env, API_URL: f.api, API_KEY: f.key, PUBLIC_SITE_URL: base, NEXT_DIST_DIR: ".next" }, path.join(root, "apps/web"));
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const errors = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(base);
    assert.deepEqual(await page.locator(".home-figma > section").evaluateAll((nodes) => nodes.map((n) => n.id)), ["special", "tournaments", "results"]);
    assert.equal(await page.locator(".home-community").count(), 0);
    await page.locator('#special a[href="/special"]').waitFor();
    await page.screenshot({ path: path.join(out, "registration-home-desktop.png"), fullPage: true });
    // Hold RSC responses so pending UI is observable, rather than timing a fast server.
    await page.route(`**/*game=${f.otherGame.id}*`, async (route) => {
      if (route.request().headers()["rsc"]) await new Promise((resolve) => setTimeout(resolve, 700));
      try { await route.continue(); } catch (error) {
        if (!String(error).includes("Route is already handled")) throw error;
      }
    });
    const gameFilter = page.getByRole("button", { name: "กรองรายการตามเกม" });
    await gameFilter.click();
    await page.getByRole("option", { name: f.otherGame.name }).click();
    await page.locator('.navigation-content > .page-skeleton').waitFor({ state: "visible" });
    assert.equal(await page.locator(".tr-header").isVisible(), true);
    await page.screenshot({ path: path.join(out, "loading-desktop.png") });
    await page.waitForURL(base + `/?game=${f.otherGame.id}`);
    await gameFilter.getByText(f.otherGame.name).waitFor();
    await page.locator(`#tournaments a[href='/tournaments/${f.other.id}']`).waitFor();
    assert.equal(await page.locator(`#tournaments a[href='/tournaments/${f.normal.id}']`).count(), 0);
    assert.equal(await page.locator(`#special a[href='/tournaments/${f.special.id}']`).count(), 0);
    assert.match(await page.locator("#results").innerText(), /Other Browser Cup/);
    assert.doesNotMatch(await page.locator("#results").innerText(), /Normal Browser Cup/);
    for (const id of ["special", "tournaments", "results"]) {
      const section = page.locator(`#${id}`);
      const track = section.locator(".home-carousel-track");
      assert.equal(await track.locator(":scope > *").count(), 4);
      await section.getByRole("button", { name: /ไปถัดไป/ }).click();
      await page.waitForFunction((element) => element.scrollLeft > 0, await track.elementHandle());
      await page.waitForFunction((element) => !element.disabled, await section.getByRole("button", { name: /ไปก่อนหน้า/ }).elementHandle());
    }
    await page.reload();
    await gameFilter.getByText(f.otherGame.name).waitFor();
    await gameFilter.click();
    await page.getByRole("option", { name: f.game.name }).click();
    await page.waitForURL(base + `/?game=${f.game.id}`);
    await page.locator(`#special a[href='/tournaments/${f.special.id}']`).waitFor();
    assert.equal(await page.locator(`#tournaments a[href='/tournaments/${f.other.id}']`).count(), 0);
    assert.match(await page.locator("#results").innerText(), /Normal Browser Cup/);
    await gameFilter.click();
    await page.getByRole("option", { name: "ทุกเกม" }).click();
    await page.waitForURL(base + "/");
    await page.locator(`#tournaments a[href='/tournaments/${f.other.id}']`).waitFor();
    await page.locator(`#tournaments a[href='/tournaments/${f.normal.id}']`).waitFor();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    console.log("PASS Navigation skeleton is visible during a delayed query change and clears after loading");
    console.log("PASS Home game selection filters special/normal tournaments and recent matches, persists on reload and resets");
    await page.locator(".header-search input").waitFor({ state: "visible" });
    await page.locator(".header-search input").fill("Normal Browser");
    await page.locator(".header-search input").press("Enter");
    await page.waitForURL(/\/search\?/);
    await page.getByRole("link", { name: /Normal Browser Cup/ }).waitFor();
    await page.goto(base + "/search?q=Browser%20Basketball");
    await page.getByText("ไม่พบผลลัพธ์", { exact: false }).waitFor();
    await page.goto(base + "/tournaments");
    await page.locator("#community-overview").waitFor();
    assert.equal(await page.locator(`.tournament-card[href='/tournaments/${f.special.id}']`).count(), 0);
    await page.goto(base + `/predict?t=${f.normal.id}`);
    await page.getByText("รายการที่เลือกยังไม่มีตลาดทำนายผล", { exact: false }).waitFor();
    const login = async (ctx, id) => {
      const payload = Buffer.from(JSON.stringify({ id, name: id === users.captain ? "Browser Captain" : "Browser Mate", avatar: null, exp: Date.now() + 3600000 })).toString("base64url");
      const sig = createHmac("sha256", `member:${secret}`).update(payload).digest("base64url");
      await ctx.addCookies([{ name: "tr_member", value: `${payload}.${sig}`, url: base, httpOnly: true, sameSite: "Lax" }]);
    };
    await login(context, users.captain);
    await page.goto(base + `/tournaments/${f.solo.id}`);
    await page.locator(".tournament-join-action").getByRole("link", { name: "กรอกข้อมูลผู้เล่น" }).click();
    await page.waitForURL(/\/me\/player/);
    const profile = page.locator("form").filter({ has: page.locator('input[name="playerId"]') }).first();
    await profile.locator('select[name="position"]').selectOption("GUARD");
    await profile.locator('select[name="inGameRank"]').selectOption("Gold");
    await profile.getByRole("button", { name: "บันทึกและกลับ" }).click();
    await page.waitForURL(base + `/tournaments/${f.solo.id}`);
    await page.locator(".tournament-join-action").getByRole("button", { name: "Join Tournament", exact: true }).click();
    await page.locator(".tournament-join-action .success").waitFor();
    await page.reload(); await page.locator(".tournament-join-action .success").waitFor();
    await page.locator(".tournament-join-action").getByRole("button", { name: "ถอนชื่อ", exact: true }).click();
    await page.locator(".tournament-join-action").getByRole("button", { name: "Join Tournament", exact: true }).waitFor();
    console.log("PASS Solo: setup redirect, saved profile, one-click join, reload and withdrawal");
    await page.goto(base + `/tournaments/${f.normal.id}`);
    await page.locator(".tournament-join-action").getByRole("link", { name: "สร้างทีม", exact: true }).click();
    await page.waitForURL(/\/teams\/new/);
    await page.getByRole("heading", { name: "สร้างทีม", exact: true }).waitFor();
    await page.locator('input[name="name"]').fill("Browser Existing Team");
    await page.getByRole("button", { name: "สร้างทีม", exact: true }).click();
    await page.waitForURL(base + `/tournaments/${f.normal.id}`);
    await page.getByText("ทีมยังขาดอีก 1 คน", { exact: false }).waitFor();
    const invite = await page.getByRole("textbox", { name: "ลิงก์เชิญเข้าทีม", exact: true }).inputValue();
    const mateCtx = await browser.newContext(); await login(mateCtx, users.mate);
    const mate = await mateCtx.newPage(); await mate.goto(base + invite);
    await mate.getByRole("button", { name: /เข้าร่วมทีม/ }).click();
    await mate.waitForURL(/\/me/);
    await mate.goto(base + `/tournaments/${f.normal.id}`);
    await mate.getByText("ให้หัวหน้าทีมกด Join Tournament", { exact: false }).waitFor();
    await page.reload();
    await page.locator(".tournament-join-action .join-team-summary").waitFor();
    await page.screenshot({ path: path.join(out, "registration-team-desktop.png"), fullPage: true });
    await page.locator(".tournament-join-action").getByRole("button", { name: "Join Tournament", exact: true }).click();
    await page.locator(".tournament-join-action .success").waitFor(); await page.reload(); await page.locator(".tournament-join-action .success").waitFor();
    await page.getByRole("navigation", { name: "หัวข้อทัวร์นาเมนต์" }).getByRole("link", { name: "ทำนายผล", exact: true }).click();
    await page.waitForURL(base + `/predict?t=${f.normal.id}`);
    console.log("PASS Team: create and return, roster shortage, invite, captain-only join and persisted success");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    await page.screenshot({ path: path.join(out, "registration-home-mobile.png"), fullPage: true });
    await page.goto(base + `/tournaments/${f.normal.id}`);
    await page.locator(".tournament-join-action .success").waitFor();
    await page.screenshot({ path: path.join(out, "registration-team-mobile.png"), fullPage: true });
    for (const route of ["/", "/tournaments", `/tournaments/${f.normal.id}`, "/teams/new", "/me/player"]) {
      await page.goto(base + route);
      await page.locator("main h1").first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `mobile overflow: ${route}`);
    }
    await page.goto(base);
    await page.locator(".header-search input").focus();
    await page.waitForFunction(() => document.activeElement === document.querySelector(".header-search input"));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "ค้นหา", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log("PASS Home, category lists, tournament-only search, prediction links, mobile overflow and keyboard search");
  } catch (e) {
    fs.writeFileSync(path.join(out, "registration-server.log"), logs.join(""));
    throw e;
  } finally {
    await browser?.close();
    for (const p of children) { if (p.exitCode === null) { const ended = once(p, "exit"); p.kill(); await ended; } }
    if (path.dirname(tmp) !== os.tmpdir() || !path.basename(tmp).startsWith("tr-registration-browser-")) throw Error("Unexpected fixture path");
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  }
}

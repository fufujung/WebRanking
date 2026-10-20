// End-to-end check of the website in a real browser.
// Needs the API and website running with demo data (npm run setup && npm run dev), then: npm run test:e2e
// Env: BASE_URL (default http://localhost:3000), API_URL (default http://localhost:4000),
//      ADMIN_PASSWORD (default: read from apps/web/.env.local), CHROMIUM_PATH (optional browser binary).
// "Log in with Discord" is tested against a stand-in Discord on DISCORD_MOCK_PORT (default 4999) when the website
// runs with DISCORD_CLIENT_ID=e2e DISCORD_CLIENT_SECRET=e2e-secret DISCORD_API_URL=http://localhost:4999/api
// DISCORD_AUTHORIZE_URL=http://localhost:4999/oauth2/authorize (CI does this); otherwise that part is skipped.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webEnv = path.join(here, "../apps/web/.env.local");
const envFile = fs.existsSync(webEnv) ? fs.readFileSync(webEnv, "utf8") : "";
const fromEnvFile = (k) => new RegExp(`^${k}=(.*)$`, "m").exec(envFile)?.[1]?.trim();

const base = process.env.BASE_URL ?? "http://localhost:3000";
const API = process.env.API_URL ?? fromEnvFile("API_URL") ?? "http://localhost:4000";
const PASSWORD = process.env.ADMIN_PASSWORD ?? fromEnvFile("ADMIN_PASSWORD");
// Secret login address; empty = the old /admin/login page.
const ADMIN_PATH = process.env.ADMIN_PATH ?? fromEnvFile("ADMIN_PATH") ?? "";
const LOGIN = ADMIN_PATH ? `/${ADMIN_PATH}` : "/admin/login";
const LOGO = path.join(here, "fixture-logo.png");
const SHOT = path.join(here, "fixture-result.png");
const SELF = fileURLToPath(import.meta.url);
const OUT = path.join(here, "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const problems = [];
// The browser logs a failed request it was told to expect (the free reader refusing a non-scoreboard picture).
let expectedRejection = null;
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message} @ ${page.url()}`));
page.on("console", (m) => {
  if (m.type() !== "error" || page.url().includes("does-not-exist")) return;
  if (expectedRejection && m.text().includes(expectedRejection)) return;
  problems.push(`console: ${m.text()} @ ${page.url()}`);
});
page.on("response", (r) => {
  if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
});
const step = (s) => console.log("✓", s);

// Stand-in for Discord's OAuth: approves at once and says the visitor is "E2E Discord".
const DISCORD_USER = { id: "424242424242424242", username: "e2e_discord", global_name: "E2E Discord", avatar: null };
// A teammate who joins through an invite link; the stand-in answers as whoever is set here.
const TEAMMATE = { id: "434343434343434343", username: "e2e_mate", global_name: "E2E Mate", avatar: null };
let discordUser = DISCORD_USER;
const discordMock = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let body = "";
  for await (const chunk of req) body += chunk;
  const json = (status, data) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  if (url.pathname === "/oauth2/authorize") {
    if (url.searchParams.get("scope") !== "identify" || !url.searchParams.get("state")) return json(400, { error: "bad authorize request" });
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "e2e-code");
    back.searchParams.set("state", url.searchParams.get("state"));
    return res.writeHead(302, { Location: back.toString() }).end();
  }
  if (url.pathname === "/api/oauth2/token" && req.method === "POST") {
    const form = new URLSearchParams(body);
    if (form.get("code") !== "e2e-code" || form.get("client_secret") !== "e2e-secret" || !form.get("redirect_uri")?.endsWith("/api/auth/discord/callback")) return json(401, { error: "invalid_grant" });
    return json(200, { access_token: "e2e-token", token_type: "Bearer" });
  }
  if (url.pathname === "/api/users/@me") {
    return req.headers.authorization === "Bearer e2e-token" ? json(200, discordUser) : json(401, { message: "401: Unauthorized" });
  }
  json(404, { message: "not found" });
});
await new Promise((r) => discordMock.listen(Number(process.env.DISCORD_MOCK_PORT ?? 4999), r));
const uniq = Date.now().toString().slice(-5);

console.log("— Public pages");
const paths = ["/", "/guilds", "/special", "/blacklist", "/rankings", "/rankings?min=1", "/rankings/players", "/rankings/players?sort=ppg", "/rankings/stats", "/teams", "/players", "/tournaments", "/tournaments?status=ONGOING", "/matches", "/search?q=tiger", "/search", LOGIN];
for (const p of paths) {
  await page.goto(base + p);
  await page.waitForLoadState("networkidle");
  const h1 = await page.locator("h1").first().textContent();
  console.log(p, "→", h1);
}
await page.goto(base + "/");
if (await page.locator('footer a[href$="/docs"]').count()) throw new Error("visitors see the API docs link");
await page.locator("h2:has-text('กิลด์อันดับ 1')").waitFor();
await page.screenshot({ path: OUT + "/home.png", fullPage: true });
// follow a team, player, tournament, match link
for (const sel of ['a[href^="/teams/"]', 'a[href^="/tournaments/"]', 'a[href^="/matches/"]']) {
  await page.goto(base + "/");
  await page.locator(sel).first().click();
  await page.waitForLoadState("networkidle");
  console.log("detail", page.url(), "→", await page.locator("h1").first().textContent().catch(() => "(no h1)"));
  await page.screenshot({ path: OUT + `/detail-${sel.split("/")[1]}.png`, fullPage: true });
}
await page.goto(base + "/rankings/players");
await page.locator('a[href^="/players/"]').first().click();
await page.waitForLoadState("networkidle");
console.log("player", page.url(), await page.locator("h1").first().textContent());
await page.screenshot({ path: OUT + "/player.png", fullPage: true });

// team dropdown filter on players page
await page.goto(base + "/players");
const combo = page.getByRole("combobox");
await combo.click();
await combo.fill("sia");
const opts = await page.getByRole("option").allTextContents();
console.log("dropdown options for 'sia':", opts);
await page.getByRole("option").first().click();
await page.waitForURL(/teamId=/);
await page.waitForLoadState("networkidle");
console.log("filtered rows:", await page.locator("tbody tr").count(), page.url());
await page.screenshot({ path: OUT + "/players-filter.png", fullPage: true });

// header search with button
await page.locator('header input[name="q"]').fill("Ace");
await page.locator("header button", { hasText: "ค้นหา" }).click();
await page.waitForURL(/search\?q=Ace/);
console.log("search results text:", (await page.locator("main").textContent()).slice(0, 120));

await page.goto(base + "/teams/does-not-exist");
console.log("404 page:", await page.locator("h1").first().textContent());

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + "/rankings");
await page.screenshot({ path: OUT + "/mobile-rankings.png", fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log("mobile horizontal overflow:", overflow);
if (overflow) throw new Error("/rankings is wider than a phone screen");

// Phone header: the menu folds behind ☰ and closes after moving to another page; no page is wider than the screen.
if (await page.locator(".header .nav").isVisible()) throw new Error("menu should be folded away on a phone");
await page.click('button[aria-label="เปิดเมนู"]');
await page.locator('.header .nav a[href="/tournaments"]').click();
await page.waitForURL(/\/tournaments$/);
await page.waitForFunction(() => !document.querySelector(".header")?.dataset.open);
if (await page.locator(".header .nav").isVisible()) throw new Error("menu stayed open after navigating");
await page.click('button[aria-label="ค้นหา"]');
if (!(await page.locator(".header-search input").isVisible())) throw new Error("search box did not open on a phone");
for (const href of ["/", "/teams", "/matches", "/special", "/blacklist", "/predict"]) {
  await page.goto(base + href);
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`${href} is wider than a phone screen`);
}
step("phone: menu and search fold behind buttons, menu closes after navigating, pages fit the screen");

// Dark is the default; the toggle switches to light and the choice survives a reload.
const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
if ((await bodyBg()) !== "rgb(13, 13, 15)") throw new Error("dark theme is not the default");
await page.click(".theme-toggle");
await page.reload();
if ((await bodyBg()) !== "rgb(255, 255, 255)") throw new Error("light theme not kept after reload");
await page.click(".theme-toggle");
await page.reload();
if ((await bodyBg()) !== "rgb(13, 13, 15)") throw new Error("could not switch back to dark");
step("theme toggle: dark by default, light kept after reload, back to dark");


console.log("— Admin flows");
await page.setViewportSize({ width: 1280, height: 900 });
// Logged-out protection
if (await page.locator('.nav a[href="/admin"]').count()) throw new Error("public menu shows the admin link to visitors");
if (ADMIN_PATH) {
  // Without the secret address the back office looks like it does not exist.
  for (const p of ["/admin", "/admin/login", "/admin/teams", "/admin-wrong-guess"]) {
    const r = await page.request.get(base + p, { maxRedirects: 0 });
    if (r.status() !== 404) throw new Error(`${p} should be "not found" when logged out, got ${r.status()}`);
  }
  await page.goto(base + LOGIN);
  step("back office hidden: /admin is 404 and the login page only opens at the secret address");
} else {
  await page.goto(base + "/admin");
  if (!page.url().includes("/admin/login")) throw new Error("admin not protected");
}
const upl = await page.request.post(base + "/api/upload", { multipart: { image: { name: "a.png", mimeType: "image/png", buffer: fs.readFileSync(LOGO) } } });
if (upl.status() !== 401) throw new Error("upload not protected: " + upl.status());
step("admin pages and upload are protected when logged out");

await page.fill('input[name="password"]', "wrong");
await page.click("button:has-text('เข้าสู่ระบบ')");
await page.waitForSelector(".error");
step("wrong password rejected: " + (await page.textContent(".error")));
await page.fill('input[name="password"]', PASSWORD);
await page.click("button:has-text('เข้าสู่ระบบ')");
await page.waitForURL(base + "/admin");
if (!(await page.locator('.nav a[href="/admin"]').count())) throw new Error("admin link missing from the menu after login");
if (!(await page.locator('footer a[href$="/docs"]').count())) throw new Error("API docs link missing for the organizer");
step("logged in; the API docs link shows only to organizers");

// Tournament
await page.goto(base + "/admin/tournaments/new");
await page.fill('input[name="name"]', `E2E Cup ${uniq}`);
// The demo data has one game, which a new tournament takes by default.
if ((await page.locator('select[name="gameId"]').inputValue()) === "") throw new Error("the only game is not picked for a new tournament");
await page.fill('input[name="startDate"]', "2026-10-01T19:00");
await page.fill('input[name="endDate"]', "2026-09-01");
await page.click("button:has-text('สร้างทัวร์นาเมนต์')");
await page.waitForSelector(".error");
step("end-before-start rejected: " + (await page.textContent(".error")));
await page.fill('input[name="endDate"]', "2026-10-05");
await page.click("button:has-text('สร้างทัวร์นาเมนต์')");
await page.waitForURL(/\/admin\/tournaments\/(?!new)/);
const tournamentUrl = page.url();
step("tournament created");

// Teams with logo via drag & drop
async function dropFile(selector, file, mime) {
  const buffer = fs.readFileSync(file).toString("base64");
  const dt = await page.evaluateHandle(async ({ buffer, file, mime }) => {
    const bytes = Uint8Array.from(atob(buffer), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file, { type: mime }));
    return dt;
  }, { buffer, file, mime });
  await page.dispatchEvent(selector, "dragover", { dataTransfer: dt });
  await page.dispatchEvent(selector, "drop", { dataTransfer: dt });
}
const teamNames = [`Alpha ${uniq}`, `Bravo ${uniq}`];
for (const [i, name] of teamNames.entries()) {
  await page.goto(base + "/admin/teams/new");
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="tag"]', i ? "BRV" : "ALP");
  if (i === 0) {
    await dropFile(".drop", LOGO, "image/png");
  } else {
    await page.setInputFiles('.drop input[type="file"]', LOGO);
  }
  await page.waitForSelector(".drop img");
  const logo = await page.inputValue('input[name="logoUrl"]');
  if (!logo.startsWith("/uploads/")) throw new Error("logo not uploaded");
  await page.click("button:has-text('เพิ่มทีม')");
  await page.waitForURL(/\/teams\//);
  const img = await page.locator(".page-head img.avatar").first();
  const ok = await img.evaluate((el) => el.complete && el.naturalWidth > 0);
  if (!ok) throw new Error("team logo not displayed");
  step(`team "${name}" created with logo (${i ? "file picker" : "drag & drop"})`);
}
// Duplicate team name
await page.goto(base + "/admin/teams/new");
await page.fill('input[name="name"]', teamNames[0]);
await page.click("button:has-text('เพิ่มทีม')");
await page.waitForSelector(".error");
step("duplicate team rejected: " + (await page.textContent(".error")));

// Wrong file type in drop zone
await dropFile(".drop", SELF, "text/javascript");
await page.waitForSelector(".drop + .error, .error:has-text('PNG')");
step("non-image drop rejected");

// Players: 2 per team using "save and add another" + team dropdown
for (const [ti, team] of teamNames.entries()) {
  await page.goto(base + "/admin/players/new");
  for (let n = 1; n <= 2; n++) {
    await page.fill('input[name="name"]', `P${ti}${n}-${uniq}`);
    const combo = page.locator("input[role=combobox]");
    await combo.click();
    await combo.fill(team.split(" ")[0].toLowerCase());
    await page.locator(".combo-list [role=option]", { hasText: team }).click();
    await page.click("button:has-text('บันทึกแล้วเพิ่มคนต่อไป')");
    await page.waitForSelector(".success");
    // the team stays selected for the next player
    const kept = await page.locator("input[role=combobox]").inputValue();
    if (kept !== team) throw new Error("team not kept for next player: " + kept);
  }
}
step("4 players created via team dropdown + 'save and add another'");

// Record a series: 3 games with basketball scoreboards
await page.goto(base + "/admin/matches/new");
const cupValue = await page.locator("option", { hasText: `E2E Cup ${uniq}` }).getAttribute("value");
await page.selectOption("select >> nth=0", cupValue);
await page.click("button:has-text('บันทึกผลการแข่ง')");
await page.waitForSelector("[role=alert]");
step("missing team rejected: " + (await page.textContent("[role=alert]")));

const [comboA, comboB] = [page.getByRole("combobox", { name: "ทีม A" }), page.getByRole("combobox", { name: "ทีม B" })];
await comboA.click();
await comboA.fill("alpha " + uniq);
await page.locator(".combo-list [role=option]").first().click();
await comboB.click();
await comboB.fill(teamNames[0]);
const sameTeamOpts = await page.locator(".combo-list [role=option]").count();
if (sameTeamOpts !== 0) throw new Error("team A should be excluded from team B dropdown");
await comboB.fill("bravo " + uniq);
await page.locator(".combo-list [role=option]").first().click();
step("teams chosen, same team excluded from the other side");

// Screenshot via the AI section, then "fill in myself" makes game 1 with that image
await dropFile(".drop >> nth=0", SHOT, "image/png");
await page.waitForSelector(".shot-chip img");
// Without an AI key the free reader is used; a picture that isn't a scoreboard gets a clear Thai error.
const readBtn = page.locator("button:has-text('รูปแล้วกรอกให้')");
if (await readBtn.isDisabled()) throw new Error("read button should work without an AI key");
expectedRejection = "status of 422";
await readBtn.click();
await page.waitForSelector("[role=alert]:has-text('อ่านสกอร์บอร์ดจากรูปไม่ได้')", { timeout: 60000 });
expectedRejection = null;
step("free reader tried the picture and explained it is not a scoreboard");
await page.click("button:has-text('ใช้รูปนี้แล้วกรอกเอง')");
const game = (n) => page.locator(`section[aria-label="เกม ${n}"]`);
await game(1).waitFor();
// Both rosters load after the teams are picked; wait for them rather than read a half-filled game.
const roster1 = [`P01-${uniq}`, `P02-${uniq}`, `P11-${uniq}`, `P12-${uniq}`];
await page
  .waitForFunction((want) => {
    const values = [...document.querySelectorAll('section[aria-label="เกม 1"] input[list]')].map((e) => e.value);
    return want.every((n) => values.includes(n));
  }, roster1, { timeout: 15000 })
  .catch(() => {});
const names1 = await game(1).locator('input[list]').evaluateAll((els) => els.map((e) => e.value));
if (names1.length !== 6) throw new Error("expected 3 rows per side, got " + names1.length);
for (const n of roster1) if (!names1.includes(n)) throw new Error(`roster ${n} not filled: ${names1}`);
if (!(await game(1).locator("img.drop-preview, .drop img").first().isVisible())) throw new Error("game 1 screenshot not attached");
step("game 1 created from the screenshot with both rosters filled (2 + 1 empty row per side)");

await page.click("button:has-text('บันทึกผลการแข่ง')");
await page.waitForSelector("[role=alert]");
step("missing game score rejected: " + (await page.textContent("[role=alert]")));

async function fillGame(n, a, b, base) {
  await page.fill(`input[aria-label="สกอร์ทีม A เกม ${n}"]`, String(a));
  await page.fill(`input[aria-label="สกอร์ทีม B เกม ${n}"]`, String(b));
  const stats = game(n).locator('tbody input[inputmode="numeric"]');
  const count = await stats.count();
  for (let i = 0; i < count; i++) {
    // rows with no name stay empty
    const name = await stats.nth(i).locator("xpath=ancestor::tr//input[@list]").inputValue();
    if (name) await stats.nth(i).fill(String(base + i));
  }
}
// A new player typed into the empty Alpha row
const newName = `Rookie-${uniq}`;
await game(1).locator("input[list]").nth(2).fill(newName);
if (!(await game(1).locator("text=ผู้เล่นใหม่").first().isVisible())) throw new Error("new player not flagged");
await fillGame(1, 21, 15, 1);
const firstStat = game(1).locator('tbody input[inputmode="numeric"]').first();
await firstStat.fill("1a2");
if ((await firstStat.inputValue()) !== "12") throw new Error("non-digits not stripped");
await game(1).locator('input[aria-label^="เรตติ้งของ"]').first().fill("16.9x");
if ((await game(1).locator('input[aria-label^="เรตติ้งของ"]').first().inputValue()) !== "16.9") throw new Error("rating not cleaned");
await game(1).locator('select[aria-label^="รางวัลของ"]').first().selectOption("MVP");
await game(1).locator('select[aria-label^="รางวัลของ"]').nth(3).selectOption("SVP");

// Games 2 and 3 copy the line-up of the game before
await page.click("button:has-text('+ เพิ่มเกม')");
const names2 = await game(2).locator("input[list]").evaluateAll((els) => els.map((e) => e.value));
if (!names2.includes(newName)) throw new Error("line-up not copied to game 2: " + names2);
await fillGame(2, 10, 21, 3);
await page.click("button:has-text('+ เพิ่มเกม')");
await fillGame(3, 21, 18, 2);
// same player twice in one game
await game(3).locator("input[list]").nth(1).fill(`P01-${uniq}`);
await page.click("button:has-text('บันทึกผลการแข่ง')");
await page.waitForSelector("[role=alert]");
step("duplicate player in a game rejected: " + (await page.textContent("[role=alert]")));
await game(3).locator("input[list]").nth(1).fill(`P02-${uniq}`);
await page.fill('input[placeholder="เช่น รอบแบ่งกลุ่ม, Final"]', "Final");
const placeholderSeries = await page.getAttribute('input[aria-label="ผลซีรีส์ทีม A"]', "placeholder");
if (placeholderSeries !== "2") throw new Error("series not counted from games: " + placeholderSeries);
await page.screenshot({ path: OUT + "/match-form.png", fullPage: true });
await page.click("button:has-text('บันทึกผลการแข่ง')");
await page.waitForURL(/\/matches\/[^/]+$/);
const score = await page.textContent(".hero .score");
if (!score.includes("2 : 1")) throw new Error("bad series score " + score);
const cards = await page.locator(".game-card").count();
if (cards !== 3) throw new Error("expected 3 game cards, got " + cards);
if (!(await page.locator("img.game-shot").first().evaluate((el) => el.complete && el.naturalWidth > 0))) throw new Error("game screenshot missing");
const body = await page.locator("main").textContent();
for (const t of [newName, "MVP", "SVP", "16.9"]) if (!body.includes(t)) throw new Error(`match page missing ${t}`);
const matchUrl = page.url();
await page.screenshot({ path: OUT + "/match-saved.png", fullPage: true });
step("series saved 2 : 1 with 3 game scoreboards, screenshot, MVP/SVP, new player created");

// Edit: Bravo wins game 1 instead
await page.click("a:has-text('แก้ไขผลการแข่ง')");
await page.waitForURL(/\/admin\/matches\//);
await game(3).waitFor();
const loadedRows = await game(1).locator("input[list]").count();
if (loadedRows !== 5) throw new Error("edit form should load the 5 named rows of game 1, got " + loadedRows);
await page.fill('input[aria-label="สกอร์ทีม A เกม 1"]', "5");
await page.click("button:has-text('บันทึกการแก้ไข')");
await page.waitForURL(matchUrl);
const t2 = await page.locator(".hero").textContent();
if (!t2.includes("1 : 2")) throw new Error("edit not saved: " + t2);
step("series edited (1 : 2)");

// The new player has a profile with game stats
await page.click(`a:has-text("${newName}")`);
await page.waitForURL(/\/players\//);
const profile = await page.locator("main").textContent();
if (!profile.includes("Alpha")) throw new Error("new player should be on Alpha: " + profile.slice(0, 200));
step("new player's profile shows their team and games");

// Player ranking (old links to the stat leaderboard still work)
await page.goto(base + "/rankings/players?sort=mvp");
if (!page.url().includes("/rankings/stats?sort=mvp")) throw new Error("old stat ranking link not redirected: " + page.url());
if (!(await page.locator("tbody").textContent()).includes(`P01-${uniq}`)) throw new Error("MVP player missing from ranking");
step("player ranking by MVP lists the player");

// MMR ladder: podium, tiers, and the new player still placing (one series played)
await page.goto(base + "/rankings/players");
if ((await page.locator(".podium-card").count()) !== 3) throw new Error("MMR podium should show 3 players");
if ((await page.locator(".tier-row").count()) !== 7) throw new Error("tier list should show 7 tiers");
if (!(await page.locator(".placing-grid").textContent()).includes(`P01-${uniq}`)) throw new Error("a player with one series should be placing");
step("MMR ladder shows the podium, 7 tiers and players still placing");

// UID keeps a player across a rename; a UID can't be given to two players; duplicates can be merged
const WEB_KEY = fromEnvFile("API_KEY");
const findPlayer = async (name) => (await (await fetch(`${API}/api/v1/players?search=${encodeURIComponent(name)}`, { headers: { "X-API-Key": WEB_KEY } })).json()).data[0];
const p01 = await findPlayer(`P01-${uniq}`);
await page.goto(`${base}/admin/players/${p01.id}`);
await page.fill('input[name="uid"]', `9${uniq}`);
await page.fill('input[name="server"]', "Asia");
await page.fill('input[name="name"]', `Renamed-${uniq}`);
await page.click("button:has-text('บันทึกการแก้ไข')");
await page.waitForURL(`${base}/players/${p01.id}`);
const prof = await page.locator(".page-head").textContent();
if (!prof.includes(`Renamed-${uniq}`) || !prof.includes(`UID 9${uniq}`) || !prof.includes(`P01-${uniq}`)) throw new Error("rename/UID not shown on profile: " + prof);
if (!(await page.locator(".mmr-card").textContent()).includes("กำลังจัดอันดับ")) throw new Error("MMR card should say placing");
step("player renamed with a UID: profile shows UID, old name and MMR card");
const p02 = await findPlayer(`P02-${uniq}`);
await page.goto(`${base}/admin/players/${p02.id}`);
await page.fill('input[name="uid"]', `9${uniq}`);
await page.fill('input[name="server"]', "Asia");
await page.click("button:has-text('บันทึกการแก้ไข')");
await page.waitForSelector(".error");
if (!(await page.textContent(".error")).includes(`Renamed-${uniq}`)) throw new Error("duplicate UID error should name the owner");
step("UID already owned by another player rejected: " + (await page.textContent(".error")));
// A duplicate record of the same person is merged into the renamed player
const dup = await (await fetch(`${API}/api/v1/players`, { method: "POST", headers: { "X-API-Key": WEB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ name: `Dup-${uniq}` }) })).json();
await page.goto(`${base}/admin/players/${p01.id}`);
const mergeCombo = page.locator('input[aria-label="ผู้เล่นที่ซ้ำ"]');
await mergeCombo.click();
await mergeCombo.fill(`Dup-${uniq}`);
await page.locator(".combo-list [role=option]", { hasText: `Dup-${uniq}` }).click();
page.once("dialog", (d) => d.accept());
await page.click("button:has-text('รวมเข้ากับผู้เล่นนี้')");
await page.waitForSelector(".success");
const gone2 = await fetch(`${API}/api/v1/players/${dup.id}`, { headers: { "X-API-Key": WEB_KEY } });
if (gone2.status !== 404) throw new Error("merged duplicate should be deleted");
step("duplicate player merged: " + (await page.textContent(".success")));

// Rankings reflect result
await page.goto(base + "/rankings?q=" + uniq);
const top = await page.locator("tbody tr").first().textContent();
if (!top.includes("Bravo")) throw new Error("Bravo should lead: " + top);
step("rankings updated: " + top.replace(/\s+/g, " ").slice(0, 60));

// Tournament entries: placement
await page.goto(tournamentUrl);
const entryCombo = page.locator("input[role=combobox]");
await entryCombo.click();
await entryCombo.fill("bravo " + uniq);
await page.locator(".combo-list [role=option]").first().click();
await page.fill('input[name="placement"]', "1");
await page.click("button:has-text('เพิ่ม / อัปเดตทีม')");
await page.waitForSelector(".success");
await page.click("button:has-text('เอาออก') >> nth=0");
await page.waitForSelector(".error");
step("placement saved; removing a team with matches blocked: " + (await page.locator(".error").first().textContent()));

// Admin dashboard and list pages
await page.goto(base + "/admin");
if ((await page.locator(".dash-card").count()) !== 4) throw new Error("dashboard should show 4 stat cards");
if ((await page.locator(".day-bar").count()) !== 14) throw new Error("matches-per-day chart should have 14 days");
await page.locator(".side-health:has-text('ออนไลน์')").waitFor();
await page.click(".side-link:has-text('ทีม')");
await page.waitForURL(base + "/admin/teams");
await page.locator(".side-link-active:has-text('ทีม')").waitFor();
await page.fill('.list-search input[name="q"]', teamNames[0]);
await page.click(".list-search button");
await page.waitForURL(/\/admin\/teams\?q=/);
if ((await page.locator(".admin-table tbody tr").count()) < 1) throw new Error("team search in admin list found nothing");
await page.goto(base + "/admin/players?show=nouid");
const noUid = await page.locator(".admin-table tbody tr").count();
const tabCount = Number(await page.locator(".tab-active .tab-count").textContent());
if (noUid !== Math.min(tabCount, 50)) throw new Error(`"no UID" tab says ${tabCount} but lists ${noUid}`);
await page.goto(base + "/admin/tournaments?status=ONGOING");
for (const b of await page.locator(".admin-table .badge").allTextContents()) if (b !== "กำลังแข่ง") throw new Error("status filter let through " + b);
await page.goto(base + "/admin/matches");
if ((await page.locator(".admin-table tbody tr").count()) < 1) throw new Error("admin match list is empty");
await page.screenshot({ path: path.join(OUT, "admin-matches.png"), fullPage: true });
step(`admin dashboard, menu and lists work (${noUid} players without UID)`);

// Admin search
await page.goto(base + "/admin");
await page.fill('input[aria-label="ค้นหาข้อมูลเพื่อแก้ไข"]', uniq);
await page.click(".card form[role=search] button");
const found = await page.locator(".card a .badge").count();
step(`admin search found ${found} items for "${uniq}"`);

// API keys
await page.goto(base + "/admin/keys");
await page.fill('input[name="name"]', `Partner ${uniq}`);
await page.click("button:has-text('สร้าง API key')");
await page.waitForSelector(".success input");
const key = await page.inputValue(".success input");
const apiRes = await fetch(`${API}/api/v1/rankings/teams?limit=1`, { headers: { "X-API-Key": key } });
if (apiRes.status !== 200) throw new Error("new key does not work");
page.once("dialog", (d) => d.accept());
await page.locator("tr", { hasText: `Partner ${uniq}` }).locator("button:has-text('ยกเลิก')").click();
await page.locator("tr", { hasText: `Partner ${uniq}` }).locator(".badge:has-text('ยกเลิกแล้ว')").waitFor();
const after = await fetch(`${API}/api/v1/rankings/teams?limit=1`, { headers: { "X-API-Key": key } });
if (after.status !== 401) throw new Error("revoked key still works");
step("API key created, works with the API, then revoked");

// Delete the match
await page.goto(matchUrl.replace("/matches/", "/admin/matches/"));
page.once("dialog", (d) => d.accept());
await page.click(".page-head button:has-text('ลบ')");
await page.waitForURL(/\/admin\/matches\?deleted=1/);
const gone = await page.request.get(matchUrl);
if (gone.status() !== 404) throw new Error("deleted match still visible: " + gone.status());
step("match deleted, page now 404");

// Bracket: a single elimination cup seeded by hand, started, played and corrected
await page.goto(base + "/admin/tournaments/new");
await page.fill('input[name="name"]', `Bracket Cup ${uniq}`);
await page.fill('input[name="startDate"]', "2030-01-05T19:00");
await page.selectOption('select[name="format"]', "SINGLE_ELIMINATION");
await page.fill('input[name="lateMinutes"]', "10");
await page.click("button:has-text('สร้างทัวร์นาเมนต์')");
await page.waitForURL(/\/admin\/tournaments\/(?!new)/);
const cupUrl = page.url();
await page.locator("text=ต้องมีอย่างน้อย 2 ทีม").waitFor();
const cupTeams = ["Thunder Hawks", "Siam Dragons", "Night Owls"];
for (const [i, name] of cupTeams.entries()) {
  const c = page.locator("input[role=combobox]");
  await c.click();
  await c.fill(name);
  await page.locator(".combo-list [role=option]", { hasText: name }).first().click();
  await page.click("button:has-text('เพิ่ม / อัปเดตทีม')");
  await page.locator("h2", { hasText: `ทีมที่ลงแข่ง (${i + 1})` }).waitFor();
}
step("bracket cup created with 3 teams");

await page.click("button:has-text('จัดเอง (แมนนวล)')");
// Pair 1: Thunder Hawks vs Night Owls; pair 2: Siam Dragons gets the bye.
const owls = await page.locator('select[aria-label="คู่ที่ 1 ฝั่ง B"] option', { hasText: "Night Owls" }).getAttribute("value");
await page.selectOption('select[aria-label="คู่ที่ 1 ฝั่ง B"]', owls);
await page.click("button:has-text('ใช้สายนี้')");
await page.locator("text=ตัวอย่างสาย").waitFor();
const draft = await page.locator(".bk-canvas").first().textContent();
if (!draft.includes("บาย") || !draft.includes("Night Owls")) throw new Error("draft bracket should show the manual pairs and a bye: " + draft);
await page.screenshot({ path: OUT + "/bracket-draft.png", fullPage: true });
step("manual draw previewed before confirming");

await page.click("button:has-text('ยืนยันสายและเริ่มแข่ง')");
await page.locator("button.bm.bm-READY").first().waitFor();
if (!(await page.locator('select[name="format"]').isDisabled())) throw new Error("format should be locked once the bracket runs");
step("bracket started; format locked");

// Semi-final: set a time, then record the result with the match form
const semi = page.locator("button.bm.bm-READY", { hasText: "Night Owls" });
await semi.click();
await page.fill('.card input[type="datetime-local"]', "2030-01-05T20:30");
await page.click("button:has-text('บันทึกเวลา')");
await page.locator(".success", { hasText: "ตั้งเวลาแล้ว" }).waitFor();
step("match time set");
await page.click("a:has-text('บันทึกผลและสถิติ')");
await page.waitForURL(/\/admin\/matches\/new\?.*slot=/);
if ((await page.inputValue('input[aria-label="ทีม A"]')) !== "Thunder Hawks") throw new Error("team A should be fixed by the bracket");
await page.fill('input[aria-label="ผลซีรีส์ทีม A"]', "2");
await page.fill('input[aria-label="ผลซีรีส์ทีม B"]', "1");
await page.click("button:has-text('บันทึกผลการแข่ง')");
await page.waitForURL(/\/matches\/(?!new)/);
if (!(await page.locator(".hero").textContent()).includes("2 : 1")) throw new Error("bracket result not saved");
step("semi-final recorded from the bracket (2 : 1)");

// Final: organizer gives it to Siam Dragons (walkover); the cup finishes
await page.goto(cupUrl);
await page.locator("button.bm.bm-READY", { hasText: "Siam Dragons" }).click();
await page.fill('input[placeholder^="เหตุผล"]', "Thunder Hawks มาไม่ทัน");
await page.click("button:has-text('ให้ Siam Dragons ชนะ')");
await page.locator(".success", { hasText: "ตัดสินแล้ว" }).waitFor();
await page.goto(cupUrl.replace("/admin/tournaments/", "/tournaments/"));
const publicCup = await page.locator("main").textContent();
if (!publicCup.includes("สายการแข่งขัน") || !publicCup.includes("ชนะบาย")) throw new Error("public bracket missing: " + publicCup.slice(0, 300));
if (!(await page.locator(".card", { hasText: "แชมป์" }).textContent()).includes("Siam Dragons")) throw new Error("champion not shown");
await page.screenshot({ path: OUT + "/bracket-public.png", fullPage: true });
step("final decided by the organizer; public page shows the bracket and the champion");

// Thunder Hawks never checked in for the final: every player of the team is on the blacklist, 20 MMR each
await page.goto(base + "/blacklist");
await page.locator(".blacklist-table tbody tr", { hasText: "Thunder Hawks" }).first().waitFor();
const blackRows = await page.locator(".blacklist-table tbody tr").count();
if (!(await page.locator(".blacklist-table").textContent()).includes("-20 MMR")) throw new Error("blacklist penalty not shown");
await page.screenshot({ path: OUT + "/blacklist.png", fullPage: true });
await page.locator(".blacklist-table tbody tr").first().locator("a.entity").click();
await page.waitForURL(/\/players\//);
await page.locator(".blacklist-banner", { hasText: "-20 MMR" }).waitFor();
await page.locator(".blacklist-chip", { hasText: "ติด Blacklist" }).waitFor();
await page.screenshot({ path: OUT + "/blacklist-player.png", fullPage: true });
await page.goto(base + "/admin/blacklist");
// Force majeure: the organizer changes one entry to take nothing, then lifts another
page.once("dialog", (d) => d.accept("0"));
await page.locator("tr", { hasText: "Thunder Hawks" }).nth(1).locator("button:has-text('แก้ MMR')").click();
await page.locator(".success", { hasText: "หัก 0 MMR" }).waitFor();
await page.locator("tr", { hasText: "Thunder Hawks" }).locator(".pill", { hasText: "-0" }).waitFor();
page.once("dialog", (d) => d.accept("แจ้งผู้จัดล่วงหน้าแล้ว"));
await page.locator("tr", { hasText: "Thunder Hawks" }).first().locator("button:has-text('ยกเลิกโทษ')").click();
await page.locator("a.tab:has-text('ยกเลิกโทษแล้ว') .tab-count", { hasText: "1" }).waitFor();
await page.screenshot({ path: OUT + "/blacklist-admin.png", fullPage: true });
step(`walkover loser's ${blackRows} players listed on /blacklist (-20 MMR) and flagged on their page; organizer set one to 0 MMR and lifted another`);

// Clearing the semi-final also clears the final: asks first
await page.goto(cupUrl);
await page.locator("button.bm", { hasText: "Night Owls" }).click();
await page.click("button:has-text('ยกเลิกผล (แข่งใหม่)')");
await page.locator("button:has-text('ล้างผลแมตช์ถัดไป')").waitFor();
step("reopening asks before wiping later results: " + (await page.locator(".error").first().textContent()));
await page.click("button:has-text('ล้างผลแมตช์ถัดไป')");
await page.locator(".success", { hasText: "ยกเลิกผลแล้ว" }).waitFor();
// The bracket redraws just after the success message; wait for it rather than counting at once.
await page.waitForFunction(() => document.querySelectorAll("button.bm.bm-READY").length === 1, null, { timeout: 10_000 }).catch(() => {
  throw new Error("only the semi-final should be waiting again");
});
step("semi-final reopened, final cleared");

// Roster: organizers can set a team's players
await page.locator("tr", { hasText: "Night Owls" }).locator("button:has-text('แก้รายชื่อ')").click();
const rosterInputs = page.locator('label:has-text("ชื่อตัวละคร") input');
await rosterInputs.nth(0).fill("Kite");
await page.locator('label:has-text("UID") input').nth(0).fill("81000108");
await page.locator('label:has-text("Server") input').nth(0).fill("Asia");
await page.click("button:has-text('+ เพิ่มผู้เล่น')");
await rosterInputs.nth(1).fill("Lynx");
await page.click("button:has-text('+ เพิ่มผู้เล่น')");
await rosterInputs.nth(2).fill("Moss");
await page.click("button:has-text('บันทึกรายชื่อ')");
await page.locator("tr", { hasText: "Night Owls" }).locator("td", { hasText: "Kite (UID 81000108 · Asia), Lynx, Moss" }).waitFor();
step("roster saved for Night Owls, with UID and server");

// Shop ads: a banner under the menu, a home page card and a once-a-day popup, managed in the back office.
console.log("— Shop ads");
const SHOP = `${base}/rankings?shop=${uniq}`;
async function newAd(placement, title, extra = async () => {}) {
  await page.goto(base + "/admin/ads/new");
  await page.locator(`.ad-place:has(input[value="${placement}"])`).click();
  await page.fill('input[name="title"]', title);
  await page.fill('input[name="linkUrl"]', SHOP);
  await page.setInputFiles('.drop input[type="file"] >> nth=0', LOGO);
  await page.waitForSelector(".drop img");
  await extra();
  await page.click("button:has-text('เพิ่มโฆษณา')");
  await page.waitForURL(/\/admin\/ads\?saved=1/);
  await page.locator(".ad-row", { hasText: title }).waitFor();
}
await page.goto(base + "/admin/ads");
await page.locator('.side-link[href="/admin/ads"]').waitFor();
await page.click("a:has-text('+ เพิ่มโฆษณา')");
await page.fill('input[name="title"]', `Shop ${uniq}`);
await page.fill('input[name="linkUrl"]', SHOP);
await page.click("button:has-text('เพิ่มโฆษณา')");
await page.locator(".error:has-text('ใส่รูปโฆษณาก่อน')").waitFor();
await page.setInputFiles('.drop input[type="file"] >> nth=0', LOGO);
await page.waitForSelector(".drop img");
await page.fill('input[name="linkUrl"]', "ftp://shop.example.com");
await page.click("button:has-text('เพิ่มโฆษณา')");
await page.locator(".error:has-text('https://')").waitFor();
step("ad form asks for a picture and an http(s) shop link");
await page.fill('input[name="linkUrl"]', SHOP);
await page.click("button:has-text('เพิ่มโฆษณา')");
await page.waitForURL(/\/admin\/ads\?saved=1/);
await page.locator(".ad-row", { hasText: `Shop ${uniq}` }).locator(".pill:has-text('กำลังแสดง')").waitFor();
await newAd("popup", `Popup ${uniq}`);
await newAd("card", `Card ${uniq}`);
await newAd("card", `Later ${uniq}`, async () => page.fill('input[name="startsAt"]', "2099-01-01T10:00"));
await page.locator(".ad-row", { hasText: `Later ${uniq}` }).locator(".pill:has-text('รอเริ่ม')").waitFor();
if (await page.locator(".ad-banner, .ad-popup").count()) throw new Error("ads shown inside the back office");
step("banner, popup and card ads created; a future card waits for its start time");

await page.goto(base + "/");
await page.locator(".ad-popup").waitFor();
await page.click(".ad-popup-close");
await page.locator(".ad-popup").waitFor({ state: "detached" });
const bannerOk = await page.locator(".ad-banner img").first().evaluate((el) => el.complete && el.naturalWidth > 0);
if (!bannerOk) throw new Error("banner picture not displayed");
if (!(await page.locator(".ad-card", { hasText: `Card ${uniq}` }).count())) throw new Error("home page card missing");
if (await page.locator(".ad-card", { hasText: `Later ${uniq}` }).count()) throw new Error("card shown before its start time");
await page.reload();
await page.waitForTimeout(2000);
if (await page.locator(".ad-popup").count()) throw new Error("popup shown twice on the same day");
await page.goto(base + "/teams");
await page.locator(".ad-banner").waitFor();
step("home shows the banner, the card and the popup once; the popup stays closed after a reload; banner on other pages too");

const go = await page.locator(".ad-banner a").first().getAttribute("href");
const hop = await page.request.get(base + go, { maxRedirects: 0 });
if (hop.status() !== 302 || hop.headers().location !== SHOP) throw new Error(`ad click should go to the shop, got ${hop.status()} ${hop.headers().location}`);
const lost = await page.request.get(base + "/go/ad/missing", { maxRedirects: 0 });
if (lost.status() !== 302 || lost.headers().location !== "/") throw new Error("unknown ad should go home");
await page.goto(base + "/admin/ads");
const bannerRow = page.locator(".ad-row", { hasText: `Shop ${uniq}` });
if ((await bannerRow.locator("td.num").textContent()).trim() !== "1") throw new Error("ad click not counted");
step("a click is counted and goes to the shop link");

await bannerRow.locator("button:has-text('ปิด')").click();
await bannerRow.locator(".pill:has-text('ปิดอยู่')").waitFor();
await page.goto(base + "/");
if (await page.locator(`.ad-banner img[alt="Shop ${uniq}"]`).count()) throw new Error("switched-off banner still shown");
await page.goto(base + "/admin/ads");
for (const t of [`Shop ${uniq}`, `Popup ${uniq}`, `Card ${uniq}`, `Later ${uniq}`]) {
  page.once("dialog", (d) => d.accept());
  await page.locator(".ad-row", { hasText: t }).locator("button:has-text('ลบ')").click();
  await page.waitForURL(/\/admin\/ads\?deleted=1/);
  await page.locator(".ad-row", { hasText: t }).waitFor({ state: "detached" });
}
step("ad switched off from the list disappears from the site; ads deleted");

// Games: MMR and rankings are per game; organizers manage the list.
console.log("— Games");
await page.goto(base + "/admin/games");
await page.locator("tr:has-text('Basketball 3v3')").waitFor();
const newGame = `E2E Game ${uniq}`;
await page.fill('.game-add input[name="name"]', newGame);
await page.click(".game-add button");
await page.locator(`.game-add .success:has-text('${newGame}')`).waitFor();
await page.locator(`tr:has-text('${newGame}')`).waitFor();
await page.fill('.game-add input[name="name"]', "basketball 3V3");
await page.click(".game-add button");
await page.locator(".game-add .error:has-text('มีเกม')").waitFor();
const gameRow = page.locator(`tr:has-text('${newGame}')`);
await gameRow.locator("button:has-text('เปลี่ยนชื่อ')").click();
// While editing the row holds an input instead of the name.
const editing = page.locator("tbody tr:has(input[name='name'])");
await editing.locator('input[name="name"]').fill(`${newGame} R`);
await editing.locator("button:has-text('บันทึก')").click();
await page.locator(`tr strong:has-text('${newGame} R')`).waitFor();
if (await page.locator("tr:has-text('Basketball 3v3') button:has-text('ลบ')").isEnabled()) throw new Error("a game in use can be deleted");
step("game added, duplicate name refused, renamed; a game in use can't be deleted");

// Two games: the rankings get a game picker that is remembered.
await page.goto(base + "/rankings/players");
await page.locator(".game-tabs").waitFor();
await page.locator(".game-tab", { hasText: `${newGame} R` }).click();
await page.locator(`h1:has-text('${newGame} R')`).waitFor();
await page.goto(base + "/rankings");
await page.locator(`h1:has-text('${newGame} R')`).waitFor();
await page.screenshot({ path: OUT + "/rankings-game-tabs.png" });
await page.locator(".game-tab", { hasText: "Basketball 3v3" }).click();
await page.locator("h1:has-text('Basketball 3v3')").waitFor();
await page.goto(base + "/rankings/players");
await page.locator("h1:has-text('Basketball 3v3')").waitFor();
if ((await page.locator(".podium, table tbody tr").count()) === 0) throw new Error("Basketball ladder empty after switching back");
step("rankings show a game picker; the picked game is remembered across pages");

// Forms pick a game; an organizer sets a team's captain and gets its invite link.
await page.goto(base + "/admin/teams/new");
if ((await page.locator('select[name="gameId"] option').count()) !== 3) throw new Error("team form has no game choice");
await page.goto(base + "/admin/teams?q=" + encodeURIComponent(teamNames[0]));
await page.locator(`a[href^="/admin/teams/"]:has-text('${teamNames[0]}')`).first().click();
await page.waitForURL(/\/admin\/teams\/(?!new)/);
const adminTeamUrl = page.url();
const captain = (await page.locator('select[name="captainId"] option').nth(1).textContent()).trim();
await page.selectOption('select[name="captainId"]', { index: 1 });
await page.click("button:has-text('บันทึกการแก้ไข')");
await page.waitForURL(/\/teams\//);
await page.locator(`tr:has-text('${captain}') .captain-chip`).waitFor();
await page.goto(adminTeamUrl);
await page.click("button:has-text('แสดงลิงก์เชิญ')");
if (!/\/join\/[A-Z0-9]{8}$/.test(await page.locator(".invite-box input").inputValue())) throw new Error("admin invite link missing");
step("organizer set a team captain (👑 on the team page) and got the team's invite link");

page.once("dialog", (d) => d.accept());
await page.goto(base + "/admin/games");
await page.locator(`tr:has-text('${newGame} R') button:has-text('ลบ')`).click();
await page.locator(`tr:has-text('${newGame} R')`).waitFor({ state: "detached" });
await page.goto(base + "/rankings/players");
if (await page.locator(".game-tabs").count()) throw new Error("game picker shown with one game");
step("unused game deleted; with one game the picker is gone");
await page.goto(base + "/admin");

// SOLO tournament: players sign up alone with position and in-game rank, then teams are drawn.
console.log("— Solo tournament");
// The game's in-game ranks, lowest first, with an icon for the top one.
await page.goto(base + "/admin/games");
await page.locator("tr:has-text('Basketball 3v3') a:has-text('แรงค์')").click();
await page.locator("h1:has-text('แรงค์ในเกม')").waitFor();
if ((await page.locator(".rank-editor-row").count()) !== 4) throw new Error("default ranks not offered");
await page.locator(".rank-editor-row").nth(3).locator('input[type="file"]').setInputFiles(LOGO);
await page.locator(".rank-editor-row").nth(3).locator(".drop img").waitFor();
await page.click("button:has-text('บันทึกแรงค์')");
await page.locator(".rank-editor .success").waitFor();
step("game ranks saved with an icon");
await page.goto(base + "/admin/tournaments/new");
await page.fill('input[name="name"]', `Solo ${uniq}`);
await page.fill('input[name="startDate"]', "2026-12-01T19:00");
await page.selectOption('select[name="format"]', "SINGLE_ELIMINATION");
await page.selectOption('select[name="entryMode"]', "SOLO");
await page.check('input[name="registrationOpen"]');
await page.click("button:has-text('สร้างทัวร์นาเมนต์')");
await page.waitForURL(/\/admin\/tournaments\/(?!new)/);
const soloId = page.url().split("/").pop().split("?")[0];
await page.locator("h2:has-text('ลงเดี่ยว / สุ่มทีม')").waitFor();
// Five players sign up through the API the way the website and bot do; the sixth uses the website below.
const apiCall = (method, url, body) =>
  fetch(`${API}/api/v1${url}`, { method, headers: { "X-API-Key": WEB_KEY, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => {
    if (r.status >= 300) throw new Error(`${method} ${url} → ${r.status} ${await r.text()}`);
    return r.json();
  });
const soloPlan = [["GUARD", "เจ้าแห่ง ZONE"], ["FORWARD", "แม่ทัพไร้มงกุฎ"], ["GUARD", "ซูเปอร์สตาร์ ม.ปลาย"], ["FORWARD", "รุ่นแห่งปาฏิหาริย์"], ["ALL", "แม่ทัพไร้มงกุฎ"]];
for (const [i, [position, rank]] of soloPlan.entries()) {
  const discord = `68${uniq}00000${i}`;
  const p = await apiCall("POST", `/players/discord/${discord}/claim`, { uid: `69${uniq}${i}`, name: `Solo${i}-${uniq}` });
  await apiCall("POST", `/members/${discord}/solo/${soloId}`, { playerId: p.id, position, rank });
}
step("SOLO tournament created with in-game ranks; 5 players signed up");

// Logout
await page.click("button:has-text('ออกจากระบบ')");
await page.waitForURL(base + "/");
if (await page.locator('.nav a[href="/admin"]').count()) throw new Error("admin link still in the menu after logout");
if (ADMIN_PATH) {
  if ((await page.request.get(base + "/admin/matches/new", { maxRedirects: 0 })).status() !== 404) throw new Error("still logged in");
} else {
  await page.goto(base + "/admin/matches/new");
  if (!page.url().includes("/admin/login")) throw new Error("still logged in");
}
step("logged out");

console.log("— Players log in with Discord");
await page.goto(base + "/me");
if (!(await page.locator(".btn-discord").count())) {
  step("Discord login is not configured on this website: skipped");
} else {
  if (!(await page.locator('.nav a[href="/me"]').count())) throw new Error("menu has no player login link");
  // A forged return from Discord is refused.
  await page.goto(base + "/api/auth/discord/callback?code=e2e-code&state=forged");
  await page.locator(".error:has-text('หมดอายุ')").waitFor();
  await page.click(".btn-discord");
  await page.waitForURL(base + "/me");
  await page.locator("h1:has-text('E2E Discord')").waitFor();
  await page.locator(".nav-me:has-text('E2E Discord')").waitFor();
  // A new UID needs a name first.
  const newUid = `77${uniq}`;
  await page.fill('.claim-form input[name="uid"]', newUid);
  await page.fill('.claim-form input[name="server"]', "Asia");
  await page.click(".claim-form button:has-text('ผูกโปรไฟล์')");
  await page.locator(".claim-form .error:has-text('ใส่ชื่อในเกม')").waitFor();
  await page.fill('.claim-form input[name="name"]', `Disc-${uniq}`);
  await page.click(".claim-form button:has-text('ผูกโปรไฟล์')");
  await page.locator(`.me-player:has-text('Disc-${uniq}')`).waitFor();
  // An existing player (Ace from the demo data) is linked with their stats.
  await page.fill('.claim-form input[name="uid"]', "81000100");
  await page.fill('.claim-form input[name="server"]', "Asia");
  await page.click(".claim-form button:has-text('ผูกโปรไฟล์')");
  await page.locator(".me-player:has-text('Ace')").waitFor();
  step("logged in with Discord; created a new profile by UID and linked an existing one");

  const mine = page.locator(`.me-player:has-text('Disc-${uniq}')`);
  await mine.locator('input[name="nickname"]').fill(`Nick ${uniq}`);
  await mine.locator('select[name="role"]').selectOption("CENTER");
  await mine.locator("button:has-text('บันทึก')").click();
  await mine.locator(".success:has-text('บันทึกแล้ว')").waitFor();
  const up = await page.request.post(base + "/api/upload", { multipart: { image: { name: "a.png", mimeType: "image/png", buffer: fs.readFileSync(LOGO) } } });
  if (up.status() !== 201 && up.status() !== 200) throw new Error("logged-in player cannot upload an avatar: " + up.status());
  await mine.locator("a.entity").click();
  await page.locator(".verified-chip").waitFor();
  if (!(await page.locator(`text=Nick ${uniq}`).count())) throw new Error("nickname not on the public profile");
  step("player edited their own nickname and role; profile shows ✓ ยืนยันผ่าน Discord");

  console.log("— Teams run by players");
  await page.goto(base + "/me");
  const ace = page.locator(".me-player:has-text('Ace')");
  await ace.locator(".me-rank:has-text('Basketball 3v3')").waitFor();
  if (!/อันดับ #\d+ จาก \d+ คน ใน Basketball 3v3/.test(await ace.locator(".me-rank").textContent())) throw new Error("own rank in the game missing on /me");
  const disc = page.locator(`.me-player:has-text('Disc-${uniq}')`);
  await disc.locator('.team-create input[name="name"]').fill(`Squad ${uniq}`);
  await disc.locator('.team-create input[name="tag"]').fill("SQD");
  await disc.locator(".team-create button").click();
  await disc.locator(".pill:has-text('คุณเป็นหัวหน้าทีม')").waitFor();
  const invite = new URL(await disc.locator(".invite-box input").inputValue()).pathname;
  if (!/^\/join\/[A-Z0-9]{8}$/.test(invite)) throw new Error("no invite link for the captain: " + invite);
  await page.screenshot({ path: OUT + "/me-team.png", fullPage: true });
  step("/me shows the rank in each game; a player created a team and got an invite link");

  // A teammate opens the link, logs in, makes a profile and joins.
  discordUser = TEAMMATE;
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const mate = await ctx2.newPage();
  mate.on("pageerror", (e) => problems.push(`pageerror: ${e.message} @ ${mate.url()}`));
  await mate.goto(base + invite);
  await mate.locator(`.join-card:has-text('Squad ${uniq}')`).waitFor();
  await mate.screenshot({ path: OUT + "/join-invite.png" });
  await mate.click(".btn-discord");
  await mate.waitForURL(base + invite);
  await mate.locator(".join-card a[href='/me']").click();
  await mate.fill('.claim-form input[name="uid"]', `78${uniq}`);
  await mate.fill('.claim-form input[name="server"]', "Asia");
  await mate.fill('.claim-form input[name="name"]', `Mate-${uniq}`);
  await mate.click(".claim-form button:has-text('ผูกโปรไฟล์')");
  await mate.locator(`.me-player:has-text('Mate-${uniq}')`).waitFor();
  await mate.goto(base + invite);
  await mate.click(".join-card button:has-text('เข้าร่วมทีม')");
  await mate.waitForURL(/\/me\?joined=1/);
  await mate.locator(`.team-panel:has-text('Squad ${uniq}')`).waitFor();
  step("teammate opened the invite link, logged in with Discord, made a profile and joined");

  // The captain kicks them; they come back with the code and leave on their own.
  await page.reload();
  page.once("dialog", (d) => d.accept());
  await disc.locator(`.team-members li:has-text('Mate-${uniq}') button:has-text('เตะออก')`).click();
  await disc.locator(`.team-members li:has-text('Mate-${uniq}')`).waitFor({ state: "detached" });
  await mate.reload();
  await mate.locator('.team-join input[name="code"]').fill(base + invite);
  await mate.click(".team-join button");
  await mate.locator(`.team-panel:has-text('Squad ${uniq}')`).waitFor();
  mate.once("dialog", (d) => d.accept());
  await mate.click(".team-panel button:has-text('ออกจากทีม')");
  await mate.locator(".team-create").waitFor();
  step("captain kicked a member; they rejoined by pasting the link and left on their own");

  // Captaincy can be handed over.
  await mate.locator('.team-join input[name="code"]').fill(invite.split("/").pop().toLowerCase());
  await mate.click(".team-join button");
  await mate.locator(`.team-panel:has-text('Squad ${uniq}')`).waitFor();
  await page.reload();
  page.once("dialog", (d) => d.accept());
  await disc.locator(`.team-members li:has-text('Mate-${uniq}') button:has-text('ตั้งเป็นหัวหน้า')`).click();
  await disc.locator(".pill:has-text('คุณเป็นหัวหน้าทีม')").waitFor({ state: "detached" });
  await mate.reload();
  await mate.locator(".pill:has-text('คุณเป็นหัวหน้าทีม')").waitFor();
  await mate.locator(".team-panel a.entity").first().click();
  await mate.locator(`tr:has-text('Mate-${uniq}') .captain-chip`).waitFor();

  console.log("— Guilds");
  // A player starts a guild and leads it; only the leader can invite, by UID.
  await page.goto(base + "/me");
  const discGuild = disc.locator(".guild-panel");
  await discGuild.locator(".guild-create summary").click();
  await discGuild.locator('input[name="name"]').fill(`Club ${uniq}`);
  await discGuild.locator('input[name="tag"]').fill("CLB");
  await discGuild.locator('textarea[name="description"]').fill("Kuroko club for e2e");
  await discGuild.locator("button:has-text('สร้างกิลด์')").click();
  await discGuild.locator(".pill:has-text('คุณเป็นหัวหน้ากิลด์')").waitFor();
  await discGuild.locator(".guild-invite input[name='uid']").fill("nope-" + uniq);
  await discGuild.locator(".guild-invite button").click();
  await discGuild.locator(".guild-invite .error:has-text('ไม่พบผู้เล่น')").waitFor();
  await discGuild.locator(".guild-invite input[name='uid']").fill(`78${uniq}`);
  await discGuild.locator(".guild-invite button").click();
  await discGuild.locator(".guild-invite .success").waitFor();
  await page.reload();
  await discGuild.locator(`li:has-text('Mate-${uniq}') button:has-text('ยกเลิกคำเชิญ')`).waitFor();
  step("player created a guild (leader) and invited a friend by UID; an unknown UID is refused");

  // The friend sees the invite on their profile and accepts; members can't invite.
  await mate.goto(base + "/me");
  const mateGuild = mate.locator(`.me-player:has-text('Mate-${uniq}') .guild-panel`);
  await mate.locator(`.me-sub:has-text('มีคำเชิญ 1')`).waitFor();
  await mateGuild.locator(`.invite-box li:has-text('Club ${uniq}') button:has-text('รับคำเชิญ')`).click();
  await mateGuild.locator(`a.entity:has-text('Club ${uniq}')`).waitFor();
  await mateGuild.locator("text=2 / 200 คน").waitFor();
  if (await mateGuild.locator(".guild-invite").count()) throw new Error("a member who isn't the leader can invite");
  step("friend accepted the invite on /me; only the leader sees the invite form");

  // Public guild pages: list with the #1 player, and the members ranked inside the guild.
  await page.goto(base + "/guilds");
  await page.locator(`.guild-card:has-text('Club ${uniq}'):has-text('2 / 200 คน')`).click();
  await page.locator(`h1:has-text('Club ${uniq}')`).waitFor();
  await page.locator(".guild-about:has-text('Kuroko club for e2e')").waitFor();
  await page.locator(`tr:has-text('Disc-${uniq}') .captain-chip:has-text('หัวหน้า')`).waitFor();
  if ((await page.locator("tbody tr").count()) !== 2) throw new Error("guild page should list 2 members");
  await page.screenshot({ path: OUT + "/guild-page.png", fullPage: true });
  await page.locator(`tr:has-text('Mate-${uniq}') a[href^='/players/']`).click();
  await page.locator(`.guild-chip:has-text('Club ${uniq}')`).waitFor();
  step("guild list and page show members, leader and ranks; the player page links the guild");

  // Organizers change the leader (e.g. a lost account) and raise the size.
  const gAdminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const gAdmin = await gAdminCtx.newPage();
  gAdmin.on("pageerror", (e) => problems.push(`pageerror: ${e.message} @ ${gAdmin.url()}`));
  await gAdmin.goto(base + LOGIN);
  await gAdmin.fill('input[name="password"]', PASSWORD);
  await gAdmin.click("button:has-text('เข้าสู่ระบบ')");
  await gAdmin.waitForURL(base + "/admin");
  await gAdmin.click('.side-nav a[href="/admin/guilds"]');
  await gAdmin.locator(`tr:has-text('Club ${uniq}') a:has-text('แก้ไข')`).click();
  await gAdmin.locator(`h1:has-text('Club ${uniq}')`).waitFor();
  await gAdmin.locator('select[name="leaderId"]').selectOption({ label: `Mate-${uniq}` });
  await gAdmin.fill('input[name="capacity"]', "1");
  await gAdmin.click("button:has-text('บันทึกการแก้ไข')");
  if (await gAdmin.locator('input[name="capacity"]:invalid').count() === 0) throw new Error("capacity below member count allowed");
  await gAdmin.fill('input[name="capacity"]', "300");
  await gAdmin.click("button:has-text('บันทึกการแก้ไข')");
  await gAdmin.locator(".success:has-text('บันทึกแล้ว')").waitFor();
  await gAdmin.screenshot({ path: OUT + "/guild-admin.png", fullPage: true });
  await gAdminCtx.close();
  await mate.reload();
  await mateGuild.locator(".pill:has-text('คุณเป็นหัวหน้ากิลด์')").waitFor();
  await mateGuild.locator("text=2 / 300 คน").waitFor();
  // The new leader kicks the old one, who is back to no guild.
  mate.once("dialog", (d) => d.accept());
  // The old leader shows by the nickname they set.
  await mateGuild.locator(`li:has-text('Nick ${uniq}') button:has-text('เตะออก')`).click();
  await mateGuild.locator(`li:has-text('Nick ${uniq}')`).waitFor({ state: "detached" });
  await page.goto(base + "/me");
  await disc.locator(".guild-panel .guild-create").waitFor();
  step("organizer made the friend leader and raised the size to 300; the new leader kicked a member");
  await ctx2.close();
  discordUser = DISCORD_USER;
  step("captain handed the team to the teammate; 👑 shows on the team page");

  // The logged-in player signs up for the SOLO tournament on its page.
  await page.goto(base + `/tournaments/${soloId}`);
  await page.locator("h2:has-text('ลงทะเบียนเดี่ยว')").waitFor();
  const soloForm = page.locator(".solo-form");
  if (await soloForm.locator('select[name="playerId"]').count()) await soloForm.locator('select[name="playerId"]').selectOption({ label: `Disc-${uniq} (UID 77${uniq})` });
  await soloForm.locator('select[name="position"]').selectOption("FORWARD");
  if (!(await soloForm.locator(".rank-pick label:has-text('เจ้าแห่ง ZONE') img").count())) throw new Error("rank icon missing in the picker");
  await soloForm.locator(".rank-pick label:has-text('เจ้าแห่ง ZONE')").click();
  await soloForm.locator("button:has-text('ลงทะเบียน')").click();
  await soloForm.locator(".success").waitFor();
  await page.locator("tr.row-me:has-text('Forward')").waitFor();
  // Changing position keeps one sign-up.
  await soloForm.locator('select[name="position"]').selectOption("CENTER");
  await soloForm.locator("button:has-text('บันทึกการเปลี่ยนแปลง')").click();
  await page.locator("tr.row-me:has-text('Center')").waitFor();
  await page.locator("h2:has-text('6 คน · ได้ 2 ทีม')").waitFor();
  await page.screenshot({ path: OUT + "/solo-signup.png", fullPage: true });
  step("player signed up alone with position and rank on the tournament page, then changed position");

  // An organizer draws the teams and saves them.
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminCtx.newPage();
  admin.on("pageerror", (e) => problems.push(`pageerror: ${e.message} @ ${admin.url()}`));
  await admin.goto(base + LOGIN);
  await admin.fill('input[name="password"]', PASSWORD);
  await admin.click("button:has-text('เข้าสู่ระบบ')");
  await admin.waitForURL(base + "/admin");
  await admin.goto(base + `/admin/tournaments/${soloId}`);
  await admin.click("button:has-text('สุ่มทีม')");
  await admin.locator(".solo-team").nth(1).waitFor();
  if ((await admin.locator(".solo-team").count()) !== 2) throw new Error("expected 2 drawn teams");
  for (let i = 0; i < 2; i++) {
    const team = admin.locator(".solo-team").nth(i);
    if ((await team.locator("li").count()) !== 3) throw new Error("drawn team is not 3 players");
    if (await team.locator(".notice").count()) throw new Error("drawn team is missing a position");
  }
  await admin.click("button:has-text('สุ่มใหม่')");
  await admin.locator(".solo-team").nth(1).waitFor();
  await admin.screenshot({ path: OUT + "/solo-draw.png", fullPage: true });
  await admin.click("button:has-text('ยืนยันทีมชุดนี้')");
  await admin.locator(".solo-admin .success:has-text('2 ทีม')").waitFor();
  await admin.locator(".solo-admin .pill:has-text('สุ่มทีมแล้ว')").waitFor();
  await adminCtx.close();
  await page.reload();
  await page.locator(".notice:has-text('สุ่มทีมเรียบร้อยแล้ว')").waitFor();
  await page.locator(`h2:has-text('รายชื่อผู้เล่น')`).waitFor();
  step("organizer drew 2 balanced teams (every team has G/F/C), redrew and saved; the page shows the teams");

  console.log("— เล่นเก่งปากเก่ง (substitutes list)");
  await page.goto(base + "/special");
  await page.locator(".special-cta a:has-text('ลงชื่อตัวสำรอง')").click();
  await page.waitForURL(/\/me#reserve$/);
  const reserve = page.locator("#reserve");
  if (await reserve.locator('select[name="playerId"]').count()) await reserve.locator('select[name="playerId"]').selectOption({ label: `Disc-${uniq} (UID 77${uniq})` });
  await reserve.locator('select[name="position"]').selectOption("GUARD");
  const reserveRank = (await reserve.locator(".rank-pick label").last().textContent()).replace("สูงสุด", "").trim();
  await reserve.locator(".rank-pick label").last().click();
  await reserve.locator('input[name="facebook"]').fill("https://evil.example/login");
  await reserve.locator("button:has-text('ลงชื่อตัวสำรอง')").click();
  await reserve.locator(".error:has-text('facebook.com')").waitFor();
  await reserve.locator('input[name="facebook"]').fill(`https://www.facebook.com/disc${uniq}`);
  await reserve.locator('input[name="phone"]').fill("0812345678");
  await reserve.locator("button:has-text('ลงชื่อตัวสำรอง')").click();
  await reserve.locator(".success:has-text('รายชื่อตัวสำรอง')").waitFor();
  await page.reload();
  await page.locator("#reserve .notice:has-text('ลงชื่อไว้แล้ว')").waitFor();
  await page.locator("#reserve").screenshot({ path: OUT + "/reserve-form.png" });
  await page.goto(base + "/special");
  await page.locator("h1:has-text('เล่นเก่งปากเก่ง')").waitFor();
  await page.locator(`#reserve .card:has-text('บอลหลัก') li:has-text('UID 77${uniq}') .rank-badge:has-text('${reserveRank}')`).waitFor();
  const publicText = await page.locator("main").textContent();
  if (publicText.includes(`disc${uniq}`) || publicText.includes("0812345678")) throw new Error("Facebook or phone shown on the public page");
  await page.screenshot({ path: OUT + "/special.png", fullPage: true });
  step("player signed up as a substitute on /me with their rank (a non-Facebook link is refused); /special lists them with the rank and without contact details");

  const rAdminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const rAdmin = await rAdminCtx.newPage();
  rAdmin.on("pageerror", (e) => problems.push(`pageerror: ${e.message} @ ${rAdmin.url()}`));
  await rAdmin.goto(base + LOGIN);
  await rAdmin.fill('input[name="password"]', PASSWORD);
  await rAdmin.click("button:has-text('เข้าสู่ระบบ')");
  await rAdmin.waitForURL(base + "/admin");
  await rAdmin.click('.side-nav a[href="/admin/reserve"]');
  const row = rAdmin.locator(`tr:has-text('UID 77${uniq}')`);
  await row.locator(`a[href="https://www.facebook.com/disc${uniq}"]`).waitFor();
  await row.locator("a[href='tel:0812345678']").waitFor();
  await row.locator("button:has-text('แก้ไข')").click();
  await row.locator('select[name="position"]').selectOption("ALL");
  const firstRank = (await row.locator('select[name="rank"] option').nth(1).textContent()).trim();
  await row.locator('select[name="rank"]').selectOption(firstRank);
  await row.locator("button:has-text('บันทึก')").click();
  await row.locator(".success:has-text('บันทึกแล้ว')").waitFor();
  await rAdmin.reload();
  await rAdmin.locator(`tr:has-text('UID 77${uniq}'):has-text('All Around'):has-text('แรงค์ ${firstRank}')`).waitFor();
  await rAdmin.screenshot({ path: OUT + "/reserve-admin.png", fullPage: true });
  await rAdmin.goto(base + "/admin/tournaments/new");
  await rAdmin.locator('input[name="special"]').waitFor();
  step("organizer sees Facebook and phone on /admin/reserve and fixed the position and rank; the tournament form has the special tick box");

  // Seasons: create one, paste its players (name + UID), pick it for a special tournament, see it on /special.
  await rAdmin.click('.side-nav a[href="/admin/seasons"]');
  const seasonName = `Season ${uniq}`;
  await rAdmin.fill('form:has-text("สร้างซีซั่นใหม่") input[name="name"]', seasonName);
  await rAdmin.fill('form:has-text("สร้างซีซั่นใหม่") input[name="startDate"]', "2026-01-01");
  await rAdmin.click("button:has-text('+ สร้างซีซั่น')");
  await rAdmin.waitForURL(/\/admin\/seasons\/[^/]+$/);
  const seasonId = rAdmin.url().split("/").pop();
  await rAdmin.fill('textarea[name="text"]', `Rookie${uniq} 99${uniq}\nGhost`);
  await rAdmin.click("button:has-text('+ เพิ่มเข้าซีซั่น')");
  await rAdmin.locator(".success:has-text('เพิ่ม 1 คน')").waitFor();
  await rAdmin.locator(".error:has-text('บรรทัด 2: Ghost')").waitFor();
  await rAdmin.locator(`tr:has-text('Rookie${uniq}'):has-text('99${uniq}')`).waitFor();
  await rAdmin.screenshot({ path: OUT + "/season-admin.png", fullPage: true });
  await rAdmin.goto(base + "/admin/tournaments/new");
  await rAdmin.check('input[name="special"]');
  if (!(await rAdmin.locator(`select[name="seasonId"] option[value="${seasonId}"]`).count())) throw new Error("the season is not offered on the tournament form");
  // Organizers put a team together by ticking players from the season's list: nothing is typed.
  const kt = await apiCall("POST", "/tournaments", { name: `Picked ${uniq}`, startDate: new Date(Date.now() + 86400_000).toISOString(), format: "SINGLE_ELIMINATION", rosterMin: 1, rosterMax: 3, special: true, seasonId });
  await rAdmin.goto(base + `/admin/tournaments/${kt.id}`);
  const pickCard = rAdmin.locator(".pick-team-card");
  // check() retries until the box is ticked, so a click before the page is interactive is not lost.
  await pickCard.locator(`label.pick-row:has-text('Rookie${uniq}') input`).check();
  await pickCard.locator("p:has-text('เลือกแล้ว 1/3')").waitFor();
  await pickCard.locator('label:has-text("ชื่อทีม") input').fill(`Picked Team ${uniq}`);
  await pickCard.locator("button:has-text('+ เพิ่มทีมนี้')").click();
  await pickCard.locator(".success:has-text('เพิ่มทีม Picked Team')").waitFor();
  const pickedRoster = (await apiCall("GET", `/tournaments/${kt.id}/bracket`)).teams.find((e) => e.name === `Picked Team ${uniq}`)?.roster ?? [];
  if (pickedRoster.map((r) => `${r.name} ${r.uid}`).join() !== `Rookie${uniq} 99${uniq}`) throw new Error(`the picked team's roster is wrong: ${JSON.stringify(pickedRoster)}`);
  await rAdmin.reload();
  await rAdmin.locator(`.pick-row-taken:has-text('อยู่ทีม Picked Team ${uniq}')`).waitFor();
  await rAdmin.screenshot({ path: OUT + "/pick-team.png", fullPage: true });
  await rAdmin.setViewportSize({ width: 375, height: 812 });
  await rAdmin.reload();
  if (await rAdmin.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("the team picker is wider than a phone screen");
  await rAdmin.screenshot({ path: OUT + "/pick-team-mobile.png", fullPage: true });
  step("organizer ticked a season player to make a team (name and UID filled from the list); the player then shows as taken; fits a phone");
  await rAdminCtx.close();
  await page.goto(base + `/special?season=${seasonId}`);
  await page.locator(`h1:has-text('${seasonName}')`).waitFor();
  await page.locator(`#season li:has-text('Rookie${uniq}')`).waitFor();
  await page.locator(`.season-tabs .tab-active:has-text('${seasonName}')`).waitFor();
  await page.goto(base + "/special?season=all");
  await page.locator(".season-tabs .tab-active:has-text('ทุกซีซั่น')").waitFor();
  step("organizer made a season and pasted its players (a line without a UID is reported); the tournament form offers it; /special shows the season and its list");

  // Predictions: a tournament with an open match; the member takes the daily coins, picks a team, wins,
  // and the organizer gives them a shop code from the pool.
  const pt = await apiCall("POST", "/tournaments", { name: `Predict ${uniq}`, startDate: new Date(Date.now() + 86400_000).toISOString(), format: "SINGLE_ELIMINATION", registrationOpen: true, rosterMin: 1, rosterMax: 3 });
  const pReg = (name, n) => apiCall("POST", `/tournaments/${pt.id}/registrations`, { teamName: `${name} ${uniq}`, captainDiscordId: `71${uniq}0000${n}`, players: [{ name: `${name}P-${uniq}`, discordId: `71${uniq}0000${n}` }] });
  const pA = await pReg("Hawks", 1);
  const pB = await pReg("Wolves", 2);
  await apiCall("POST", `/tournaments/${pt.id}/bracket/seed`, { method: "manual", order: [pA.id, pB.id] });
  await apiCall("POST", `/tournaments/${pt.id}/bracket/start`, {});
  await apiCall("POST", `/tournaments/${pt.id}/bracket/schedule`, { match: "M1", scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
  await page.goto(base + `/tournaments/${pt.id}`);
  await page.click("a:has-text('ทายผลรายการนี้')");
  await page.waitForURL(new RegExp(`/predict\\?t=${pt.id}$`));
  await page.click("button:has-text('รับ 120 เหรียญวันนี้')");
  await page.locator(".predict-daily .success:has-text('รับ 120 เหรียญแล้ว')").waitFor();
  const card = page.locator(".market-card:has-text('คู่ที่ 1')");
  const seriesForm = card.locator(":scope > form.pick-form");
  await seriesForm.locator(`label:has-text('Hawks ${uniq}')`).click();
  await seriesForm.locator('input[name="amount"]').fill("100000");
  if (await seriesForm.locator('input[name="amount"]').evaluate((el) => el.checkValidity())) throw new Error("more coins than the member has is accepted");
  await seriesForm.locator('input[name="amount"]').fill("30");
  await seriesForm.locator("button:has-text('ทายเลย')").click();
  await seriesForm.locator(".success:has-text('ทายแล้ว เหลือ 90 เหรียญ')").waitFor();
  // A BO3: each game is picked on its own, under the match.
  await card.locator(".market-games summary:has-text('ทายรายเกม · 3 เกม')").click();
  const game1 = card.locator(".market-game").filter({ has: page.locator("strong", { hasText: /^เกม 1$/ }) });
  await game1.locator(`label:has-text('Hawks ${uniq}')`).click();
  await game1.locator('input[name="amount"]').fill("10");
  await game1.locator("button:has-text('ทายเลย')").click();
  await game1.locator(".success:has-text('ทายแล้ว เหลือ 80 เหรียญ')").waitFor();
  await page.reload();
  await page.locator(".market-card:has-text('คู่ที่ 1') > .market-mine:has-text('30 เหรียญ')").waitFor();
  await page.locator(".market-card:has-text('คู่ที่ 1') .market-game .market-mine:has-text('10 เหรียญ')").waitFor();
  await page.screenshot({ path: OUT + "/predict.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("/predict is wider than a phone screen");
  await page.screenshot({ path: OUT + "/predict-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  // Someone else backs the other team; Hawks win.
  const rival = `72${uniq}000001`;
  await apiCall("POST", `/predict/members/${rival}/daily`, { name: "Rival" });
  const market = (await apiCall("GET", `/predict/tournaments/${pt.id}`)).markets.find((m) => m.kind === "MATCH");
  await apiCall("POST", `/predict/members/${rival}/bets`, { marketId: market.id, teamId: pB.id, amount: 20 });
  const rivalGame1 = (await apiCall("GET", `/predict/tournaments/${pt.id}`)).markets.find((m) => m.kind === "GAME" && m.game === 1);
  await apiCall("POST", `/predict/members/${rival}/bets`, { marketId: rivalGame1.id, teamId: pB.id, amount: 10 });
  // The stream overlay (vMix / OBS): the open match with the split and the payout per side.
  const ov = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  ov.on("pageerror", (e) => problems.push(`pageerror: ${e.message} @ ${ov.url()}`));
  await ov.goto(base + `/overlay/predict?t=${pt.id}`);
  await ov.locator("#card.show #nameA:has-text('Hawks')").waitFor();
  await ov.locator("#ratioA:has-text('x1.66')").waitFor();
  await ov.locator("#ratioB:has-text('x2.50')").waitFor();
  await ov.locator("#state.open:has-text('ทายได้อีก')").waitFor();
  if ((await ov.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== "rgba(0, 0, 0, 0)") throw new Error("the overlay background is not transparent");
  await ov.waitForTimeout(1200);
  await ov.screenshot({ path: OUT + "/overlay.png", omitBackground: true });
  await apiCall("POST", `/tournaments/${pt.id}/bracket/matches/M1/result`, { games: [{ scoreA: 21, scoreB: 12 }, { scoreA: 21, scoreB: 18 }] });
  await ov.locator("#banner.on:has-text('ชนะ! ทายถูก 1 คน')").waitFor({ timeout: 10000 });
  await ov.waitForTimeout(1200);
  await ov.screenshot({ path: OUT + "/overlay-result.png", omitBackground: true });
  await ov.goto(base + "/overlay/predict?preview=1&pos=top");
  await ov.locator("#card.show #nameA:has-text('Team Alpha')").waitFor();
  await ov.close();
  await page.reload();
  await page.locator(".market-card:has-text('คู่ที่ 1') > .market-mine:has-text('ได้ 50 เหรียญ')").waitFor();
  await page.locator(".market-card:has-text('คู่ที่ 1') .market-game .market-mine:has-text('ได้ 20 เหรียญ')").waitFor();
  await page.locator(`table tr:has-text('E2E Discord'):has-text('+30')`).first().waitFor();
  step("member took the daily coins, picked a team and game 1 of the BO3 on /predict (more coins than they have is refused), won the other side's coins on both; /predict fits a phone; the stream overlay shows the split, the payout per side and the result");

  const pAdminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pAdmin = await pAdminCtx.newPage();
  pAdmin.on("pageerror", (e) => problems.push(`pageerror: ${e.message} @ ${pAdmin.url()}`));
  await pAdmin.goto(base + LOGIN);
  await pAdmin.fill('input[name="password"]', PASSWORD);
  await pAdmin.click("button:has-text('เข้าสู่ระบบ')");
  await pAdmin.waitForURL(base + "/admin");
  await pAdmin.click('.side-nav a[href="/admin/predict"]');
  await pAdmin.waitForURL(base + "/admin/predict");
  await pAdmin.fill('form:has-text("เพิ่มโค้ดเข้าคลัง") input[name="label"]', `ลด 50 ${uniq}`);
  await pAdmin.fill('form:has-text("เพิ่มโค้ดเข้าคลัง") textarea[name="text"]', `OT${uniq}AAA\nOT${uniq}BBB\nOT${uniq}AAA`);
  await pAdmin.click("button:has-text('+ เพิ่มโค้ด')");
  await pAdmin.locator(".success:has-text('เพิ่ม 2 โค้ด · ซ้ำ 1 โค้ด')").waitFor();
  await pAdmin.reload();
  const give = pAdmin.locator('form:has-text("แจกรางวัล")');
  await give.locator('input[name="title"]').fill(`อันดับ 1 Predict ${uniq}`);
  await give.locator('select[name="codeLabel"]').selectOption(`ลด 50 ${uniq}`);
  await give.locator('select[name="scope"]').selectOption(`t:${pt.id}`);
  await give.locator("button:has-text('แจกรางวัล')").click();
  await give.locator(".success:has-text('แจกรางวัลแล้ว 1 คน')").waitFor();
  await pAdmin.reload();
  await pAdmin.locator(`tr:has-text('อันดับ 1 Predict ${uniq}'):has-text('E2E Discord')`).waitFor();
  if ((await pAdmin.locator("main").textContent()).includes(`OT${uniq}`)) throw new Error("the admin page shows prize codes");
  await pAdmin.screenshot({ path: OUT + "/predict-admin.png", fullPage: true });
  await pAdminCtx.close();
  await page.goto(base + "/me");
  await page.locator(`#rewards li:has-text('อันดับ 1 Predict ${uniq}') .reward-code`).waitFor();
  if (!/^OT\d+(AAA|BBB)$/.test((await page.locator("#rewards .reward-code").first().textContent()).trim())) throw new Error("the winner does not see their code");
  step("organizer pasted shop codes (duplicates skipped) and gave one to the top predictor; only the winner sees the code, on /me");

  await page.goto(base + "/me");
  page.once("dialog", (d) => d.accept());
  await page.locator(".me-player:has-text('Ace')").locator("button:has-text('ยกเลิกการผูก')").click();
  await page.locator(".me-player:has-text('Ace')").waitFor({ state: "detached" });
  await page.click("button:has-text('ออกจากระบบ')");
  await page.waitForURL(base + "/");
  await page.locator('.nav a[href="/me"]:has-text("เข้าสู่ระบบ")').waitFor();
  if ((await page.request.post(base + "/api/upload", { multipart: { image: { name: "a.png", mimeType: "image/png", buffer: fs.readFileSync(LOGO) } } })).status() !== 401) throw new Error("upload open after player logout");
  step("player unlinked a profile and logged out");
}

await browser.close();
discordMock.close();
if (problems.length) {
  console.error("Problems found:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("\nAll end-to-end checks passed.");

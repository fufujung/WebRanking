// End-to-end check of the website in a real browser.
// Needs the API and website running with demo data (npm run setup && npm run dev), then: npm run test:e2e
// Env: BASE_URL (default http://localhost:3000), API_URL (default http://localhost:4000),
//      ADMIN_PASSWORD (default: read from apps/web/.env.local), CHROMIUM_PATH (optional browser binary).
import { chromium } from "playwright";
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
const LOGO = path.join(here, "fixture-logo.png");
const SHOT = path.join(here, "fixture-result.png");
const SELF = fileURLToPath(import.meta.url);
const OUT = path.join(here, "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message} @ ${page.url()}`));
page.on("console", (m) => {
  if (m.type() === "error" && !page.url().includes("does-not-exist")) problems.push(`console: ${m.text()} @ ${page.url()}`);
});
page.on("response", (r) => {
  if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
});
const step = (s) => console.log("✓", s);
const uniq = Date.now().toString().slice(-5);

console.log("— Public pages");
const paths = ["/", "/rankings", "/rankings?min=1", "/rankings/players", "/rankings/players?sort=ppg", "/teams", "/players", "/tournaments", "/tournaments?status=ONGOING", "/matches", "/search?q=tiger", "/search", "/admin/login"];
for (const p of paths) {
  await page.goto(base + p);
  await page.waitForLoadState("networkidle");
  const h1 = await page.locator("h1").first().textContent();
  console.log(p, "→", h1);
}
await page.goto(base + "/");
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
await page.goto(base + "/admin");
if (!page.url().includes("/admin/login")) throw new Error("admin not protected");
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
step("logged in");

// Tournament
await page.goto(base + "/admin/tournaments/new");
await page.fill('input[name="name"]', `E2E Cup ${uniq}`);
await page.fill('input[name="game"]', "Valorant");
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
const aiBtn = page.locator("button:has-text('ให้ AI อ่าน')");
step("AI read button present, disabled without key: " + (await aiBtn.isDisabled()));
await page.click("button:has-text('ใช้รูปนี้แล้วกรอกเอง')");
const game = (n) => page.locator(`section[aria-label="เกม ${n}"]`);
await game(1).waitFor();
const names1 = await game(1).locator('input[list]').evaluateAll((els) => els.map((e) => e.value));
if (names1.length !== 6) throw new Error("expected 3 rows per side, got " + names1.length);
for (const n of [`P01-${uniq}`, `P02-${uniq}`, `P11-${uniq}`, `P12-${uniq}`]) if (!names1.includes(n)) throw new Error(`roster ${n} not filled: ${names1}`);
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

// Player ranking
await page.goto(base + "/rankings/players?sort=mvp");
if (!(await page.locator("tbody").textContent()).includes(`P01-${uniq}`)) throw new Error("MVP player missing from ranking");
step("player ranking by MVP lists the player");

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
await page.waitForURL(/\/admin\?deleted=1/);
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
const draft = await page.locator(".bracket").first().textContent();
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
await page.locator('label:has-text("UID") input').nth(0).fill("812345678");
await page.locator('label:has-text("Server") input').nth(0).fill("Asia");
await page.click("button:has-text('+ เพิ่มผู้เล่น')");
await rosterInputs.nth(1).fill("Lynx");
await page.click("button:has-text('+ เพิ่มผู้เล่น')");
await rosterInputs.nth(2).fill("Moss");
await page.click("button:has-text('บันทึกรายชื่อ')");
await page.locator("tr", { hasText: "Night Owls" }).locator("td", { hasText: "Kite (UID 812345678 · Asia), Lynx, Moss" }).waitFor();
step("roster saved for Night Owls, with UID and server");

// Logout
await page.click("button:has-text('ออกจากระบบ')");
await page.waitForURL(base + "/");
await page.goto(base + "/admin/matches/new");
if (!page.url().includes("/admin/login")) throw new Error("still logged in");
step("logged out");


await browser.close();
if (problems.length) {
  console.error("Problems found:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("\nAll end-to-end checks passed.");

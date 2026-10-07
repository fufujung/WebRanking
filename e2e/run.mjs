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
const paths = ["/", "/rankings", "/rankings?min=1", "/rankings/players", "/rankings/players?sort=kda", "/teams", "/players", "/tournaments", "/tournaments?status=ONGOING", "/matches", "/search?q=tiger", "/search", "/admin/login"];
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
await page.fill('input[name="startDate"]', "2026-10-01");
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

// Record a match
await page.goto(base + "/admin/matches/new");
const cupValue = await page.locator("option", { hasText: `E2E Cup ${uniq}` }).getAttribute("value");
await page.selectOption("select >> nth=0", cupValue);
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
const rows = await page.locator("tbody tr").count();
if (rows !== 4) throw new Error("expected roster of 4 players, got " + rows);
step("roster auto-filled after choosing teams (4 rows), same team excluded");

// Submit without scores
await page.click("button:has-text('บันทึกผลการแข่ง')");
await page.waitForSelector("[role=alert]");
step("missing score rejected: " + (await page.textContent("[role=alert]")));

await page.fill('input[aria-label="สกอร์ทีม A"]', "13");
await page.fill('input[aria-label="สกอร์ทีม B"]', "8");
await page.fill('input[placeholder="เช่น รอบแบ่งกลุ่ม, Final"]', "Final");
const statInputs = page.locator('tbody input[inputmode="numeric"]');
const n = await statInputs.count();
for (let i = 0; i < n; i++) await statInputs.nth(i).fill(String(10 + i));
// letters are stripped
await statInputs.nth(0).fill("1a2");
if ((await statInputs.nth(0).inputValue()) !== "12") throw new Error("non-digits not stripped");
// one player did not play
await page.locator('tbody input[type="checkbox"]').nth(3).uncheck();
await dropFile(".drop", SHOT, "image/png");
await page.waitForSelector(".drop img");
const aiBtn = page.locator("button:has-text('ให้ AI อ่านผลจากรูป')");
step("AI read button present, disabled without key: " + (await aiBtn.isDisabled()));
await page.screenshot({ path: OUT + "/match-form.png", fullPage: true });
await page.click("button:has-text('บันทึกผลการแข่ง')");
await page.waitForURL(/\/matches\/[^/]+$/);
const score = await page.textContent(".score");
if (!score.includes("13") || !score.includes("8")) throw new Error("bad score " + score);
const statRows = await page.locator("tbody tr").count();
if (statRows !== 3) throw new Error("expected 3 stat lines, got " + statRows);
if (!(await page.locator("img.shot").evaluate((el) => el.complete && el.naturalWidth > 0))) throw new Error("screenshot missing");
const matchUrl = page.url();
await page.screenshot({ path: OUT + "/match-saved.png", fullPage: true });
step("match saved: score, 3 stat lines, screenshot shown");

// Edit match: flip result
await page.click("a:has-text('แก้ไขผลการแข่ง')");
await page.waitForURL(/\/admin\/matches\//);
const keptRows = await page.locator('tbody input[type="checkbox"]:checked').count();
if (keptRows !== 3) throw new Error("edit form should load 3 played rows, got " + keptRows);
await page.fill('input[aria-label="สกอร์ทีม A"]', "5");
await page.click("button:has-text('บันทึกการแก้ไข')");
await page.waitForURL(matchUrl);
const t2 = await page.locator(".hero").textContent();
if (!t2.includes("5 : 8")) throw new Error("edit not saved: " + t2);
step("match edited (5 : 8)");

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

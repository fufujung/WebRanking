// Isolated admin regression: never uses the development database or real Discord.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createHmac } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-management-browser-"));
const output = path.join(root, "e2e/screenshots/tournament-management");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, "test.db"), "");
const env = { ...process.env, DATABASE_URL: `file:${path.join(tmp, "test.db").replaceAll("\\", "/")}`, UPLOAD_DIR: path.join(tmp, "uploads"), DISCORD_WEBHOOK_URL: "", ANTHROPIC_API_KEY: "", ADMIN_PATH: "", SESSION_SECRET: "isolated-tournament-management-browser", COOKIE_SECURE: "false", NEXT_DIST_DIR: ".next-management-test" };
const children = [];
let browser;
function child(args, cwd, overrides = {}) {
  const proc = spawn(process.execPath, args, { cwd, env: { ...env, ...overrides }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.push(proc);
  proc.stdout.on("data", (d) => fs.appendFileSync(path.join(tmp, "servers.log"), d));
  proc.stderr.on("data", (d) => fs.appendFileSync(path.join(tmp, "servers.log"), d));
  return proc;
}
async function availablePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}
try {
  execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], { cwd: path.join(root, "apps/api"), env, stdio: "ignore" });
  const api = child(["--import", "tsx", "--input-type=module", "-e", `
    const {prisma}=await import('./src/lib/db.ts');
    const {createApiKey}=await import('./src/lib/apiKeys.ts');
    const {createApp}=await import('./src/app.ts');
    const {startTournamentStatusPoller}=await import('./src/lib/tournamentStatus.ts');
    startTournamentStatusPoller();
    const {seedDevAccounts}=await import('./prisma/devAccounts.ts');
    await prisma.$transaction(seedDevAccounts);
    const game=await prisma.game.findUniqueOrThrow({where:{name:"Kuroko's Basketball: Street Rivals"}});
    const key=(await createApiKey('browser','admin')).key;
    const t=await prisma.tournament.create({data:{name:'Browser Cup',startDate:new Date('2027-01-01'),description:'Original'}});
    const live=await prisma.tournament.create({data:{name:'Live Cup',startDate:new Date('2027-01-01'),format:'SINGLE_ELIMINATION',bracketStatus:'LIVE',status:'ONGOING'}});
    const special=await prisma.tournament.create({data:{name:'Special browser cup',special:true,gameId:game.id,startDate:new Date('2027-01-01'),format:null}});
    const completed=await prisma.tournament.create({data:{name:'Completed settings regression',status:'COMPLETED',registrationOpen:true,startDate:new Date('2027-01-01'),format:'SINGLE_ELIMINATION'}});
    const legacy=await prisma.tournament.create({data:{name:'Legacy special settings regression',special:true,gameId:game.id,status:'COMPLETED',bracketStatus:'DRAFT',maxTeams:8,startDate:new Date('2027-01-01'),format:'SINGLE_ELIMINATION'}});
    for(let i=0;i<3;i++) {const team=await prisma.team.create({data:{name:'Legacy browser team '+i,gameId:game.id}});await prisma.tournamentEntry.create({data:{tournamentId:legacy.id,teamId:team.id}});}
    const server=createApp().listen(0,'127.0.0.1',()=>console.log('FIXTURE '+JSON.stringify({key,id:t.id,liveId:live.id,specialId:special.id,completedId:completed.id,legacyId:legacy.id,port:server.address().port})));
  `], path.join(root, "apps/api"));
  const fixture = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("API startup timeout")), 30000);
    api.stdout.on("data", (d) => {
      buffer += d;
      const match = /FIXTURE (.+)\r?\n/.exec(buffer);
      if (match) { clearTimeout(timer); resolve(JSON.parse(match[1])); }
    });
    api.on("exit", (code) => { clearTimeout(timer); reject(new Error(`API exited ${code}`)); });
  });
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const web = child([path.join(root, "node_modules/next/dist/bin/next"), "dev", "-p", String(port), "-H", "127.0.0.1"], path.join(root, "apps/web"), { API_URL: `http://127.0.0.1:${fixture.port}`, API_KEY: fixture.key });
  for (let i = 0; i < 90; i++) {
    if (web.exitCode !== null) throw new Error("Web server exited");
    try { if ((await fetch(base + "/admin/login")).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const expires = String(Date.now() + 3600000);
  const signature = createHmac("sha256", env.SESSION_SECRET).update(expires).digest("hex");
  await context.addCookies([{ name: "tr_admin", value: `${expires}.${signature}`, url: base }]);
  const page = await context.newPage();
  await page.goto(base + "/admin/tournaments");
  await page.locator(`a[href="/admin/tournaments/${fixture.id}#settings"]`).click();
  const settings = page.locator('[data-topic-panel="settings"]');
  await settings.waitFor({ state: "visible" });
  await settings.locator('[name="name"]').fill("Browser Cup edited");
  await settings.locator('[name="description"]').fill("");
  await settings.locator('[name="endDate"]').fill("2026-01-01");
  await settings.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
  await settings.locator(".error").waitFor();
  assert.equal(await settings.locator('[name="name"]').inputValue(), "Browser Cup edited");
  await settings.locator('[name="endDate"]').fill("");
  await settings.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
  await page.waitForURL(/saved=1#settings$/);
  await settings.waitFor({ state: "visible" });
  await page.locator(".success").waitFor();
  const publicPage = await context.newPage();
  await publicPage.goto(`${base}/tournaments/${fixture.id}`);
  await publicPage.getByRole("heading", { level: 1, name: "Browser Cup edited" }).waitFor();
  await publicPage.close();
  for (const [name, width] of [["desktop", 1280], ["mobile", 390]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflow`);
  }
  await page.goto(`${base}/admin/tournaments/${fixture.liveId}#settings`);
  await settings.waitFor({ state: "visible" });
  for (const field of ["gameId", "status", "format", "bestOf", "finalBestOf", "entryMode", "registrationOpen", "lateMinutes"]) {
    assert.equal(await settings.locator(`[name="${field}"]`).isDisabled(), true, field);
  }
  await settings.locator('[name="location"]').fill("Online updated");
  await settings.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
  await page.waitForURL(/saved=1#settings$/);
  assert.equal(await settings.locator('[name="location"]').inputValue(), "Online updated");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/admin/tournaments/${fixture.specialId}#draw`);
  const editor = page.locator('[data-topic-panel="register"]');
  await editor.getByRole("heading", { name: "จัดทีมเล่นเก่งปากเก่ง · 2 ฝั่ง" }).waitFor();
  assert.equal(await editor.locator("fieldset").count(), 2);
  await editor.getByLabel("ชื่อทีม A", { exact: true }).fill("Browser side A");
  await editor.getByLabel("ชื่อทีม B", { exact: true }).fill("Browser side B");
  const first = editor.getByLabel("เลือกผู้เล่น A ช่อง 1", { exact: true });
  const pickedId = await first.locator("option").nth(1).getAttribute("value");
  await first.selectOption(pickedId);
  await editor.getByLabel("ผู้เล่น B ช่อง 2", { exact: true }).fill("Typed browser player");
  await editor.getByRole("button", { name: "บันทึกทีมทั้งสองฝั่ง", exact: true }).click();
  await editor.getByRole("status").waitFor();
  await page.reload();
  assert.equal(await editor.getByLabel("เลือกผู้เล่น A ช่อง 1", { exact: true }).inputValue(), pickedId);
  assert.equal(await editor.getByLabel("ผู้เล่น B ช่อง 2", { exact: true }).inputValue(), "Typed browser player");
  assert.equal(await editor.getByLabel("ผู้เล่น A ช่อง 2", { exact: true }).inputValue(), "");
  await editor.getByRole("button", { name: "สุ่มเติมทุกช่องว่าง", exact: true }).click();
  assert.equal(await editor.getByLabel("เลือกผู้เล่น A ช่อง 1", { exact: true }).inputValue(), pickedId);
  assert.equal(await editor.getByLabel("ผู้เล่น B ช่อง 2", { exact: true }).inputValue(), "Typed browser player");
  await editor.getByRole("button", { name: "บันทึกทีมทั้งสองฝั่ง", exact: true }).click();
  await editor.getByRole("status").waitFor();
  const rosterNames = await editor.locator('input[placeholder="พิมพ์ชื่อผู้เล่น"]').evaluateAll((inputs) => inputs.map((input) => input.value));
  assert.equal(new Set(rosterNames).size, 6);
  assert.ok(rosterNames.every(Boolean));
  for (const [name, width] of [["desktop", 1280], ["mobile", 390]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: path.join(output, `special-${name}.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `special ${name} overflow`);
  }
  console.log("Passed: edit entry point, validation retains input, save retains tab, public refresh, mobile overflow, live locks and safe edits.");
  console.log("Passed: special two-side slots, typed/picked players, partial save/reload, random fills only blanks, unique players and responsive layout.");
  await page.goto(`${base}/admin/tournaments/${fixture.specialId}#predict`);
  await page.locator('[data-topic-panel="predict"] [data-market]').waitFor();
  await page.locator('[data-topic-panel="predict"] [data-market]').getByText(/Browser side A vs Browser side B/).waitFor();
  // The simple "open predictions" form: two teams, BO3, one button; then each round's winner, and the match closes at 2.
  // A full load: the hash-only jump above keeps the router's older #address, which a server action would restore.
  await page.reload();
  const predictPanel = page.locator('[data-topic-panel="predict"]');
  for (const [side, team] of [["ทีม A", "Browser side A"], ["ทีม B", "Browser side B"]]) {
    await predictPanel.getByRole("combobox", { name: side, exact: true }).fill(team);
    await predictPanel.getByRole("option", { name: team }).first().click();
  }
  await predictPanel.getByRole("radio", { name: "BO3 (3 รอบ)" }).click();
  await predictPanel.locator("summary", { hasText: "ตัวเลือกเพิ่มเติม" }).click();
  await predictPanel.locator('input[name="label"]').fill("E2E BO3");
  await predictPanel.getByRole("button", { name: "🎯 เปิดทาย", exact: true }).click();
  const bo3 = predictPanel.locator("[data-market]", { hasText: "E2E BO3" });
  await bo3.locator('[data-round="1"]').getByText("🟢 เปิดทายอยู่").waitFor();
  await bo3.locator('[data-round="2"]').getByText("⏳ รอรอบก่อนหน้า").waitFor();
  await page.screenshot({ path: path.join(output, "predict-rounds-admin.png"), fullPage: true });
  await bo3.getByRole("button", { name: "🏁 Browser side A ชนะรอบนี้" }).click();
  await bo3.locator('[data-round="2"]').getByText("🟢 เปิดทายอยู่").waitFor();
  await bo3.getByRole("button", { name: "🏁 Browser side A ชนะรอบนี้" }).click();
  await bo3.locator(".predict-score", { hasText: "2 – 0" }).waitFor();
  await bo3.getByText("✅ Browser side A ชนะ", { exact: false }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "predict admin mobile overflow");
  await page.screenshot({ path: path.join(output, "predict-rounds-admin-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  console.log("Passed: open a BO3 pair in two clicks, rounds open one at a time, the match closes once a team wins 2.");
  await page.goto(`${base}/predict?t=${fixture.specialId}`);
  await page.getByText("Browser side A", { exact: true }).first().waitFor();
  await page.getByText("Browser side B", { exact: true }).first().waitFor();
  await page.getByText("เปิดทาย", { exact: true }).first().waitFor();
  console.log("Passed: free-form special prediction pair appears automatically in admin and public prediction pages.");
  const scheduled = await fetch(`http://127.0.0.1:${fixture.port}/api/v1/tournaments/${fixture.id}`, {
    method: "PATCH", headers: { "X-API-Key": fixture.key, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: new Date(Date.now() + 5000).toISOString() }),
  });
  assert.equal(scheduled.status, 200);
  await page.goto(`${base}/tournaments/${fixture.id}`);
  await page.getByText("กำลังแข่ง", { exact: true }).first().waitFor({ timeout: 30000 });
  console.log("Passed: an open tournament page automatically updates to ongoing at the scheduled time.");
  for (const id of [fixture.completedId, fixture.legacyId]) {
    await page.goto(`${base}/admin/tournaments/${id}#settings`);
    await settings.waitFor({ state: "visible" });
    await settings.locator('[name="description"]').fill("Updated historical details");
    await settings.locator('[name="location"]').fill("Historical venue updated");
    await settings.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
    await page.waitForURL(/saved=1#settings$/);
    await page.locator(".success").waitFor();
    const detail = await fetch(`http://127.0.0.1:${fixture.port}/api/v1/tournaments/${id}`, { headers: { "X-API-Key": fixture.key } }).then((r) => r.json());
    assert.equal(detail.status, "COMPLETED");
    assert.equal(detail.description, "Updated historical details");
    if (id === fixture.legacyId) { assert.equal(detail.teams.length, 3); assert.equal(detail.maxTeams, 8); assert.equal(detail.bracketStatus, "DRAFT"); }
  }
  console.log("Passed: full settings forms save completed events and legacy special events without changing status, capacity or historical teams.");
} catch (error) {
  console.error(`Server logs: ${path.join(tmp, "servers.log")}`);
  throw error;
} finally {
  await browser?.close();
  for (const proc of children.reverse()) {
    proc.kill();
    if (proc.exitCode === null) await new Promise((r) => proc.once("exit", r));
  }
  const configPath = path.join(root, "apps/web/tsconfig.json");
  const config = fs.readFileSync(configPath, "utf8");
  fs.writeFileSync(configPath, config.replace(/,\r?\n\s*"\.next-management-test(?:\/dev)?\/types\/\*\*\/\*\.ts"/g, ""));
  const buildPath = path.resolve(root, "apps/web/.next-management-test");
  if (path.dirname(buildPath) !== path.resolve(root, "apps/web") || path.basename(buildPath) !== ".next-management-test") throw new Error("Unexpected test output path");
  fs.rmSync(buildPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

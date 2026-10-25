// Auto-deploy on the server. A scheduled task runs this every few minutes:
//   node C:\theranking\deploy\auto-deploy.mjs          normal run (skips Bank's stream hours)
//   node C:\theranking\deploy\auto-deploy.mjs --now    deploy now, even in stream hours or a build that failed before
//   node C:\theranking\deploy\auto-deploy.mjs --check  only say what it would do
// It looks at the "live-build" release that GitHub Actions publishes after CI passes on main.
// When that build is newer than what runs here it: downloads and checks it, holds the site, backs up
// the code and database, swaps in the new code, reinstalls packages / updates the database only when
// needed, starts the site and checks it answers. If anything fails it puts the old version back.
// Create C:\theranking-deploy\PAUSE to stop auto-deploys; delete it to resume.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  APPS,
  BUILD_DIRS,
  fileHash,
  inQuietHours,
  isProtected,
  isWindows,
  readZip,
  safeRel,
  settings,
  sha256,
  sleep,
  walk,
  writeFile,
} from "./lib.mjs";

const args = new Set(process.argv.slice(2));
const now = args.has("--now");
const checkOnly = args.has("--check");
const cfg = settings();
const statePath = path.join(cfg.stateDir, "state.json");
const holdPath = path.join(cfg.stateDir, "HOLD");
fs.mkdirSync(cfg.stateDir, { recursive: true });

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  fs.appendFileSync(path.join(cfg.stateDir, "deploy.log"), `${text}\n`);
}

async function notify(text) {
  if (!cfg.discordWebhook) return;
  try {
    await fetch(cfg.discordWebhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    log(`discord notify failed: ${err.message}`);
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}
const saveState = (state) => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

async function getJson(url) {
  const res = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": "theranking-deploy" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function download(asset) {
  // Only files GitHub Actions uploaded are trusted, never something added to the release by hand.
  if (asset.uploader?.login !== cfg.uploader) throw new Error(`${asset.name} was not uploaded by ${cfg.uploader}`);
  const res = await fetch(asset.browser_download_url, {
    headers: { "user-agent": "theranking-deploy" },
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`${asset.name}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---- stopping and starting the apps (deploy/run.mjs keeps each one running) ----

function readPid(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cfg.stateDir, `${name}.pid`), "utf8"));
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function killTree(pid) {
  try {
    if (isWindows) execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {}
}

async function stopAll() {
  fs.writeFileSync(holdPath, new Date().toISOString());
  // Kill until every app has stayed down for longer than run.mjs waits before a restart, so one
  // that was restarting at the moment HOLD appeared is caught too.
  const quiet = cfg.restartDelayMs + 2000;
  let downSince = Date.now();
  for (const deadline = Date.now() + 120_000; Date.now() < deadline; await sleep(250)) {
    let running = false;
    for (const name of Object.keys(APPS)) {
      const p = readPid(name);
      if (p && alive(p.pid)) {
        running = true;
        killTree(p.pid);
      }
    }
    if (running) downSince = Date.now();
    else if (Date.now() - downSince > quiet) return;
  }
  throw new Error("could not stop the apps");
}

const release = () => fs.rmSync(holdPath, { force: true });

async function status(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "manual" });
    return res.status;
  } catch {
    return 0;
  }
}
const ok = async (url) => (await status(url)) === 200;

/**
 * The API is ready when /health/ready says so: start-up finished and the database answers with the
 * schema this code expects. A version from before that address existed (404) is checked with /health.
 */
async function apiReady() {
  const ready = cfg.apiReady ?? cfg.apiHealth.replace(/\/health$/, "/health/ready");
  const code = await status(ready);
  return code === 200 || (code === 404 && (await ok(cfg.apiHealth)));
}

async function waitHealthy(since) {
  const deadline = Date.now() + cfg.healthTimeoutMs;
  for (;;) {
    const bot = readPid("bot");
    if ((await apiReady()) && (await ok(cfg.webHealth)) && bot && bot.startedAt >= since && alive(bot.pid)) break;
    if (Date.now() > deadline) throw new Error("the site did not come back (API not ready, or the home page or the bot)");
    await sleep(2000);
  }
  // The bot has no web address: it counts as working when it is still the same process a while later.
  const bot = readPid("bot");
  await sleep(cfg.botSteadyMs);
  const later = readPid("bot");
  if (!alive(bot.pid) || later?.pid !== bot.pid) throw new Error("the bot keeps crashing");
  if (!(await apiReady()) || !(await ok(cfg.webHealth))) throw new Error("the site stopped answering");
}

// ---- holding writes while a new version is checked ----
// The apps start (so they can be checked) but the API refuses anything that saves (lib/lifecycle.ts)
// until the version is accepted. A rollback that puts the old database back therefore loses nothing
// anyone saved. Older versions without the gate simply ignore the file.

const gatePath = path.join(cfg.stateDir, "WRITE_GATE");
const holdWrites = () => fs.writeFileSync(gatePath, new Date().toISOString());
const allowWrites = () => fs.rmSync(gatePath, { force: true });

// ---- what an unfinished deploy left behind ----
// progress.json is written before the first change and updated at every step, so a deploy that was
// killed half way (power cut, reboot) is finished or undone by the next run instead of leaving the
// site stopped or half copied.

const progressPath = path.join(cfg.stateDir, "progress.json");
const saveProgress = (p) => fs.writeFileSync(progressPath, JSON.stringify(p));
function readProgress() {
  try {
    return JSON.parse(fs.readFileSync(progressPath, "utf8"));
  } catch {
    return null;
  }
}
const clearProgress = () => fs.rmSync(progressPath, { force: true });

// ---- code on disk ----

const inApp = (rel) => path.join(cfg.appDir, rel);

function clearBuildDirs() {
  for (const dir of BUILD_DIRS) {
    for (const rel of walk(inApp(dir))) {
      const full = `${dir}/${rel}`;
      if (!isProtected(full)) fs.rmSync(inApp(full), { force: true });
    }
  }
}

function snapshotCode(to) {
  const files = walk(cfg.appDir, (rel) => isProtected(rel) || isProtected(`${rel}/`));
  for (const rel of files) writeFile(path.join(to, rel), fs.readFileSync(inApp(rel)));
  return files;
}

function applyFiles(entries, removeFiles) {
  clearBuildDirs();
  const keep = new Set(entries.map((e) => e.name));
  for (const rel of removeFiles) if (!keep.has(rel) && !isProtected(rel)) fs.rmSync(inApp(rel), { force: true });
  for (const { name, data } of entries) if (!isProtected(name)) writeFile(inApp(name), data);
}

const NODE_MODULES = ["node_modules", ...Object.values(APPS).map((a) => `${a.dir}/node_modules`)];

function run(command, what) {
  log(`${what}: ${command}`);
  // The scheduled task runs as SYSTEM, whose PATH may lack Node: put this Node's folder first.
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}` };
  delete env.NODE_ENV; // npm ci must install the dev tools too (prisma, tsx)
  execSync(command, { cwd: cfg.appDir, stdio: "inherit", env, timeout: 900_000 });
}

/**
 * The SQLite file the API really uses, from DATABASE_URL in apps/api/.env (Prisma resolves a relative
 * path against apps/api/prisma), with its -wal and -shm files. Anything that is not a SQLite file is
 * refused before the deploy changes anything: this script cannot back it up.
 */
function databaseFiles() {
  let url = "file:./dev.db";
  try {
    const line = fs
      .readFileSync(inApp("apps/api/.env"), "utf8")
      .split(/\r?\n/)
      .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
    if (line) url = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch {}
  if (!url.startsWith("file:")) throw new Error("DATABASE_URL is not a SQLite file; the auto-deploy cannot back it up");
  const file = path.resolve(inApp("apps/api/prisma"), url.slice(5).split("?")[0]);
  return [file, `${file}-wal`, `${file}-shm`];
}

/** Copies the database files into a backup folder (by file name). */
function backupDb(to) {
  const [db] = databaseFiles();
  if (!fs.existsSync(db)) throw new Error(`the database ${path.basename(db)} is missing`);
  for (const file of databaseFiles()) {
    const dst = path.join(to, path.basename(file));
    if (fs.existsSync(file)) writeFile(dst, fs.readFileSync(file));
  }
}

/** Puts a backed-up database back (and removes -wal/-shm the backup did not have). */
function restoreDb(from) {
  for (const file of databaseFiles()) {
    const src = path.join(from, path.basename(file));
    if (fs.existsSync(src)) writeFile(file, fs.readFileSync(src));
    else fs.rmSync(file, { force: true });
  }
}

function pruneBackups() {
  let dirs = [];
  try {
    dirs = fs
      .readdirSync(cfg.backupDir)
      .filter((d) => d.startsWith("auto-"))
      .sort();
  } catch {}
  for (const d of dirs.slice(0, Math.max(0, dirs.length - cfg.keepBackups))) {
    fs.rmSync(path.join(cfg.backupDir, d), { recursive: true, force: true });
  }
}

// ---- one deploy ----

async function deploy(manifest, zipAsset, state) {
  const short = manifest.sha.slice(0, 7);
  const unmanaged = Object.keys(APPS).filter((name) => !readPid(name));
  if (unmanaged.length) throw new Error(`${unmanaged.join(", ")} not started by deploy/run.mjs yet (see README)`);
  const zip = await download(zipAsset);
  if (zip.length !== manifest.size || sha256(zip) !== manifest.sha256) throw new Error("downloaded build is damaged");
  const entries = readZip(zip).map((e) => ({ name: safeRel(e.name), data: e.data }));
  if (entries.length !== manifest.files) throw new Error(`build has ${entries.length} files, expected ${manifest.files}`);
  const lockChanged = fileHash(inApp("package-lock.json")) !== manifest.lockHash;
  const schemaChanged = fileHash(inApp("apps/api/prisma/schema.prisma")) !== manifest.schemaHash;

  const started = Date.now();
  const stamp = new Date(started + 7 * 3600_000).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const backup = path.join(cfg.backupDir, `auto-${stamp}-${short}`);
  log(
    `deploying ${short} "${manifest.title ?? ""}" (packages ${lockChanged ? "change" : "same"}, database ${schemaChanged ? "changes" : "same"}); backup ${backup}`,
  );
  databaseFiles(); // a database this script cannot back up stops the deploy before anything changes
  const oldFiles = snapshotCode(path.join(backup, "code"));
  const progress = { sha: manifest.sha, stage: "backup", backup, oldFiles, newFiles: entries.map((e) => e.name), movedModules: [], ranSetup: false };
  saveProgress(progress);
  const step = (stage) => saveProgress(Object.assign(progress, { stage }));

  // Nothing has changed yet: if stopping or the database backup fails, the old version starts again.
  try {
    await stopAll();
    backupDb(path.join(backup, "db"));
  } catch (err) {
    log(`backup before the update failed, nothing was changed: ${err.stack ?? err}`);
    clearProgress();
    const since = Date.now();
    release();
    const back = await waitHealthy(since).then(
      () => "the previous version is running",
      (e) => `the previous version did not come back either: ${e.message}`,
    );
    log(back);
    throw new Error(`backup before the update failed, nothing was changed (${back}): ${err.message}`);
  }
  try {
    step("applying");
    if (lockChanged) {
      for (const rel of NODE_MODULES) {
        if (!fs.existsSync(inApp(rel))) continue;
        const to = path.join(backup, "modules", rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(inApp(rel), to);
        progress.movedModules.push(rel);
        step("applying");
      }
    }
    // Files an earlier auto-deploy put here and this build no longer has are removed. On the first
    // auto-deploy that list is unknown, so only the build folders are replaced.
    applyFiles(entries, state.files ?? []);
    if (lockChanged) run(cfg.installCommand ?? "npm ci --no-audit --no-fund", "installing packages");
    if (schemaChanged || lockChanged) {
      progress.ranSetup = true;
      step("applying");
      run(cfg.setupCommand ?? `"${process.execPath}" scripts/setup.mjs --no-demo`, "updating the database");
    }
    step("checking");
    holdWrites();
    const since = Date.now();
    release();
    await waitHealthy(since);
  } catch (err) {
    log(`deploy of ${short} failed: ${err.stack ?? err}`);
    await rollBack(progress);
    throw err;
  }

  // Accepted: from here on what people save stays.
  allowWrites();
  for (const rel of progress.movedModules) fs.rmSync(path.join(backup, "modules", rel), { recursive: true, force: true });
  saveState({
    sha: manifest.sha,
    title: manifest.title,
    deployedAt: new Date().toISOString(),
    files: entries.map((e) => e.name),
  });
  clearProgress();
  pruneBackups();
  const secs = Math.round((Date.now() - started) / 1000);
  log(`deployed ${short} in ${secs}s`);
  await notify(`✅ อัปเดตเว็บ The Ranking แล้ว: ${manifest.title ?? short} (\`${short}\`) ใช้เวลา ${secs} วินาที`);
}

async function rollBack({ backup, oldFiles, newFiles, movedModules, ranSetup }) {
  log("putting the previous version back");
  try {
    await stopAll();
    const code = path.join(backup, "code");
    const restore = oldFiles.map((rel) => ({ name: rel, data: fs.readFileSync(path.join(code, rel)) }));
    applyFiles(restore, newFiles);
    for (const rel of movedModules) {
      fs.rmSync(inApp(rel), { recursive: true, force: true });
      fs.renameSync(path.join(backup, "modules", rel), inApp(rel));
    }
    if (ranSetup) {
      // The database is put back only when this deploy changed it. Writes were held while the new
      // version was checked, so only data the new version derived itself is dropped; it is still kept.
      const failed = path.join(backup, "db-after-failed-deploy");
      backupDb(failed);
      restoreDb(path.join(backup, "db"));
      log(`database put back; the failed version's copy is kept in ${failed}`);
      // The database step also regenerated the Prisma client for the new schema. Packages that were
      // moved aside come back with their own client; otherwise build it again for the old schema.
      // /health/ready then runs real queries against the restored database before anything is accepted.
      if (!movedModules.length) run(cfg.generateCommand ?? "npm exec --workspace apps/api -- prisma generate", "rebuilding the database client");
    }
    const since = Date.now();
    release();
    await waitHealthy(since);
    allowWrites();
    clearProgress();
    log("previous version is running again");
  } catch (err) {
    // Leave nothing that keeps the site down or read-only; a person has to look at it now.
    release();
    allowWrites();
    clearProgress();
    log(`ROLLBACK FAILED: ${err.stack ?? err}`);
    await notify(`🚨 อัปเดตเว็บ The Ranking ไม่ผ่าน และย้อนกลับเองไม่สำเร็จ ต้องดูเครื่องด่วน (ไฟล์สำรองอยู่ที่ ${backup})`);
    throw err;
  }
}

/** A deploy was killed half way: undo what it changed (or just restart the untouched old version). */
async function recover(progress) {
  log(`finishing a deploy of ${progress.sha.slice(0, 7)} that stopped at "${progress.stage}"`);
  if (progress.stage === "backup") {
    clearProgress();
    allowWrites();
    const since = Date.now();
    release();
    await waitHealthy(since);
    log("nothing had changed; the previous version is running");
    return;
  }
  await rollBack(progress);
}

// ---- main ----

const lockPath = path.join(cfg.stateDir, "deploy.lock");
function takeLock() {
  try {
    const old = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (alive(old.pid) && Date.now() - old.at < 2 * 3600_000) return false;
  } catch {}
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }));
  return true;
}

async function main() {
  if (fs.existsSync(path.join(cfg.stateDir, "PAUSE"))) return;
  // A deploy that was killed half way is undone straight away, even in stream hours: the site is down.
  const unfinished = !checkOnly && readProgress();
  if (!unfinished && !now && !checkOnly && inQuietHours(cfg)) return; // stream hours: try again later, quietly
  if (!takeLock()) return log("another deploy is running");
  try {
    if (unfinished) {
      try {
        await recover(unfinished);
      } finally {
        saveState({ ...readState(), failedSha: unfinished.sha, failedAt: new Date().toISOString() });
      }
      return;
    }
    const rel = await getJson(`${cfg.githubApi}/repos/${cfg.repo}/releases/tags/${cfg.release}`);
    const manifestAsset = rel.assets?.find((a) => a.name === "manifest.json");
    if (!manifestAsset) throw new Error("the release has no manifest.json");
    const manifest = JSON.parse((await download(manifestAsset)).toString("utf8"));
    const state = readState();
    if (manifest.sha === state.sha) return;
    if (manifest.sha === state.failedSha && !now) return;
    const zipAsset = rel.assets.find((a) => a.name === manifest.bundle);
    if (!zipAsset) throw new Error(`the release has no ${manifest.bundle}`);
    if (checkOnly)
      return log(
        `would deploy ${manifest.sha.slice(0, 7)} "${manifest.title ?? ""}" (running ${state.sha?.slice(0, 7) ?? "unknown"})`,
      );
    try {
      await deploy(manifest, zipAsset, state);
    } catch (err) {
      log(`deploy of ${manifest.sha.slice(0, 7)} stopped: ${err.message}`);
      // Not tried again until a newer build comes (or someone runs --now), so Discord hears it once.
      saveState({ ...readState(), failedSha: manifest.sha, failedAt: new Date().toISOString() });
      await notify(
        `⚠️ อัปเดตเว็บ The Ranking ไม่ผ่าน (\`${manifest.sha.slice(0, 7)}\`) เว็บยังเป็นเวอร์ชันเดิม ใช้งานได้ตามปกติ\nสาเหตุ: ${String(err.message).slice(0, 300)}`,
      );
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

main().catch((err) => {
  log(`error: ${err.stack ?? err}`);
  process.exitCode = 1;
});

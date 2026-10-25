// Keeps one app (api, web or bot) running on the server: starts it, restarts it 5 s after it stops,
// and waits while the deploy holds the site (the HOLD file) so it never starts half-copied code.
// Started at boot by the scheduled tasks: node C:\theranking\deploy\run.mjs api
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { APPS, isWindows, settings, sleep } from "./lib.mjs";

const name = process.argv[2];
const app = APPS[name];
if (!app) {
  console.error(`usage: node deploy/run.mjs ${Object.keys(APPS).join("|")}`);
  process.exit(2);
}
const cfg = settings();
const hold = path.join(cfg.stateDir, "HOLD");
const pidFile = path.join(cfg.stateDir, `${name}.pid`);
const logFile = path.join(cfg.logDir, `${name}.log`);
fs.mkdirSync(cfg.stateDir, { recursive: true });
fs.mkdirSync(cfg.logDir, { recursive: true });

const note = (line) => fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`);

function rotate() {
  try {
    if (fs.statSync(logFile).size > 20e6) fs.renameSync(logFile, `${logFile}.1`);
  } catch {}
}

// A deploy holds for minutes at most. A HOLD older than 30 minutes was left by a deploy that died
// half way, and is ignored so the site never stays down because of it.
function held() {
  try {
    return Date.now() - fs.statSync(hold).mtimeMs < 30 * 60_000;
  } catch {
    return false;
  }
}

for (;;) {
  if (held()) {
    await sleep(1000);
    continue;
  }
  rotate();
  const out = fs.openSync(logFile, "a");
  note(`starting ${name}`);
  const child = spawn(process.execPath, [app.entry], {
    cwd: path.join(cfg.appDir, app.dir),
    // THERANKING_WRITE_GATE: the file the deploy creates while it checks a new version (lib/lifecycle.ts).
    env: { ...process.env, NODE_ENV: "production", THERANKING_WRITE_GATE: path.join(cfg.stateDir, "WRITE_GATE") },
    stdio: ["ignore", out, out],
    // On Linux (tests) the app gets its own process group so the deploy can stop it with its children.
    detached: !isWindows,
    windowsHide: true,
  });
  fs.writeFileSync(pidFile, JSON.stringify({ pid: child.pid, supervisor: process.pid, startedAt: Date.now() }));
  const code = await new Promise((resolve) => {
    child.on("exit", (c, signal) => resolve(c ?? signal));
    child.on("error", (err) => resolve(err.message));
  });
  fs.closeSync(out);
  note(`${name} exited (${code}), restarting in ${cfg.restartDelayMs / 1000}s`);
  await sleep(cfg.restartDelayMs);
}

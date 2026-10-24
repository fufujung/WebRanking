// Tests for the auto-deploy: a fake GitHub release and a fake site (api, web, bot) kept running by
// deploy/run.mjs, then real deploy runs against them: a good build, a broken build that must roll
// back, and a database change.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { inQuietHours, isProtected, readZip, safeRel, sha256, writeZip } from "./lib.mjs";

test("zip round trip keeps names and bytes", () => {
  const entries = [
    { name: "a.txt", data: Buffer.from("hello") },
    { name: "apps/web/.next/server/app/ตาราง/page.js", data: Buffer.from("x".repeat(5000)) },
    { name: "empty", data: Buffer.alloc(0) },
  ];
  const back = readZip(writeZip(entries));
  assert.deepEqual(
    back.map((e) => [e.name, e.data.toString()]),
    entries.map((e) => [e.name, e.data.toString()]),
  );
});

test("a damaged zip is refused", () => {
  const zip = writeZip([{ name: "a.txt", data: Buffer.from("hello hello hello") }]);
  zip[40] ^= 0xff;
  assert.throws(() => readZip(zip));
});

test("secrets, database, uploads and packages are never part of a deploy", () => {
  for (const p of [
    "apps/api/.env",
    "apps/web/.env.local",
    "apps/bot/.env",
    "apps/api/prisma/dev.db",
    "apps/api/prisma/dev.db-wal",
    "apps/api/uploads/logo.png",
    "apps/bot/data/guilds.json",
    "node_modules/next/package.json",
    "apps/web/node_modules/x.js",
    "apps/web/.next/cache/a",
    "logs/api.log",
  ]) {
    assert.equal(isProtected(p), true, p);
  }
  for (const p of ["apps/api/.env.example", "apps/api/dist/index.js", "apps/web/.next/BUILD_ID", "package.json"]) {
    assert.equal(isProtected(p), false, p);
  }
});

test("paths that leave the app folder are refused", () => {
  for (const p of ["../x", "a/../../x", "/etc/passwd", "C:/Windows/x", "a//b"]) assert.throws(() => safeRel(p), p);
  assert.equal(safeRel("apps\\api\\dist\\index.js"), "apps/api/dist/index.js");
});

test("stream hours are 18:00-24:00 Thai time", () => {
  const cfg = { quietHours: [18, 24] };
  assert.equal(inQuietHours(cfg, new Date("2026-10-24T10:59:00Z")), false); // 17:59
  assert.equal(inQuietHours(cfg, new Date("2026-10-24T11:00:00Z")), true); // 18:00
  assert.equal(inQuietHours(cfg, new Date("2026-10-24T16:59:00Z")), true); // 23:59
  assert.equal(inQuietHours(cfg, new Date("2026-10-24T17:00:00Z")), false); // 00:00
});

// ---- the whole deploy against a fake site ----

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "theranking-deploy-"));
const appDir = path.join(tmp, "app");
const stateDir = path.join(tmp, "state");
const env = { ...process.env, THERANKING_DEPLOY_DIR: stateDir };
const supervisors = [];
let github;
let release = { assets: [] };
const files = new Map();
let config;
let apiPort;
let webPort;

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// One version of the fake site. `broken` makes the API crash on start.
function site(version, { broken = false, schema = "v1" } = {}) {
  const server = (portVar) =>
    `const http = require("http");\n` +
    (broken ? `process.exit(1);\n` : "") +
    `http.createServer((q, r) => r.end("${version}")).listen(Number(process.env.${portVar}), "127.0.0.1");\n`;
  return {
    "package.json": `{"name":"fake","version":"${version}"}`,
    "package-lock.json": `{"lockfileVersion":3}`,
    "apps/api/prisma/schema.prisma": `// schema ${schema}`,
    "apps/api/dist/index.js": server("API_PORT"),
    "apps/api/package.json": `{"type":"commonjs"}`,
    "apps/bot/dist/index.js": `setInterval(() => {}, 1000);\n`,
    "apps/bot/package.json": `{"type":"commonjs"}`,
    "apps/web/balance.mjs": server("WEB_PORT").replace('const http = require("http");', 'import http from "node:http";'),
    "apps/web/.next/BUILD_ID": version,
    [`apps/web/.next/static/${version}.js`]: version,
    [`only-in-${version}.txt`]: version,
  };
}

function writeTree(dir, tree) {
  for (const [rel, text] of Object.entries(tree)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}

let shaCounter = 0;
// Publishes a build of `tree` on the fake release, the way the GitHub workflow does.
function publish(tree, { uploader = "github-actions[bot]" } = {}) {
  const sha = String(++shaCounter).padStart(40, "a");
  const deployFiles = Object.fromEntries(
    fs.readdirSync(import.meta.dirname).map((f) => [`deploy/${f}`, fs.readFileSync(path.join(import.meta.dirname, f))]),
  );
  const entries = Object.entries({ ...tree, ...deployFiles }).map(([name, data]) => ({ name, data: Buffer.from(data) }));
  const zip = writeZip(entries);
  const manifest = {
    sha,
    title: `build ${sha.slice(-2)}`,
    bundle: `theranking-${sha.slice(0, 12)}.zip`,
    size: zip.length,
    sha256: sha256(zip),
    files: entries.length,
    lockHash: sha256(Buffer.from(tree["package-lock.json"])),
    schemaHash: sha256(Buffer.from(tree["apps/api/prisma/schema.prisma"])),
  };
  files.set(manifest.bundle, zip);
  files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  const base = `http://127.0.0.1:${github.address().port}/download/`;
  release = {
    assets: [manifest.bundle, "manifest.json"].map((name) => ({
      name,
      browser_download_url: base + name,
      uploader: { login: uploader },
    })),
  };
  return manifest;
}

// Runs the deploy as the server's scheduled task would (asynchronously: the fake GitHub lives in
// this process and has to answer it).
function deploy(...flags) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(appDir, "deploy/auto-deploy.mjs"), ...flags], { env }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` }),
    );
  });
}
const deployNow = () => deploy("--now");

const get = async (port) => (await fetch(`http://127.0.0.1:${port}/`)).text();
const state = () => JSON.parse(fs.readFileSync(path.join(stateDir, "state.json"), "utf8"));

async function waitFor(check, ms = 20_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) {
    try {
      if (await check()) return;
    } catch {}
  }
  throw new Error("timed out");
}

before(async () => {
  github = http
    .createServer((req, res) => {
      if (req.url === "/repos/fufujung/WebRanking/releases/tags/live-build") return res.end(JSON.stringify(release));
      const file = files.get(req.url.replace("/download/", ""));
      if (!file) return res.writeHead(404).end();
      res.end(file);
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => github.once("listening", r));
  apiPort = await freePort();
  webPort = await freePort();
  env.API_PORT = String(apiPort);
  env.WEB_PORT = String(webPort);

  // What is on the server before the first auto-deploy: version v1 plus the server's own files.
  writeTree(appDir, site("v1"));
  fs.cpSync(import.meta.dirname, path.join(appDir, "deploy"), { recursive: true });
  writeTree(appDir, {
    "apps/api/.env": "SECRET=keep",
    "apps/api/prisma/dev.db": "db-v1",
    "apps/api/uploads/logo.png": "logo",
    "apps/bot/data/guilds.json": "[1]",
    "run-api.cmd": "server-only file",
  });
  config = {
    githubApi: `http://127.0.0.1:${github.address().port}`,
    apiHealth: `http://127.0.0.1:${apiPort}/health`,
    webHealth: `http://127.0.0.1:${webPort}/`,
    backupDir: path.join(tmp, "backups"),
    restartDelayMs: 300,
    botSteadyMs: 1000,
    healthTimeoutMs: 15_000,
    installCommand: `node -e "require('fs').writeFileSync('installed.txt', 'yes')"`,
    setupCommand: `node -e "const f=require('fs'); f.writeFileSync('apps/api/prisma/dev.db', 'db-migrated'); f.appendFileSync('setup-runs.txt', 'x')"`,
    quietHours: [0, 24],
  };
  writeTree(stateDir, { "config.json": JSON.stringify(config) });
  for (const app of ["api", "web", "bot"]) {
    supervisors.push(spawn(process.execPath, [path.join(appDir, "deploy/run.mjs"), app], { env, stdio: "ignore" }));
  }
  await waitFor(async () => (await get(apiPort)) === "v1" && (await get(webPort)) === "v1");
});

after(() => {
  for (const s of supervisors) s.kill("SIGKILL");
  for (const app of ["api", "web", "bot"]) {
    try {
      const { pid } = JSON.parse(fs.readFileSync(path.join(stateDir, `${app}.pid`), "utf8"));
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-pid, "SIGKILL");
    } catch {}
  }
  github?.close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  } catch {}
});

test("deploy: nothing happens in stream hours without --now", async () => {
  publish(site("v2"));
  assert.equal((await deploy()).code, 0);
  assert.equal(fs.existsSync(path.join(stateDir, "state.json")), false);
});

test("deploy: a good build goes live and keeps secrets, database and uploads", async () => {
  const m = publish(site("v2"));
  const r = await deployNow();
  assert.equal(r.code, 0, r.out);
  assert.equal(await get(apiPort), "v2");
  assert.equal(await get(webPort), "v2");
  assert.equal(state().sha, m.sha);
  const read = (rel) => fs.readFileSync(path.join(appDir, rel), "utf8");
  assert.equal(read("apps/api/.env"), "SECRET=keep");
  assert.equal(read("apps/api/prisma/dev.db"), "db-v1");
  assert.equal(read("apps/api/uploads/logo.png"), "logo");
  assert.equal(read("apps/bot/data/guilds.json"), "[1]");
  assert.equal(read("run-api.cmd"), "server-only file", "files the build never had stay");
  assert.equal(fs.existsSync(path.join(appDir, "apps/web/.next/static/v1.js")), false, "old build output is gone");
  assert.equal(fs.existsSync(path.join(appDir, "installed.txt")), false, "same lockfile: no reinstall");
  assert.equal(fs.existsSync(path.join(appDir, "setup-runs.txt")), false, "same schema: no database step");
  // A second run with the same build does nothing.
  assert.equal((await deployNow()).code, 0);
  assert.equal(fs.existsSync(path.join(appDir, "setup-runs.txt")), false);
});

test("deploy: a broken build is rolled back and not retried", async () => {
  const good = state().sha;
  const m = publish(site("v3", { broken: true, schema: "v3" }));
  const r = await deployNow();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /putting the previous version back/);
  assert.match(r.out, /previous version is running again/);
  assert.equal(await get(apiPort), "v2");
  assert.equal(await get(webPort), "v2");
  assert.equal(fs.existsSync(path.join(appDir, "only-in-v3.txt")), false);
  assert.equal(fs.existsSync(path.join(appDir, "only-in-v2.txt")), true);
  assert.equal(
    fs.readFileSync(path.join(appDir, "apps/api/prisma/dev.db"), "utf8"),
    "db-v1",
    "database put back after a failed change",
  );
  assert.equal(fs.readFileSync(path.join(appDir, "apps/api/prisma/schema.prisma"), "utf8"), "// schema v1");
  assert.equal(state().sha, good);
  assert.equal(state().failedSha, m.sha);
  // Without --now the failed build is not tried again.
  fs.writeFileSync(path.join(stateDir, "config.json"), JSON.stringify({ ...config, quietHours: [] }));
  assert.equal((await deploy()).code, 0);
  assert.equal(await get(apiPort), "v2");
  assert.equal(state().failedSha, m.sha);
});

test("deploy: new packages and a database change run install and setup", async () => {
  const tree = site("v4", { schema: "v4" });
  tree["package-lock.json"] = `{"lockfileVersion":3,"new":true}`;
  fs.mkdirSync(path.join(appDir, "node_modules/old"), { recursive: true });
  const m = publish(tree);
  const r = await deployNow();
  assert.equal(r.code, 0, r.out);
  assert.equal(await get(apiPort), "v4");
  assert.equal(fs.readFileSync(path.join(appDir, "installed.txt"), "utf8"), "yes");
  assert.equal(fs.readFileSync(path.join(appDir, "apps/api/prisma/dev.db"), "utf8"), "db-migrated");
  assert.equal(fs.existsSync(path.join(appDir, "only-in-v2.txt")), false, "files an earlier deploy put here are removed");
  assert.equal(fs.existsSync(path.join(appDir, "node_modules/old")), false, "packages were reinstalled from scratch");
  assert.equal(state().sha, m.sha);
});

test("deploy: a build not uploaded by GitHub Actions is refused", async () => {
  const before = state().sha;
  publish(site("v5"), { uploader: "someone" });
  const r = await deployNow();
  assert.equal(r.code, 1);
  assert.match(r.out, /not uploaded by github-actions\[bot\]/);
  assert.equal(state().sha, before);
  assert.equal(await get(apiPort), "v4");
});

test("deploy: apps not kept running by run.mjs are never touched", async () => {
  const pid = path.join(stateDir, "bot.pid");
  fs.renameSync(pid, `${pid}.away`);
  try {
    publish(site("v6"));
    const r = await deployNow();
    assert.equal(r.code, 1);
    assert.match(r.out, /bot not started by deploy\/run.mjs/);
    assert.equal(await get(apiPort), "v4");
  } finally {
    fs.renameSync(`${pid}.away`, pid);
  }
});

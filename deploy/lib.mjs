// Shared pieces of the auto-deploy: settings, a small zip reader/writer and file helpers.
// No packages: the server runs these with plain Node, before and while node_modules change.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

export const isWindows = process.platform === "win32";

// Everything the deploy keeps for itself (HOLD/PAUSE flags, pid files, state, downloaded builds,
// its log, config.json) lives outside the app folder so a deploy never overwrites it.
export function settings() {
  const appDir = path.resolve(import.meta.dirname, "..");
  const stateDir =
    process.env.THERANKING_DEPLOY_DIR ?? (isWindows ? "C:\\theranking-deploy" : path.join(os.homedir(), ".theranking-deploy"));
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(stateDir, "config.json"), "utf8"));
  } catch {}
  return {
    appDir,
    stateDir,
    backupDir: isWindows ? "C:\\theranking-backup" : path.join(stateDir, "backups"),
    logDir: path.join(appDir, "logs"),
    repo: "fufujung/WebRanking",
    githubApi: "https://api.github.com",
    release: "live-build",
    uploader: "github-actions[bot]",
    // Thai time (UTC+7) hours when nothing is deployed: Bank's live streams.
    quietHours: [18, 24],
    apiHealth: "http://127.0.0.1:4000/health",
    webHealth: "http://127.0.0.1:3000/",
    healthTimeoutMs: 180_000,
    botSteadyMs: 20_000,
    restartDelayMs: 5000,
    keepBackups: 5,
    discordWebhook: "",
    ...file,
  };
}

// The three apps and how each one is started (the same as `npm start` in its folder).
export const APPS = {
  api: { dir: "apps/api", entry: "dist/index.js" },
  web: { dir: "apps/web", entry: "balance.mjs" },
  bot: { dir: "apps/bot", entry: "dist/index.js" },
};

// Never written, replaced or deleted by a deploy: secrets, the database, uploads, bot data, packages.
export function isProtected(rel) {
  const p = rel.replaceAll("\\", "/");
  const name = p.split("/").pop();
  if (name.startsWith(".env") && name !== ".env.example") return true;
  return (
    /\.db($|-)/.test(name) ||
    p.split("/").includes("node_modules") ||
    p.startsWith("apps/api/uploads/") ||
    p.startsWith("apps/bot/data/") ||
    p.startsWith("logs/") ||
    p.startsWith("apps/web/.next/cache/")
  );
}

// Build output folders are replaced as a whole on every deploy, so no stale chunk survives.
export const BUILD_DIRS = ["apps/api/dist", "apps/bot/dist", "apps/web/.next"];

export function safeRel(name) {
  const p = name.replaceAll("\\", "/");
  if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.split("/").some((s) => s === ".." || s === "")) {
    throw new Error(`unsafe path in build: ${name}`);
  }
  return p;
}

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export function fileHash(file) {
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return null;
  }
}

// ---- zip (deflate, no zip64: up to 65535 files and 4 GB, far above one build) ----

export function writeZip(entries) {
  if (entries.length > 0xffff) throw new Error("too many files for one zip");
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // names are UTF-8
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt32LE(0x00210000, 10); // 1980-01-01 00:00
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    local.push(head, nameBuf, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(0x00210000, 12);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirBuf, end]);
}

export function readZip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("broken zip directory");
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const packedSize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const raw = buf.subarray(start, start + packedSize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : null;
    if (!data) throw new Error(`unsupported zip method ${method} for ${name}`);
    if (data.length !== size || zlib.crc32(data) !== crc) throw new Error(`damaged file in zip: ${name}`);
    out.push({ name, data });
  }
  return out;
}

// ---- files ----

// Every file under dir (relative, forward slashes), skipping folders that `skip(rel)` rejects.
export function walk(dir, skip = () => false, base = dir, out = []) {
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const item of items) {
    const full = path.join(dir, item.name);
    const rel = path.relative(base, full).replaceAll("\\", "/");
    if (skip(rel)) continue;
    // Junctions/symlinks (node_modules/@tr/*) are never followed.
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) walk(full, skip, base, out);
    else if (item.isFile()) out.push(rel);
  }
  return out;
}

export function writeFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

export function thaiHour(now = new Date()) {
  return (now.getUTCHours() + 7) % 24;
}

export function inQuietHours(cfg, now = new Date()) {
  const [from, to] = cfg.quietHours ?? [];
  if (from == null || to == null) return false;
  const h = thaiHour(now);
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

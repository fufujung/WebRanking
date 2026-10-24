// Packs a built checkout into one zip for the server, plus manifest.json describing it.
// Run after `npm run build`: node deploy/pack.mjs <out-dir>
// The zip holds the tracked source files and the build output (api/bot dist, web .next without
// its cache). Never node_modules, .env files, the database or uploads.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BUILD_DIRS, fileHash, isProtected, safeRel, sha256, walk, writeZip } from "./lib.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.resolve(process.argv[2] ?? "out");
const sha = process.env.BUILD_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

const title = execFileSync("git", ["log", "-1", "--format=%s", sha], { cwd: root, encoding: "utf8" }).trim();
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const built = [];
for (const dir of BUILD_DIRS) {
  if (!fs.existsSync(path.join(root, dir))) throw new Error(`${dir} is missing: run npm run build first`);
  // .next also holds the build cache, trace and dev-server files, which `next start` never reads.
  const skip = dir === "apps/web/.next" ? (r) => r === "cache" || r === "trace" || r === "dev" : () => false;
  for (const rel of walk(path.join(root, dir), skip)) {
    built.push(`${dir}/${rel}`);
  }
}

const names = [...new Set([...tracked, ...built])]
  .filter((rel) => !isProtected(rel) && !rel.startsWith(".github/") && fs.existsSync(path.join(root, rel)))
  .sort();
const entries = names.map((name) => ({ name: safeRel(name), data: fs.readFileSync(path.join(root, name)) }));
const zip = writeZip(entries);

const bundle = `theranking-${sha.slice(0, 12)}.zip`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, bundle), zip);
const manifest = {
  sha,
  title,
  builtAt: new Date().toISOString(),
  bundle,
  size: zip.length,
  sha256: sha256(zip),
  files: entries.length,
  // The server reinstalls packages only when the lockfile changed, and updates the database only
  // when the schema changed.
  lockHash: fileHash(path.join(root, "package-lock.json")),
  schemaHash: fileHash(path.join(root, "apps/api/prisma/schema.prisma")),
};
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`${bundle}: ${entries.length} files, ${(zip.length / 1e6).toFixed(1)} MB`);

// Dependency rules of the rankings module, checked on the source so a break fails CI.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const here = import.meta.dirname;
const apiSrc = path.resolve(here, "../..");
const appsDir = path.resolve(apiSrc, "../..");

/** Every .ts/.tsx file under dir (absolute), tests excluded unless asked. */
function walk(dir: string, withTests = false): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : walk(full, withTests);
    if (!/\.tsx?$/.test(e.name) || e.name.endsWith(".d.ts")) return [];
    return withTests || !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/**
 * Every module specifier in the source: static imports and re-exports (type-only included),
 * side-effect imports, dynamic import() (also the `import("x").Type` type form) and require().
 */
export function specifiers(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const out: string[] = [];
  for (const re of [/\b(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']/g, /\brequire\s*\(\s*["']([^"']+)["']/g]) {
    for (const m of text.matchAll(re)) out.push(m[1]);
  }
  return out;
}

const resolveFrom = (file: string, spec: string) => path.resolve(path.dirname(file), spec);
const inside = (dir: string, target: string) => !path.relative(dir, target).startsWith("..");

test("the import scanner sees every import form", () => {
  const sample = [
    'import type { Prisma } from "@prisma/client";',
    'import { type Request } from "express";',
    'export type { X } from "../../lib/x.js";',
    'import "discord.js";',
    'type Db = import("@prisma/client").PrismaClient;',
    'const z = await import("zod");',
    'const env = require("node:process");',
    "import {\n  a,\n  b,\n} from '../adapters/y.js';",
    '// import { gone } from "express";',
  ].join("\n");
  assert.deepEqual(specifiers(sample).sort(), ["../../lib/x.js", "../adapters/y.js", "@prisma/client", "@prisma/client", "discord.js", "express", "node:process", "zod"].sort());
});

/**
 * Allowed dependencies of the module's core, as an allowlist: domain may use only domain; application
 * only domain and application (ports, use cases). No packages at all (Express, Prisma, zod, node:*,
 * another database client...), and not the module's own index.ts, wiring.ts, adapters or test contract.
 * `from` and the paths in the message are relative to the module folder. Returns why an import is refused.
 */
export function coreViolation(from: string, spec: string): string | null {
  const layer = from.split(/[\\/]/)[0];
  if (!spec.startsWith(".")) return `${from} imports the package ${spec}`;
  const target = path.relative(here, path.resolve(here, path.dirname(from), spec)).split(path.sep).join("/");
  if (target.startsWith("..")) return `${from} imports ${spec} from outside the module`;
  const allowed = layer === "domain" ? ["domain/"] : ["domain/", "application/"];
  if (!allowed.some((dir) => target.startsWith(dir))) return `${from} (${layer}) imports ${target}`;
  return null;
}

/** import()/require() whose target is not a plain string cannot be checked, so core code may not use them. */
const nonLiteral = (source: string) => /\b(?:import|require)\s*\(\s*(?!["'])[^)\s]/.test(source.replace(/\/\/.*$/gm, ""));

test("the core rule rejects every way of reaching outside, and accepts the real shape", () => {
  const bad: [string, string][] = [
    ["application/use-cases/x.ts", "@prisma/client"],
    ["application/use-cases/x.ts", "better-sqlite3"],
    ["application/use-cases/x.ts", "express"],
    ["application/use-cases/x.ts", "../../index.js"],
    ["application/use-cases/x.ts", "../../wiring.js"],
    ["application/use-cases/x.ts", "../../adapters/outbound/prisma/prismaLadderSource.js"],
    ["application/use-cases/x.ts", "../../contract/fixtures.js"],
    ["application/use-cases/x.ts", "../../../../lib/db.js"],
    ["domain/x.ts", "../application/ports/ladderSource.js"],
    ["domain/x.ts", "node:fs"],
    ["domain/x.ts", "fs"],
  ];
  for (const [from, spec] of bad) assert.ok(coreViolation(from, spec), `${from} → ${spec} must be refused`);
  const good: [string, string][] = [
    ["domain/ladder.ts", "./rules.js"],
    ["application/use-cases/playerLadder.ts", "../../domain/ladder.js"],
    ["application/use-cases/playerLadder.ts", "../ports/ladderSource.js"],
  ];
  for (const [from, spec] of good) assert.equal(coreViolation(from, spec), null, `${from} → ${spec}`);
  assert.ok(nonLiteral("const m = await import(name);"));
  assert.ok(nonLiteral("require(`./${x}`)"));
  assert.ok(!nonLiteral('const m = await import("./a.js");'));
});

for (const layer of ["domain", "application"]) {
  test(`${layer} code follows the core rule`, () => {
    const files = walk(path.join(here, layer));
    assert.ok(files.length >= 2, `${layer} has code to check`);
    for (const file of files) {
      const rel = path.relative(here, file);
      const source = fs.readFileSync(file, "utf8");
      for (const spec of specifiers(source)) assert.equal(coreViolation(rel, spec), null);
      assert.ok(!nonLiteral(source), `${rel} uses import()/require() with a computed name`);
      assert.ok(!/process\.env|globalThis\.process/.test(source), `${rel} reads the environment`);
    }
  });
}

test("code outside the module uses only its index.ts (bootstrap/ also wiring.ts), never the test contract", () => {
  const entry = path.join(here, "index.ts");
  const wiring = path.join(here, "wiring.ts");
  const bootstrap = path.join(apiSrc, "bootstrap");
  for (const file of walk(apiSrc)) {
    if (inside(here, file)) continue;
    for (const spec of specifiers(fs.readFileSync(file, "utf8"))) {
      if (!spec.startsWith(".")) continue;
      const target = resolveFrom(file, spec).replace(/\.js$/, ".ts");
      if (!inside(here, target)) continue;
      const ok = target === entry || (target === wiring && inside(bootstrap, file));
      assert.ok(ok, `${path.relative(apiSrc, file)} imports ${spec}`);
    }
  }
});

test("the public index.ts carries no database or HTTP code", () => {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of specifiers(fs.readFileSync(file, "utf8"))) {
      assert.ok(spec.startsWith("."), `index.ts reaches the package ${spec} through ${path.relative(here, file)}`);
      const target = resolveFrom(file, spec).replace(/\.js$/, ".ts");
      assert.ok(!inside(path.join(here, "adapters"), target), `index.ts reaches ${path.relative(here, target)}`);
      visit(target);
    }
  };
  visit(path.join(here, "index.ts"));
});

test("the module's own production code never uses the test contract", () => {
  for (const file of walk(here)) {
    if (inside(path.join(here, "contract"), file)) continue;
    for (const spec of specifiers(fs.readFileSync(file, "utf8"))) assert.ok(!/\/contract\//.test(spec), `${path.relative(here, file)} imports ${spec}`);
  }
});

test("the web and the bot reach the backend over HTTP only", () => {
  for (const app of ["web", "bot"]) {
    // Production code only: the bot tests start the real API in-process on purpose.
    for (const file of walk(path.join(appsDir, app))) {
      for (const spec of specifiers(fs.readFileSync(file, "utf8"))) {
        const viaPath = spec.startsWith(".") && inside(path.join(appsDir, "api"), resolveFrom(file, spec));
        assert.ok(!viaPath && !/(^|\/)apps\/api\b|^@?[\w-]*\/?api\/src/.test(spec) && !/^@prisma\//.test(spec), `apps/${app}/${path.relative(path.join(appsDir, app), file)} imports ${spec}`);
      }
    }
  }
});

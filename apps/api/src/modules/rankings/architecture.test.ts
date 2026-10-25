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

// Domain and application know nothing of HTTP, the database, Discord, validation, the environment or code outside the module.
const forbidden = [/^express/, /^@prisma\//, /^prisma$/, /^discord/, /^zod$/, /^node:/, /^(fs|path|http|https|child_process|os|net)$/, /\/lib\//, /\/adapters\//, /\/bootstrap\//, /\/contract\//];

for (const layer of ["domain", "application"]) {
  test(`${layer} imports only its own module's domain and ports`, () => {
    const files = walk(path.join(here, layer));
    assert.ok(files.length >= 2, `${layer} has code to check`);
    for (const file of files) {
      const rel = path.relative(here, file);
      const source = fs.readFileSync(file, "utf8");
      for (const spec of specifiers(source)) {
        assert.ok(!forbidden.some((re) => re.test(spec)), `${rel} imports ${spec}`);
        assert.ok(spec.startsWith("."), `${rel} imports package ${spec}`);
        const target = resolveFrom(file, spec);
        assert.ok(inside(here, target), `${rel} imports ${spec} from outside the module`);
        if (layer === "domain") assert.ok(inside(path.join(here, "domain"), target), `${rel} (domain) imports ${spec}`);
      }
      assert.ok(!/process\.env|globalThis\.process/.test(source), `${rel} reads the environment`);
    }
  });
}

test("code outside the module uses only its index.ts, and never the test contract", () => {
  const entry = path.join(here, "index.ts");
  for (const file of walk(apiSrc)) {
    if (inside(here, file)) continue;
    for (const spec of specifiers(fs.readFileSync(file, "utf8"))) {
      if (!spec.startsWith(".")) continue;
      const target = resolveFrom(file, spec).replace(/\.js$/, ".ts");
      if (inside(here, target)) assert.equal(target, entry, `${path.relative(apiSrc, file)} deep-imports ${spec}`);
    }
  }
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

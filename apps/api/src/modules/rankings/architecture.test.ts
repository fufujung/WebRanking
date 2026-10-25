// Dependency rules of the rankings module, checked on the source so a break fails CI.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const here = import.meta.dirname;
const files = (dir: string): string[] =>
  fs.readdirSync(path.join(here, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [path.join(dir, e.name)] : []));
const imports = (file: string) => [...fs.readFileSync(path.join(here, file), "utf8").matchAll(/^\s*(?:import|export)[^"';]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

// Domain and application know nothing of HTTP, the database, Discord, the environment or code outside the module.
const forbidden = [/^express/, /^@prisma\//, /^discord/, /^zod$/, /^node:/, /\/lib\//, /\/adapters\//, /\/bootstrap\//];

for (const layer of ["domain", "application"]) {
  test(`${layer} imports only its own module's domain and ports`, () => {
    for (const file of files(layer)) {
      for (const spec of imports(file)) {
        assert.ok(!forbidden.some((re) => re.test(spec)), `${file} imports ${spec}`);
        if (spec.startsWith(".")) {
          const target = path.relative(here, path.resolve(here, path.dirname(file), spec));
          assert.ok(!target.startsWith(".."), `${file} imports ${spec} from outside the module`);
          if (layer === "domain") assert.ok(target.startsWith("domain"), `${file} (domain) imports ${spec}`);
        }
      }
      const text = fs.readFileSync(path.join(here, file), "utf8");
      assert.ok(!/process\.env/.test(text), `${file} reads process.env`);
    }
  });
}

test("the layer folders are not empty (the rule above checks real code)", () => {
  assert.ok(files("domain").length >= 3);
  assert.ok(files("application").length >= 2);
});

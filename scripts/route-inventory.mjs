// Static route inventory. References are evidence, never proof of runtime usage.
import fs from "node:fs";
import path from "node:path";

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = `${dir}/${entry.name}`;
    return entry.isDirectory() ? files(name) : [name];
  });
}
const app = fs.readFileSync("apps/api/src/app.ts", "utf8");
const mounts = new Map([...app.matchAll(/v1\.use\("([^"]+)", (\w+)\)/g)].map((m) => [m[2], m[1]]));
mounts.set("uploads", "");
const callers = [...files("apps/web/app"), ...files("apps/web/components"), ...files("apps/web/lib"), ...files("apps/bot/src")]
  .filter((p) => /\.[cm]?[jt]sx?$/.test(p) && !p.includes(".test."))
  .flatMap((p) => {
    const text = fs.readFileSync(p, "utf8");
    return [...text.matchAll(/(["'`])(\/[^\n]*?)\1/g)].map((m) => ({
      file: p, line: text.slice(0, m.index).split("\n").length,
      url: m[2].replace(/\$\{[^}]*\}/g, ":dynamic").split("?")[0],
    }));
  });
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lines = [
  "# Route coverage inventory", "",
  "Regenerate from the repository root with `node scripts/route-inventory.mjs`.", "",
  "All existing routes are retained. External API usage is unknown. Static references below are path candidates, not method-level runtime telemetry; helper-built URLs require manual tracing. Absence of a reference is not a removal recommendation.", "",
  "## Website routes", "", "| Route | Audience / entry point |", "| --- | --- |",
];
function entry(route) {
  if (route.startsWith("/admin") || route === "/[entry]") return "Admin; restricted navigation / configured sign-in address";
  if (/^\/(api|live|overlay|go)\b/.test(route)) return "Supporting handler; auth, forms, refresh, broadcast, or ads (not a menu destination)";
  if (route.startsWith("/join/")) return "Member; team invitation link";
  if (route === "/me" || route === "/login") return "Member; account navigation / sign-in redirects";
  if (route === "/search") return "Public; header / homepage search";
  if (route.startsWith("/special/story")) return "Public; special-season stories; return link preserves season";
  if (route.startsWith("/special") || route === "/predict" || route === "/blacklist") return "Public; footer and contextual links";
  if (/^\/(teams|players|guilds)(\/|$)/.test(route)) return "Public; directory tabs, entity links, search / Discord";
  if (route.includes("/picks")) return "Public; tournament link when draft data exists";
  return "Public; primary navigation / homepage / contextual detail links";
}
for (const p of files("apps/web/app").filter((p) => /\/(page|route)\.tsx?$/.test(p)).sort()) {
  const route = "/" + path.posix.dirname(p.replace("apps/web/app/", "")).split("/").filter((x) => x !== "." && !x.startsWith("(")).join("/");
  lines.push(`| \`${route}\` | ${entry(route)} |`);
}
lines.push("", "## API routes", "", "Paths are relative to `/api/v1`. Path references may include website links as well as API calls. Tournament bracket mutations also use `bracketPath` / `slotPath` in `apps/web/app/admin/actions.ts`; Discord operations use `apps/bot/src/tour.ts`.", "", "| Method | Path | Static reference candidates / caller evidence |", "| --- | --- | --- |");
for (const p of files("apps/api/src/routes").filter((p) => p.endsWith(".ts")).sort()) {
  for (const m of fs.readFileSync(p, "utf8").matchAll(/(\w+)\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
    if (!mounts.has(m[1])) continue;
    const route = (mounts.get(m[1]) + (m[3] === "/" ? "" : m[3])) || "/";
    const pattern = new RegExp("^" + route.split("/").map((part) => part.startsWith(":") ? "[^/]+" : escape(part)).join("/") + "$");
    const refs = [...new Set(callers.filter((c) => pattern.test(c.url)).map((c) => `${c.file}:${c.line}`))];
    let evidence = refs.slice(0, 4).map((r) => `\`${r}\``).join("; ");
    if (route.includes("/bracket")) evidence += `${evidence ? "; " : ""}admin bracket helpers / Discord tour module`;
    if (route.includes("/drafts/") && m[2] !== "get") evidence ||= "External broadcast/draft-key integration; no bundled application caller found";
    evidence ||= "No literal caller found; integration / dynamic caller usage unknown";
    lines.push(`| ${m[2].toUpperCase()} | \`${route}\` | ${evidence} |`);
  }
}
lines.push("", "Supporting API routes outside this table: `/health`, `/health/ready`, `/docs`, `/openapi.json`, static `/uploads`, and `/api/v1/revision`. Used by deployment, documentation, uploaded assets, public refresh, and the bot. Rankings `/mmr` is mounted in the rankings router and delegates to the rankings module.", "", "## Manual conclusions", "", "- `GET /players/uid/:uid`: documented integration lookup; no website or bot caller found. Retain.", "- `/matches/by-source`: bot result deduplication. Retain.", "- Tournament registration, roster, check-in and dispute routes serve admin / Discord workflows. Preserve authorization and backend validation.", "- Directory, prediction and special-season navigation has been reconnected; existing detail links and hashes remain valid.", "");
fs.writeFileSync("docs/route-coverage.md", lines.join("\n"));
console.log("Updated docs/route-coverage.md");

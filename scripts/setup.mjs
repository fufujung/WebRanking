// First-time setup: installs packages, creates apps/api/.env, the database, an API key + admin password
// for the website (apps/web/.env.local) and demo data. Safe to run again.
import { execSync } from "node:child_process";
import fs from "node:fs";

// A fresh download (e.g. GitHub's ZIP) has no node_modules yet.
if (!fs.existsSync("node_modules/.package-lock.json")) {
  console.log("Installing packages (first run only)...");
  execSync("npm install", { stdio: "inherit" });
}

const env = "apps/api/.env";
if (!fs.existsSync(env)) {
  fs.copyFileSync("apps/api/.env.example", env);
  console.log(`Created ${env}`);
}
const demo = process.argv.includes("--no-demo") ? " -- --no-demo" : "";
execSync(`npm run db:setup --workspace apps/api${demo}`, { stdio: "inherit" });
console.log("\nDone. Start everything with: npm run dev");

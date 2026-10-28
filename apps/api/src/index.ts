import "./env.js";
import { createApp } from "./app.js";
import { recomputeRatings } from "./lib/elo.js";
import { backfillPlayerUids, backfillPositions } from "./lib/players.js";
import { backfillGames } from "./lib/games.js";
import { backfillPlayerRanks } from "./lib/playerRegistration.js";
import { startDrawPoller } from "./lib/draws.js";
import { tuneDatabase } from "./lib/db.js";
import { runStartup } from "./lib/lifecycle.js";

if (!process.env.DATABASE_URL?.trim()) {
  console.error("API configuration error: DATABASE_URL is missing. Set it in apps/api/.env or the process environment before starting the API. See apps/api/.env.example.");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 4000);
createApp().listen(port, () => {
  console.log(`API listening on http://localhost:${port} (docs: http://localhost:${port}/docs)`);
});

// Data saved before players had their own UID and MMR: fill both in once on start. /health/ready answers
// only after this (and the WAL switch) finished, so the auto-deploy never accepts a half-started API.
void runStartup(async () => {
  await tuneDatabase().catch((e) => console.error("Could not switch the database to WAL:", e));
  await backfillGames();
  await backfillPositions();
  const n = await backfillPlayerUids();
  if (n) console.log(`Linked ${n} player(s) to the UID from their tournament roster`);
  await backfillPlayerRanks();
  await recomputeRatings();
});

// Lucky draws: close the ones whose time is up and read the YouTube chat of the open ones.
startDrawPoller();

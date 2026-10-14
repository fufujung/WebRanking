import "./env.js";
import { createApp } from "./app.js";
import { recomputeRatings } from "./lib/elo.js";
import { backfillPlayerUids, backfillPositions } from "./lib/players.js";
import { backfillGames } from "./lib/games.js";

const port = Number(process.env.PORT ?? 4000);
createApp().listen(port, () => {
  console.log(`API listening on http://localhost:${port} (docs: http://localhost:${port}/docs)`);
});

// Data saved before players had their own UID and MMR: fill both in once on start.
backfillGames()
  .then(() => backfillPositions())
  .then(() => backfillPlayerUids())
  .then((n) => {
    if (n) console.log(`Linked ${n} player(s) to the UID from their tournament roster`);
    return recomputeRatings();
  })
  .catch((e) => console.error("Could not update player UIDs and MMR on start:", e));

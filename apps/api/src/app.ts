import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import { requireApiKey } from "./lib/apiKeys.js";
import { errorHandler, HttpError } from "./lib/errors.js";
import { UPLOAD_DIR } from "./lib/uploads.js";
import { keys } from "./routes/keys.js";
import { matches } from "./routes/matches.js";
import { players } from "./routes/players.js";
import { rankings } from "./routes/rankings.js";
import { stats } from "./routes/stats.js";
import { teams } from "./routes/teams.js";
import { tournaments } from "./routes/tournaments.js";
import { uploads } from "./routes/uploads.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const openapi = YAML.parse(fs.readFileSync(path.join(here, "..", "openapi.yaml"), "utf8"));

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  const origins = (process.env.CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  app.use(
    cors({
      origin: origins.includes("*") ? true : origins,
      allowedHeaders: ["Content-Type", "X-API-Key", "Authorization"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/openapi.json", (_req, res) => {
    res.json(openapi);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "Tournament Ranking API" }));
  app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d", index: false }));

  const v1 = express.Router();
  v1.use(requireApiKey);
  v1.use("/teams", teams);
  v1.use("/players", players);
  v1.use("/tournaments", tournaments);
  v1.use("/matches", matches);
  v1.use("/rankings", rankings);
  v1.use("/stats", stats);
  v1.use("/keys", keys);
  v1.use(uploads);
  app.use("/api/v1", v1);

  app.use((_req, _res, next) => next(new HttpError(404, "Route not found")));
  app.use(errorHandler);
  return app;
}

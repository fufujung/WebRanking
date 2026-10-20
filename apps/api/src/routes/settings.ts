import { Router } from "express";
import { requireAdmin } from "../lib/apiKeys.js";
import { getSettings, updateSettings } from "../lib/settings.js";

/** Site-wide settings: anyone with a key reads them; only admins change them. */
export const settings = Router();

settings.get("/", async (_req, res) => {
  res.json(await getSettings());
});

settings.patch("/", requireAdmin, async (req, res) => {
  res.json(await updateSettings(req.body));
});

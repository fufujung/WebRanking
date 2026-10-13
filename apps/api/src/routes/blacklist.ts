import { Router } from "express";
import { requireAdmin } from "../lib/apiKeys.js";
import { addToBlacklist, deleteBlacklist, listBlacklist, updateBlacklist } from "../lib/blacklist.js";

/** The blacklist. Reading is public; walkovers add entries by themselves, organizers add, lift or remove them here. */
export const blacklist = Router();

blacklist.get("/", async (req, res) => {
  res.json(await listBlacklist(req.query));
});

blacklist.post("/", requireAdmin, async (req, res) => {
  res.status(201).json(await addToBlacklist(req.body));
});

blacklist.patch("/:id", requireAdmin, async (req, res) => {
  res.json(await updateBlacklist(String(req.params.id), req.body));
});

blacklist.delete("/:id", requireAdmin, async (req, res) => {
  await deleteBlacklist(String(req.params.id));
  res.status(204).end();
});

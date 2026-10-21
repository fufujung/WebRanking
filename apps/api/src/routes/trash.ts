import { Router } from "express";
import { requireAdmin } from "../lib/apiKeys.js";
import { forgetTrash, restoreTrash, trashList } from "../lib/trash.js";

/** The trash bin: deleted tournaments, restorable for 30 days. Admin only. */
export const trash = Router();

trash.get("/", requireAdmin, async (_req, res) => {
  res.json({ data: await trashList() });
});

trash.post("/:id/restore", requireAdmin, async (req, res) => {
  res.json(await restoreTrash(String(req.params.id)));
});

trash.delete("/:id", requireAdmin, async (req, res) => {
  await forgetTrash(String(req.params.id));
  res.status(204).end();
});

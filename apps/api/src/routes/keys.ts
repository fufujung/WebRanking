import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { createApiKey, requireAdmin } from "../lib/apiKeys.js";
import { HttpError } from "../lib/errors.js";

export const keys = Router();
keys.use(requireAdmin);

const publicFields = { id: true, name: true, prefix: true, scope: true, createdAt: true, lastUsedAt: true, revokedAt: true };

keys.get("/", async (_req, res) => {
  res.json({ data: await prisma.apiKey.findMany({ select: publicFields, orderBy: { createdAt: "desc" } }) });
});

keys.post("/", async (req, res) => {
  const input = z
    .object({ name: z.string().trim().min(1).max(100), scope: z.enum(["read", "admin"]).default("read") })
    .parse(req.body);
  const { key, record } = await createApiKey(input.name, input.scope);
  res.status(201).json({ key, id: record.id, name: record.name, scope: record.scope, prefix: record.prefix });
});

keys.delete("/:id", async (req, res) => {
  if (String(req.params.id) === res.locals.apiKey.id) throw new HttpError(400, "You cannot revoke the key you are using");
  await prisma.apiKey.update({ where: { id: String(req.params.id) }, data: { revokedAt: new Date() } });
  res.status(204).end();
});

import { createHash, randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { prisma } from "./db.js";
import { HttpError } from "./errors.js";

export type Scope = "read" | "admin";

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createApiKey(name: string, scope: Scope) {
  const key = `trk_${randomBytes(24).toString("hex")}`;
  const record = await prisma.apiKey.create({
    data: { name, scope, prefix: key.slice(0, 12), keyHash: hashKey(key) },
  });
  return { key, record };
}

function extractKey(header: string | undefined, auth: string | undefined) {
  if (header) return header.trim();
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return undefined;
}

/**
 * Requires a valid API key in `X-API-Key` or `Authorization: Bearer`.
 * Read-only keys may only use GET; writes need an admin key.
 */
export const requireApiKey: RequestHandler = async (req, res, next) => {
  const key = extractKey(req.header("x-api-key"), req.header("authorization"));
  if (!key) throw new HttpError(401, "Missing API key. Send it in the X-API-Key header.");
  const record = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(key) } });
  if (!record || record.revokedAt) throw new HttpError(401, "Invalid or revoked API key");
  const isRead = req.method === "GET" || req.method === "HEAD";
  if (!isRead && record.scope !== "admin") {
    throw new HttpError(403, "This API key is read-only");
  }
  res.locals.apiKey = record;
  // Fire-and-forget usage tracking; never block the request on it.
  prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  next();
};

export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (res.locals.apiKey?.scope !== "admin") throw new HttpError(403, "Admin API key required");
  next();
};

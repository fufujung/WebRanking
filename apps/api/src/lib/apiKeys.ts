import { createHash, randomBytes } from "node:crypto";
import type { RequestHandler, Response } from "express";
import { prisma } from "./db.js";
import { HttpError } from "./errors.js";
import { clientIp, fromInternet, Limiter } from "./rateLimit.js";

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
/** Wrong keys from one address: 20 per 10 minutes, then that address waits. */
export const badKeys = new Limiter(20, 10 * 60_000);
/** Requests from one internet address: 600 a minute is far more than a person or a well-behaved site needs. */
export const busyClients = new Limiter(600, 60_000);

const tooMany = (res: Response, seconds: number) => {
  res.setHeader("Retry-After", String(seconds));
  return new HttpError(429, "Too many requests. Try again later.", { th: `เรียกใช้บ่อยเกินไป ลองใหม่ในอีก ${seconds} วินาที`, retryAfter: seconds });
};

export const requireApiKey: RequestHandler = async (req, res, next) => {
  // Only callers from the internet are limited; the website and the bot run on this computer.
  const ip = fromInternet(req) ? clientIp(req) : null;
  if (ip) {
    const wait = busyClients.hit(ip) || badKeys.blockedFor(ip);
    if (wait) throw tooMany(res, wait);
  }
  const key = extractKey(req.header("x-api-key"), req.header("authorization"));
  if (!key) throw new HttpError(401, "Missing API key. Send it in the X-API-Key header.");
  const record = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(key) } });
  if (!record || record.revokedAt) {
    if (ip) badKeys.hit(ip);
    throw new HttpError(401, "Invalid or revoked API key");
  }
  const isRead = req.method === "GET" || req.method === "HEAD";
  if (!isRead && record.scope !== "admin") {
    throw new HttpError(403, "This API key is read-only");
  }
  res.locals.apiKey = record;
  noteUse(record.id);
  next();
};

/**
 * "Last used" is written at most once a minute per key. Writing it on every request made each page
 * view a database write, and under a crowd those writes queued behind each other on the one SQLite file.
 */
const USE_EVERY_MS = 60_000;
const lastNoted = new Map<string, number>();
export function noteUse(id: string, now = Date.now()) {
  if (now - (lastNoted.get(id) ?? 0) < USE_EVERY_MS) return false;
  lastNoted.set(id, now);
  // Fire-and-forget usage tracking; never block the request on it.
  prisma.apiKey
    .update({ where: { id }, data: { lastUsedAt: new Date(now) } })
    .catch(() => {});
  return true;
}

export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (res.locals.apiKey?.scope !== "admin") throw new HttpError(403, "Admin API key required");
  next();
};

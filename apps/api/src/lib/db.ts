import { PrismaClient } from "@prisma/client";

/**
 * SQLite waits up to socket_timeout seconds for a lock before a query fails. Prisma's default (5 s) turned a
 * busy moment, such as a long prediction sync, into "Socket timeout" errors and pages that failed to load.
 */
export function databaseUrl(url: string | undefined) {
  if (!url?.startsWith("file:") || /[?&]socket_timeout=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}socket_timeout=20`;
}

const url = databaseUrl(process.env.DATABASE_URL);
export const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

/**
 * WAL lets pages keep reading while something writes, instead of queueing behind it. The setting is kept in
 * the database file, so this only changes something the first time.
 */
export async function tuneDatabase() {
  if (!process.env.DATABASE_URL?.startsWith("file:")) return;
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL");
}

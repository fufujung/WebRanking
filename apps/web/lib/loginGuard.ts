import "server-only";
import { headers } from "next/headers";

/**
 * Stops password guessing on the admin login: 5 wrong passwords from one address lock it out for
 * 15 minutes. Behind the Cloudflare Tunnel the visitor's address is in CF-Connecting-IP.
 */
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
const fails = new Map<string, number[]>();

export async function loginAddress() {
  const h = await headers();
  return h.get("cf-connecting-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

const recent = (ip: string, now: number) => (fails.get(ip) ?? []).filter((t) => t > now - LOCK_MS);

/** Minutes until this address may try again, or 0. */
export function lockedFor(ip: string, now = Date.now()) {
  const list = recent(ip, now);
  return list.length >= MAX_FAILS ? Math.ceil((list[0] + LOCK_MS - now) / 60_000) : 0;
}

export function recordFailure(ip: string, now = Date.now()) {
  fails.set(ip, [...recent(ip, now), now]);
  if (fails.size > 5000) for (const [k] of fails) if (!recent(k, now).length) fails.delete(k);
}

export function clearFailures(ip: string) {
  fails.delete(ip);
}

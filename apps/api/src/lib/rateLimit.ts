/**
 * Small in-memory rate limits (one process serves the site). Counts hits per key in a sliding window
 * and says how long to wait once the limit is reached.
 */
import type { Request } from "express";

export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Seconds to wait before trying again, or 0 while under the limit. Does not count a hit. */
  blockedFor(key: string, now = Date.now()) {
    const list = this.fresh(key, now);
    return list.length >= this.max ? Math.ceil((list[0] + this.windowMs - now) / 1000) : 0;
  }

  /** Counts one hit; returns the seconds to wait if this hit went over the limit. */
  hit(key: string, now = Date.now()) {
    const list = this.fresh(key, now);
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.sweep(now);
    return list.length > this.max ? Math.ceil((list[0] + this.windowMs - now) / 1000) : 0;
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  private fresh(key: string, now: number) {
    return (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
  }

  private sweep(now: number) {
    for (const [k, list] of this.hits) if (!list.some((t) => t > now - this.windowMs)) this.hits.delete(k);
  }
}

const loopback = (addr: string | undefined) => !addr || addr === "::1" || addr.startsWith("127.") || addr.startsWith("::ffff:127.");

/**
 * The visitor's address. Behind the Cloudflare Tunnel (which connects from this computer), Cloudflare puts it
 * in CF-Connecting-IP. A caller reaching the port directly (another computer on the network, a forwarded
 * port) could forge that header, so for them the connection's own address counts.
 */
export function clientIp(req: Request) {
  const socket = req.socket.remoteAddress;
  return (loopback(socket) && req.header("cf-connecting-ip")?.trim()) || socket || "unknown";
}

/**
 * Requests from outside this computer: through Cloudflare, or straight to the port from the network.
 * Only the website and the bot on this computer go unlimited.
 */
export const fromInternet = (req: Request) => Boolean(req.header("cf-connecting-ip")) || !loopback(req.socket.remoteAddress);

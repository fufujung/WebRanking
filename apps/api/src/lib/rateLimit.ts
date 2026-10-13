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

/**
 * The visitor's address. Behind the Cloudflare Tunnel, Cloudflare puts it in CF-Connecting-IP;
 * the API itself only listens on this computer, so the header can't be forged from outside.
 */
export function clientIp(req: Request) {
  return req.header("cf-connecting-ip")?.trim() || req.socket.remoteAddress || "unknown";
}

/** Requests that came in from the internet (through Cloudflare), as opposed to the website and bot on this computer. */
export const fromInternet = (req: Request) => Boolean(req.header("cf-connecting-ip"));

/**
 * A small in-process rate limiter for the HTTP mode: a fixed window per
 * client address. One process holds the counts, which is all a single
 * instance needs; behind several instances each counts on its own.
 *
 * Each JSON-RPC call counts, so a batch of fifty calls in one request costs
 * fifty, not one.
 */
import type { IncomingMessage } from "node:http";

export const RATE_WINDOW_MS = 60_000;
/** Addresses remembered at once. Past this, expired windows are dropped, then the oldest. */
export const MAX_TRACKED = 50_000;

export type Verdict = { ok: true } | { ok: false; retryAfterSeconds: number };

export class RateLimiter {
  private readonly windows = new Map<string, { start: number; used: number }>();

  constructor(
    /** Calls allowed per address per window. */
    readonly limit: number,
    private readonly now: () => number = Date.now,
    readonly windowMs = RATE_WINDOW_MS,
  ) {}

  /** Spend `cost` calls for this address, or say how long until it may try again. Refused calls cost nothing. */
  take(key: string, cost = 1): Verdict {
    const now = this.now();
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.delete(key);
      w = { start: now, used: 0 };
      this.windows.set(key, w);
      this.trim(now);
    }
    if (w.used + cost > this.limit) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + this.windowMs - now) / 1000)) };
    w.used += cost;
    return { ok: true };
  }

  /** How many addresses are being counted (for tests). */
  get tracked(): number {
    return this.windows.size;
  }

  private trim(now: number): void {
    if (this.windows.size <= MAX_TRACKED) return;
    for (const [key, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(key);
    // Still too many live windows: forget the oldest. Map keeps insertion order, and a window is re-inserted when it restarts.
    for (const key of this.windows.keys()) {
      if (this.windows.size <= MAX_TRACKED) break;
      this.windows.delete(key);
    }
  }
}

/**
 * The address to count a request against. Without trusted proxies it's the
 * connection's own address: X-Forwarded-For is just text any client can send,
 * so trusting it would let anyone dodge the limit or spend someone else's.
 *
 * Behind a proxy every request comes from the proxy, so with trustedHops set
 * (--trust-proxy) it reads X-Forwarded-For instead. Each proxy appends the
 * address it received the request from, so the last `trustedHops` entries were
 * written by proxies you run and the one they name is the client; anything
 * further left came from the client and is ignored. Set it to exactly the
 * number of proxies in front of the server: too many lets clients choose
 * their own address.
 */
export function clientAddress(req: Pick<IncomingMessage, "headers" | "socket">, trustedHops: number): string {
  const own = normalize(req.socket.remoteAddress ?? "unknown");
  if (trustedHops <= 0) return own;
  const header = req.headers["x-forwarded-for"];
  const raw = Array.isArray(header) ? header.join(",") : header;
  if (!raw) return own;
  const hops = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!hops.length) return own;
  return normalize(hops[Math.max(0, hops.length - trustedHops)]!);
}

/** IPv4 seen through an IPv6 socket (::ffff:1.2.3.4) counts as the IPv4 address. */
const normalize = (address: string) => address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "").toLowerCase();

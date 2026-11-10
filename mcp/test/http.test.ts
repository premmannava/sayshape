import { afterEach, describe, expect, it } from "vitest";
import { connect as netConnect, type Socket } from "node:net";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttp, dataRefusal, DEFAULT_RATE_LIMIT, isLoopback, LIMITS, listen, parseHttpArgs, PUBLIC_DATA_REFUSAL, startupLine, type Limits } from "../src/http";
import { clientAddress, MAX_TRACKED, RateLimiter } from "../src/rate-limit";
import { createServer, interfaceKey } from "../src/server";

const parse = (args: string[], env: Record<string, string> = {}) => parseHttpArgs(["--http", ...args], env);

describe("--http options", () => {
  it("default to 127.0.0.1:3001 with no rate limit, as before", () => {
    expect(parse([]).options).toEqual({ host: "127.0.0.1", port: 3001, rateLimit: 0, trustProxy: 0, allowPublicData: false });
  });

  it("take the port from --http, else PORT, else 3001", () => {
    expect(parse(["4000"]).options.port).toBe(4000);
    expect(parse([], { PORT: "10000" }).options.port).toBe(10000);
    expect(parse(["4000"], { PORT: "10000" }).options.port).toBe(4000);
    expect(parse(["--host", "0.0.0.0"], { PORT: "8080" }).options.port).toBe(8080);
    expect(() => parse([], { PORT: "eighty" })).toThrow(/PORT must be a port number/);
    expect(() => parse(["70000"])).toThrow(/between 1 and 65535/);
  });

  it("take the address from --host, else HOST when it's an IP address, else 127.0.0.1", () => {
    expect(parse(["--host", "0.0.0.0"]).options.host).toBe("0.0.0.0");
    expect(parse(["--host", "[::]"]).options.host).toBe("::");
    expect(parse([], { HOST: "0.0.0.0" }).options.host).toBe("0.0.0.0");
    expect(parse(["--host", "127.0.0.1"], { HOST: "0.0.0.0" }).options.host).toBe("127.0.0.1");
    // Some machines set HOST to their own name; that mustn't put the server on the network.
    const named = parse([], { HOST: "my-laptop.local" });
    expect(named.options.host).toBe("127.0.0.1");
    expect(named.notes[0]).toMatch(/Ignoring HOST=my-laptop\.local: it isn't an IP address/);
    expect(() => parse(["--host"])).toThrow(/--host needs a value/);
  });

  it("turn the rate limit on by default beyond loopback only, and let --rate-limit change it", () => {
    expect(parse(["--host", "0.0.0.0"]).options.rateLimit).toBe(DEFAULT_RATE_LIMIT);
    expect(parse(["--host", "::"]).options.rateLimit).toBe(DEFAULT_RATE_LIMIT);
    expect(parse(["--host", "localhost"]).options.rateLimit).toBe(0);
    expect(parse(["--host", "0.0.0.0", "--rate-limit", "0"]).options.rateLimit).toBe(0);
    expect(parse(["--rate-limit", "20"]).options.rateLimit).toBe(20);
    expect(() => parse(["--rate-limit", "lots"])).toThrow(/--rate-limit takes a number/);
  });

  it("read --trust-proxy hops, 1 by default", () => {
    expect(parse(["--trust-proxy"]).options.trustProxy).toBe(1);
    expect(parse(["--trust-proxy", "2"]).options.trustProxy).toBe(2);
    expect(parse(["--trust-proxy", "--host", "0.0.0.0"]).options.trustProxy).toBe(1);
    expect(() => parse(["--trust-proxy", "0"])).toThrow(/from 1 to 10/);
  });

  it("know loopback addresses", () => {
    for (const h of ["127.0.0.1", "127.1.2.3", "::1", "[::1]", "localhost", "::ffff:127.0.0.1"]) expect(isLoopback(h)).toBe(true);
    for (const h of ["0.0.0.0", "::", "10.0.0.5", "192.168.1.2", "example.com"]) expect(isLoopback(h)).toBe(false);
  });

  it("refuse --data beyond loopback unless --allow-public-data, and say why", () => {
    expect(dataRefusal(true, { host: "0.0.0.0", allowPublicData: false })).toBe(PUBLIC_DATA_REFUSAL);
    expect(PUBLIC_DATA_REFUSAL).toMatch(/read every table[\s\S]*other callers' query results[\s\S]*--host 127\.0\.0\.1[\s\S]*--allow-public-data/);
    expect(dataRefusal(true, { host: "127.0.0.1", allowPublicData: false })).toBeUndefined();
    expect(dataRefusal(true, { host: "0.0.0.0", allowPublicData: true })).toBeUndefined();
    expect(dataRefusal(false, { host: "0.0.0.0", allowPublicData: false })).toBeUndefined();
    expect(parse(["--host", "0.0.0.0", "--allow-public-data"]).options.allowPublicData).toBe(true);
  });

  it("start with one line that says where and how calls are limited, and nothing else", () => {
    expect(startupLine(parse([]).options, 3001)).toBe("SayShape MCP server on http://127.0.0.1:3001/mcp (no rate limit)");
    expect(startupLine(parse(["--host", "::", "--trust-proxy"]).options, 80)).toBe(
      "SayShape MCP server on http://[::]:80/mcp (rate limit 300 calls a minute per client address, read from X-Forwarded-For (1 trusted proxy hop))",
    );
  });
});

describe("the rate limiter", () => {
  it("allows calls up to the limit, refuses the next with a wait, and resets with the window", () => {
    let t = 1_000_000;
    const limiter = new RateLimiter(3, () => t);
    expect([1, 2, 3].map(() => limiter.take("a").ok)).toEqual([true, true, true]);
    expect(limiter.take("a")).toEqual({ ok: false, retryAfterSeconds: 60 });
    // Another address has its own count.
    expect(limiter.take("b").ok).toBe(true);
    t += 45_500;
    expect(limiter.take("a")).toEqual({ ok: false, retryAfterSeconds: 15 });
    t += 14_500;
    expect(limiter.take("a").ok).toBe(true);
  });

  it("counts a batch by its calls, and a refused batch costs nothing", () => {
    const limiter = new RateLimiter(10, () => 0);
    expect(limiter.take("a", 8).ok).toBe(true);
    expect(limiter.take("a", 5).ok).toBe(false);
    expect(limiter.take("a", 2).ok).toBe(true);
  });

  it("forgets addresses rather than growing without bound", () => {
    let t = 0;
    const limiter = new RateLimiter(5, () => t);
    for (let i = 0; i < MAX_TRACKED + 10; i++) limiter.take(`10.0.${i >> 8}.${i & 255}:${i}`);
    expect(limiter.tracked).toBeLessThanOrEqual(MAX_TRACKED);
    t += 60_000;
    limiter.take("new");
    expect(limiter.tracked).toBeLessThanOrEqual(MAX_TRACKED);
  });
});

describe("the client address", () => {
  const req = (remote: string, xff?: string | string[]) => ({ socket: { remoteAddress: remote }, headers: xff === undefined ? {} : { "x-forwarded-for": xff } }) as Parameters<typeof clientAddress>[0];

  it("is the connection's own address unless proxies are trusted, whatever X-Forwarded-For says", () => {
    expect(clientAddress(req("203.0.113.9", "1.2.3.4"), 0)).toBe("203.0.113.9");
    expect(clientAddress(req("::ffff:203.0.113.9"), 0)).toBe("203.0.113.9");
  });

  it("is the entry the trusted proxies wrote, ignoring what the client put before it", () => {
    // The client sent "X-Forwarded-For: 6.6.6.6"; one proxy appended the real address.
    expect(clientAddress(req("10.0.0.2", "6.6.6.6, 198.51.100.7"), 1)).toBe("198.51.100.7");
    // Two proxies: the CDN appended the client, then the load balancer appended the CDN.
    expect(clientAddress(req("10.0.0.2", "6.6.6.6, 198.51.100.7, 172.16.0.3"), 2)).toBe("198.51.100.7");
    expect(clientAddress(req("10.0.0.2", ["6.6.6.6", "198.51.100.7"]), 1)).toBe("198.51.100.7");
    // No header: the connection's address.
    expect(clientAddress(req("10.0.0.2"), 1)).toBe("10.0.0.2");
  });
});

describe("the HTTP server", () => {
  const open: Server[] = [];
  const sockets: Socket[] = [];
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.destroy());
    await Promise.all(open.splice(0).map((s) => new Promise((done) => { s.closeAllConnections(); s.close(done); })));
  });
  async function start(options: { rateLimit?: number; trustProxy?: number } = {}, limits: Limits = LIMITS, now?: () => number) {
    const http = createHttp(() => createServer({ uiHtml: () => "<!doctype html>" }), { rateLimit: options.rateLimit ?? 0, trustProxy: options.trustProxy ?? 0 }, limits, now);
    open.push(http);
    const port = await listen(http, "127.0.0.1", 0);
    return `http://127.0.0.1:${port}`;
  }
  const post = (base: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });
  const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };

  it("answers GET / with a short health line and nothing sensitive", async () => {
    const base = await start();
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toBe("SayShape MCP server: ok. MCP is at /mcp.\n");
    expect(body + JSON.stringify([...r.headers])).not.toMatch(/\d+\.\d+\.\d+|node|\/home|\/usr|express/i);
    expect((await fetch(`${base}/`, { method: "HEAD" })).status).toBe(200);
    expect((await fetch(`${base}/other`)).status).toBe(404);
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });

  it("serves MCP on /mcp as before", async () => {
    const base = await start();
    const client = new Client({ name: "t", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const r = await client.callTool({ name: "show_interface", arguments: { spec: 'card\n  text "Hi"' } });
    expect((r.structuredContent as { toFix: number }).toFix).toBe(0);
    await client.close();
  });

  it("refuses calls over the limit with 429, Retry-After and a JSON-RPC error, until the window resets", async () => {
    let t = 0;
    const base = await start({ rateLimit: 2 }, LIMITS, () => t);
    expect((await post(base, LIST)).status).toBe(200);
    expect((await post(base, LIST)).status).toBe(200);
    const refused = await post(base, LIST);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(await refused.json()).toEqual({ jsonrpc: "2.0", error: { code: -32000, message: "Too many requests. Try again in 60 seconds." }, id: null });
    // The health check isn't counted: the host's own checks must keep working.
    expect((await fetch(`${base}/`)).status).toBe(200);
    t += 60_000;
    expect((await post(base, LIST)).status).toBe(200);
  });

  it("counts every call in a batch", async () => {
    const base = await start({ rateLimit: 5 }, LIMITS, () => 0);
    const batch = Array.from({ length: 6 }, (_, i) => ({ ...LIST, id: i }));
    expect((await post(base, batch)).status).toBe(429);
    expect((await post(base, batch.slice(0, 4))).status).toBe(200);
    expect((await post(base, batch.slice(0, 2))).status).toBe(429);
  });

  it("only trusts X-Forwarded-For when told to", async () => {
    // Untrusted: every request is from 127.0.0.1, whatever the header claims.
    let base = await start({ rateLimit: 1 }, LIMITS, () => 0);
    expect((await post(base, LIST, { "x-forwarded-for": "198.51.100.1" })).status).toBe(200);
    expect((await post(base, LIST, { "x-forwarded-for": "198.51.100.2" })).status).toBe(429);
    // Trusted (one proxy): each forwarded client has its own count.
    base = await start({ rateLimit: 1, trustProxy: 1 }, LIMITS, () => 0);
    expect((await post(base, LIST, { "x-forwarded-for": "198.51.100.1" })).status).toBe(200);
    expect((await post(base, LIST, { "x-forwarded-for": "198.51.100.2" })).status).toBe(200);
    expect((await post(base, LIST, { "x-forwarded-for": "6.6.6.6, 198.51.100.1" })).status).toBe(429);
  });

  /** Opens a raw connection, sends `first`, and resolves with how long until the server closes it. */
  function heldFor(base: string, first: string, drip?: string): Promise<number> {
    const { port } = new URL(base);
    return new Promise((done) => {
      const t0 = Date.now();
      const s = netConnect(Number(port), "127.0.0.1", () => s.write(first));
      sockets.push(s);
      const timer = drip ? setInterval(() => !s.destroyed && s.write(drip), 50) : null;
      s.on("error", () => {});
      s.on("close", () => { if (timer) clearInterval(timer); done(Date.now() - t0); });
    });
  }
  const SHORT: Limits = { requestTimeoutMs: 600, headersTimeoutMs: 300, keepAliveTimeoutMs: 200, maxConnections: 50 };

  it("closes a connection whose headers never finish", async () => {
    const base = await start({}, SHORT);
    const ms = await heldFor(base, "POST /mcp HTTP/1.1\r\nHost: x\r\n", "X-Slow: 1\r\n");
    expect(ms).toBeLessThan(2_000);
  });

  it("closes a connection whose body trickles in forever", async () => {
    const base = await start({}, SHORT);
    const ms = await heldFor(base, "POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100000\r\n\r\n{", " ");
    expect(ms).toBeGreaterThanOrEqual(SHORT.requestTimeoutMs - 50);
    expect(ms).toBeLessThan(2_500);
  });

  it("uses limits that stop slow clients by default: 10 s for headers, 30 s for a request", () => {
    expect(LIMITS).toEqual({ requestTimeoutMs: 30_000, headersTimeoutMs: 10_000, keepAliveTimeoutMs: 5_000, maxConnections: 1_000 });
    const http = createHttp(() => createServer({ uiHtml: () => "" }), { rateLimit: 0, trustProxy: 0 });
    expect([http.requestTimeout, http.headersTimeout, http.keepAliveTimeout, http.maxHeadersCount, http.maxConnections]).toEqual([30_000, 10_000, 5_000, 100, 1_000]);
  });

  it("refuses headers over 16 KB", async () => {
    const base = await start();
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "x-big": "a".repeat(20_000) } }).catch((e: Error) => e);
    expect(r instanceof Response ? r.status : 431).toBe(431);
  });
});

describe("fixes from the review", () => {
  it("works out the repeat key in linear time, even for a line of 20,000 spaces", () => {
    const spec = "card" + " ".repeat(19_990) + "x";
    const t0 = performance.now();
    interfaceKey(spec, {});
    // Was about 270 ms with /\s+$/.
    expect(performance.now() - t0).toBeLessThan(50);
    // Same key as before: trailing whitespace of every kind, and blank lines, don't count.
    expect(interfaceKey("card \t \n\n  text \"Hi\" \r\n", {})).toBe(interfaceKey('card\n  text "Hi"', {}));
  });

  it("builds a server in a few milliseconds, since HTTP mode builds one per request", () => {
    createServer({ uiHtml: () => "" });
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) createServer({ uiHtml: () => "" });
    // Was about 39 ms each, building the guide's sections again every time.
    expect((performance.now() - t0) / 20).toBeLessThan(10);
  });

  it("uses a zod without GHSA-mrhx-c7xc-m3w5 (oversized arrays exhausting memory, fixed in 4.6.6)", () => {
    const version = (JSON.parse(readFileSync(new URL("../node_modules/zod/package.json", import.meta.url), "utf8")) as { version: string }).version;
    const [major, minor, patch] = version.split(".").map(Number) as [number, number, number];
    expect(major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6)))).toBe(true);
  });
});

/**
 * The HTTP mode (--http): Streamable HTTP on /mcp, stateless, with a fresh
 * MCP server and transport for every POST.
 *
 *   GET / (or HEAD /)  a health check: 200 and one plain line
 *   POST /mcp          MCP; any other method there gets 405, any other path 404
 *
 * Built to sit on a public address behind a host's HTTPS proxy: requests and
 * their headers have time limits, bodies a size limit, and each client
 * address a rate limit (on by default off loopback). Nothing from a request is
 * logged.
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clientAddress, RateLimiter } from "./rate-limit";

export const MAX_BODY_BYTES = 1_000_000;
export const DEFAULT_PORT = 3001;
export const DEFAULT_HOST = "127.0.0.1";
/** Calls per minute per client address, by default, when the server listens beyond loopback. */
export const DEFAULT_RATE_LIMIT = 300;

export interface HttpOptions {
  host: string;
  port: number;
  /** Calls per minute per client address; 0 turns the limit off. */
  rateLimit: number;
  /** How many proxies in front of the server write X-Forwarded-For (0: don't read it). */
  trustProxy: number;
  /** --allow-public-data: let --data run on an address beyond loopback. */
  allowPublicData: boolean;
}

/** Time limits. A slow client can't hold a connection longer than these. */
export interface Limits {
  /** The whole request, headers and body. */
  requestTimeoutMs: number;
  /** The headers alone. */
  headersTimeoutMs: number;
  /** An idle connection between requests. */
  keepAliveTimeoutMs: number;
  /** Open connections at once; more are closed as they arrive. */
  maxConnections: number;
}
export const LIMITS: Limits = { requestTimeoutMs: 30_000, headersTimeoutMs: 10_000, keepAliveTimeoutMs: 5_000, maxConnections: 1_000 };
/** Request headers: total size and count. Node's own default size is the same; it's set here so it can't drift. */
export const MAX_HEADER_BYTES = 16 * 1024;
export const MAX_HEADERS = 100;

const HEALTH = "SayShape MCP server: ok. MCP is at /mcp.\n";

export function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^(::ffff:)?127\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Reads --http [port], --host, --rate-limit, --trust-proxy [hops] and
 * --allow-public-data, with PORT and HOST from the environment where no flag
 * gives them. Throws with a message for the person starting it.
 *
 * HOST from the environment is only used when it's an IP address (0.0.0.0, ::,
 * 10.1.2.3): some shells and machines set HOST to the computer's name, which
 * would quietly put the server on the local network.
 */
export function parseHttpArgs(args: readonly string[], env: Record<string, string | undefined>): { options: HttpOptions; notes: string[] } {
  const notes: string[] = [];
  const valueOf = (flag: string) => {
    const at = args.indexOf(flag);
    if (at < 0) return undefined;
    const v = args[at + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value.`);
    return v;
  };
  const httpAt = args.indexOf("--http");
  const portArg = args[httpAt + 1];
  let port = DEFAULT_PORT;
  if (portArg !== undefined && /^\d+$/.test(portArg)) port = Number(portArg);
  else if (env.PORT !== undefined && env.PORT !== "") {
    if (!/^\d+$/.test(env.PORT)) throw new Error(`PORT must be a port number, not "${env.PORT}".`);
    port = Number(env.PORT);
  }
  if (port < 1 || port > 65_535) throw new Error(`The port must be between 1 and 65535, not ${port}.`);

  let host = valueOf("--host");
  if (host === undefined && env.HOST) {
    if (isIP(env.HOST.replace(/^\[|\]$/g, ""))) host = env.HOST.replace(/^\[|\]$/g, "");
    else notes.push(`Ignoring HOST=${env.HOST}: it isn't an IP address. Use --host or an address like 0.0.0.0.`);
  }
  host = (host ?? DEFAULT_HOST).replace(/^\[|\]$/g, "");

  const rateArg = valueOf("--rate-limit");
  if (rateArg !== undefined && !/^\d+$/.test(rateArg)) throw new Error(`--rate-limit takes a number of calls per minute (0 turns it off), not "${rateArg}".`);
  const rateLimit = rateArg !== undefined ? Number(rateArg) : isLoopback(host) ? 0 : DEFAULT_RATE_LIMIT;

  const trustAt = args.indexOf("--trust-proxy");
  let trustProxy = 0;
  if (trustAt >= 0) {
    const hops = args[trustAt + 1];
    trustProxy = hops !== undefined && /^\d+$/.test(hops) ? Number(hops) : 1;
    if (trustProxy < 1 || trustProxy > 10) throw new Error("--trust-proxy takes the number of proxies in front of the server, from 1 to 10.");
  }
  return { options: { host, port, rateLimit, trustProxy, allowPublicData: args.includes("--allow-public-data") }, notes };
}

/** What --data on a public address would hand an anonymous caller, and how to go ahead anyway. */
export const PUBLIC_DATA_REFUSAL =
  "--data on an address beyond this computer would let anyone who can reach it, with no sign-in, read every table in the database " +
  "(query_data runs any SELECT), fetch other callers' query results by their id (d1, d2…), and stall the server with one slow query. " +
  "Use --host 127.0.0.1, or start it with --allow-public-data if the database holds nothing private and the address is protected some other way.";

/** The refusal for --data beyond loopback, unless --allow-public-data; undefined when it may start. */
export function dataRefusal(withData: boolean, options: Pick<HttpOptions, "host" | "allowPublicData">): string | undefined {
  return withData && !isLoopback(options.host) && !options.allowPublicData ? PUBLIC_DATA_REFUSAL : undefined;
}

function jsonError(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: status === 429 ? -32000 : -32700, message }, id: null }));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}

/**
 * The HTTP server, not yet listening. makeServer builds the MCP server for
 * one request. Tests pass shorter limits and their own clock.
 */
export function createHttp(makeServer: () => McpServer, options: Pick<HttpOptions, "rateLimit" | "trustProxy">, limits: Limits = LIMITS, now: () => number = Date.now): Server {
  const limiter = options.rateLimit > 0 ? new RateLimiter(options.rateLimit, now) : null;
  const refuse = (res: ServerResponse, retryAfterSeconds: number) =>
    jsonError(res, 429, `Too many requests. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`, { "Retry-After": String(retryAfterSeconds) });

  const http = createHttpServer({
    maxHeaderSize: MAX_HEADER_BYTES,
    requestTimeout: limits.requestTimeoutMs,
    // Node checks the two timeouts above only this often (30 s by default), which would let a slow client stay up to twice as long.
    connectionsCheckingInterval: Math.min(1_000, Math.max(50, Math.floor(limits.headersTimeoutMs / 4))),
  }, async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/" && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end(req.method === "HEAD" ? undefined : HEALTH);
      return;
    }
    if (path !== "/mcp") {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("SayShape MCP server: use /mcp\n");
      return;
    }
    if (req.method !== "POST") {
      // Stateless: no server-sent event streams to resume and no sessions to end.
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    const who = limiter ? clientAddress(req, options.trustProxy) : "";
    // One call up front, so a flood is turned away before its bodies are read.
    const first = limiter?.take(who, 1);
    if (first && !first.ok) return refuse(res, first.retryAfterSeconds);
    try {
      const body = await readJson(req);
      // A batch costs one call for each message in it.
      if (limiter && Array.isArray(body) && body.length > 1) {
        const rest = limiter.take(who, body.length - 1);
        if (!rest.ok) return refuse(res, rest.retryAfterSeconds);
      }
      // A fresh server and transport per request keeps requests independent.
      // Datasets live in the shared DataSource, so a later request (the interface fetching rows) finds them.
      const server = makeServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      jsonError(res, 400, "Bad request");
    }
  });
  // Set again as properties: not every Node version this package supports reads them from the options.
  http.requestTimeout = limits.requestTimeoutMs;
  http.headersTimeout = limits.headersTimeoutMs;
  http.keepAliveTimeout = limits.keepAliveTimeoutMs;
  http.maxHeadersCount = MAX_HEADERS;
  http.maxConnections = limits.maxConnections;
  return http;
}

/** Starts listening; resolves with the port (useful when port is 0). */
export async function listen(http: Server, host: string, port: number): Promise<number> {
  await new Promise<void>((done, fail) => {
    http.once("error", fail);
    http.listen(port, host, () => { http.off("error", fail); done(); });
  });
  const address = http.address();
  return typeof address === "object" && address ? address.port : port;
}

/** The startup line: where it listens and how the limit works. Nothing about callers. */
export function startupLine(options: HttpOptions, port: number): string {
  const shown = options.host.includes(":") ? `[${options.host}]` : options.host;
  const limit = options.rateLimit > 0
    ? `rate limit ${options.rateLimit} calls a minute per client address${options.trustProxy ? `, read from X-Forwarded-For (${options.trustProxy} trusted proxy hop${options.trustProxy === 1 ? "" : "s"})` : ", the connection's own address"}`
    : "no rate limit";
  return `SayShape MCP server on http://${shown}:${port}/mcp (${limit})`;
}

/**
 * A Cloudflare Worker that passes MCP requests on to the hosted SayShape MCP
 * server, so the address people add to their chat app belongs to this Worker
 * and not to wherever the server happens to run. Moving the server is then a
 * change to UPSTREAM, and nobody has to reconnect.
 *
 * It forwards two paths and nothing else: "/" (the server's health check) and
 * "/mcp". It reads no bodies and logs nothing, the same as the server.
 */

export interface Env {
  /** Where the MCP server runs, without a path: https://example.run.app */
  UPSTREAM: string;
  /** Per-caller limit (wrangler.toml [[ratelimits]]). Without it nothing is counted here. */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

/** The window of the limit in wrangler.toml, for Retry-After. */
export const RATE_PERIOD_SECONDS = 60;

const PATHS = new Set(["/", "/mcp"]);

/**
 * Headers that describe this hop, not the request: the caller's own claims
 * about who they are (anyone can send X-Forwarded-For), and what a proxy must
 * not pass on.
 */
const DROPPED = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded",
]);

const json = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), { status, headers: { "Content-Type": "application/json", ...headers } });

export async function handle(req: Request, env: Env, send: typeof fetch = fetch): Promise<Response> {
  const url = new URL(req.url);
  if (!PATHS.has(url.pathname)) return new Response("Not found. The SayShape MCP server is at /mcp.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!env.UPSTREAM) return json(502, "The SayShape MCP server's address isn't set. Set UPSTREAM in wrangler.toml and deploy again.");

  // Cloudflare writes CF-Connecting-IP itself, so a caller can't choose it.
  const caller = req.headers.get("CF-Connecting-IP") ?? "";
  if (url.pathname === "/mcp" && env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key: caller || "unknown" });
    if (!success) return json(429, `Too many requests. Try again in ${RATE_PERIOD_SECONDS} seconds.`, { "Retry-After": String(RATE_PERIOD_SECONDS) });
  }

  const headers = new Headers();
  req.headers.forEach((value, name) => {
    const n = name.toLowerCase();
    if (!DROPPED.has(n) && !n.startsWith("cf-")) headers.set(name, value);
  });
  if (caller) headers.set("X-Forwarded-For", caller);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  // The body is passed on as it arrives; duplex says so where the runtime asks (Node), and Workers ignore it.
  const init = { method: req.method, headers, body: hasBody ? req.body : undefined, redirect: "manual", duplex: "half" } as RequestInit;
  let res: Response;
  try {
    res = await send(new URL(url.pathname + url.search, env.UPSTREAM).toString(), init);
  } catch {
    return json(502, "The SayShape MCP server didn't answer. Try again in a moment.");
  }
  // The server's reply as it is, streamed: status, headers and body.
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

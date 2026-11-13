/**
 * The Worker in front of the hosted MCP server (deploy/cloudflare/src/handler.ts):
 * what it passes on, what it refuses, and that a caller can't choose the
 * address it's counted by.
 */
import { describe, expect, it } from "vitest";
import { handle, RATE_PERIOD_SECONDS, type Env } from "../deploy/cloudflare/src/handler";

const UPSTREAM = "https://server.example";
const env: Env = { UPSTREAM };

interface Sent { url: string; method: string; headers: Headers; body: string }

/** A stand-in for the server: records what reached it and answers with `reply`. */
function upstream(reply: () => Response = () => new Response("ok")): { send: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? await new Response(init.body as BodyInit).text() : "";
    sent.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body });
    return reply();
  }) as typeof fetch;
  return { send, sent };
}

const post = (headers: Record<string, string> = {}, body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}') =>
  new Request("https://proxy.example/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }, body });

describe("the MCP proxy Worker", () => {
  it("passes a call to /mcp on with its method, body and headers", async () => {
    const { send, sent } = upstream();
    const res = await handle(post({ "Mcp-Protocol-Version": "2025-06-18" }), env, send);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`${UPSTREAM}/mcp`);
    expect(sent[0]!.method).toBe("POST");
    expect(sent[0]!.body).toContain('"tools/list"');
    expect(sent[0]!.headers.get("accept")).toBe("application/json, text/event-stream");
    expect(sent[0]!.headers.get("mcp-protocol-version")).toBe("2025-06-18");
  });

  it("passes the health check on", async () => {
    const { send, sent } = upstream(() => new Response("SayShape MCP server: ok."));
    const res = await handle(new Request("https://proxy.example/"), env, send);
    expect(await res.text()).toBe("SayShape MCP server: ok.");
    expect(sent[0]!.url).toBe(`${UPSTREAM}/`);
    expect(sent[0]!.method).toBe("GET");
  });

  it("answers 404 for any other path without calling the server", async () => {
    const { send, sent } = upstream();
    for (const path of ["/admin", "/mcp/extra", "/.env", "/mcp/../secret"]) {
      const res = await handle(new Request(`https://proxy.example${path}`), env, send);
      expect(res.status, path).toBe(404);
    }
    expect(sent).toHaveLength(0);
  });

  it("gives the server's reply back as it is: status, headers and body", async () => {
    const { send } = upstream(() => new Response('event: message\ndata: {"result":{}}\n\n', { status: 200, headers: { "Content-Type": "text/event-stream", "Mcp-Session-Id": "abc" } }));
    const res = await handle(post(), env, send);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("mcp-session-id")).toBe("abc");
    expect(await res.text()).toContain('data: {"result":{}}');
    const { send: refuse } = upstream(() => new Response("{}", { status: 429, headers: { "Retry-After": "12" } }));
    const refused = await handle(post(), env, refuse);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("12");
  });

  it("names the caller from Cloudflare's header, never from what the caller sent", async () => {
    const { send, sent } = upstream();
    await handle(post({ "CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "1.2.3.4", "X-Real-IP": "1.2.3.4", Forwarded: "for=1.2.3.4" }), env, send);
    const h = sent[0]!.headers;
    expect(h.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(h.get("x-real-ip")).toBeNull();
    expect(h.get("forwarded")).toBeNull();
    expect(h.get("cf-connecting-ip")).toBeNull();
  });

  it("sends no X-Forwarded-For when Cloudflare named no caller", async () => {
    const { send, sent } = upstream();
    await handle(post({ "X-Forwarded-For": "1.2.3.4" }), env, send);
    expect(sent[0]!.headers.get("x-forwarded-for")).toBeNull();
  });

  it("counts calls to /mcp by caller and refuses past the limit without calling the server", async () => {
    const keys: string[] = [];
    let allowed = 2;
    const limited: Env = { UPSTREAM, RATE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: allowed-- > 0 }; } } };
    const { send, sent } = upstream();
    expect((await handle(post({ "CF-Connecting-IP": "203.0.113.7" }), limited, send)).status).toBe(200);
    expect((await handle(post({ "CF-Connecting-IP": "203.0.113.7" }), limited, send)).status).toBe(200);
    const res = await handle(post({ "CF-Connecting-IP": "203.0.113.7" }), limited, send);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe(String(RATE_PERIOD_SECONDS));
    expect((await res.json() as { error: { message: string } }).error.message).toMatch(/Too many requests/);
    expect(keys).toEqual(["203.0.113.7", "203.0.113.7", "203.0.113.7"]);
    expect(sent).toHaveLength(2);
  });

  it("doesn't count the health check", async () => {
    let asked = 0;
    const limited: Env = { UPSTREAM, RATE_LIMITER: { limit: async () => { asked++; return { success: false }; } } };
    const { send } = upstream();
    expect((await handle(new Request("https://proxy.example/"), limited, send)).status).toBe(200);
    expect(asked).toBe(0);
  });

  it("answers 502 in plain words when the server can't be reached or isn't set", async () => {
    const down = (async () => { throw new Error("connect ECONNREFUSED 10.0.0.1:443"); }) as typeof fetch;
    const res = await handle(post(), env, down);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toMatch(/didn't answer/);
    expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.1/);
    const { send, sent } = upstream();
    expect((await handle(post(), { UPSTREAM: "" }, send)).status).toBe(502);
    expect(sent).toHaveLength(0);
  });

  it("doesn't follow the server's redirects", async () => {
    let seen: RequestInit | undefined;
    const send = (async (_: RequestInfo | URL, init?: RequestInit) => { seen = init; return new Response(null, { status: 302, headers: { Location: "https://elsewhere.example/" } }); }) as typeof fetch;
    const res = await handle(new Request("https://proxy.example/"), env, send);
    expect(seen?.redirect).toBe("manual");
    expect(res.status).toBe(302);
  });
});

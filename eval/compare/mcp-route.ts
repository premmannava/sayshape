/**
 * SayShape the way a chat app with the MCP server gets it (format "mcp"): the model sees the
 * server's own tools, show_interface (whose description carries the short quick start) and
 * sayshape_docs (props and examples for just the elements it asks for), and the server's
 * instructions in its system prompt, never the whole guide. Every tool call goes to the real
 * server, run in memory (mcp/src/local.ts), and its result goes back to the model, until the
 * model stops calling tools. The answer is the last spec it showed; cost and time add up every
 * turn of the exchange, docs lookups and fixes included.
 *
 * The server lives in mcp/, with its own dependencies, so it's loaded only when this format
 * runs: install them first with `npm ci --prefix mcp`.
 */
import { fileURLToPath } from "node:url";
import type { ModelConfig, Usage } from "../../src/model/stream";
import { tidySpec } from "../../src/model/clean";

/** The most model turns one answer may take: looking up docs, showing, fixing, and a last message. */
export const MAX_TURNS = 6;

/** The tools this route offers: the server also has data tools, which these requests don't need. */
const TOOLS = ["show_interface", "sayshape_docs"];

/** The parts of the MCP client this uses, typed here so the library doesn't need mcp/'s packages to typecheck. */
interface McpTool { name: string; description?: string; inputSchema: Record<string, unknown> }
interface McpResult { content?: Array<{ type: string; text?: string }>; isError?: boolean }
interface McpClient {
  listTools(): Promise<{ tools: McpTool[] }>;
  callTool(req: { name: string; arguments: Record<string, unknown> }): Promise<McpResult>;
  getInstructions(): string | undefined;
  close(): Promise<void>;
}

type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
interface Reply {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
  usage?: {
    prompt_tokens?: number; completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
    cache_read_input_tokens?: number; cache_write_tokens?: number; cache_creation_input_tokens?: number;
  };
  error?: { message?: string } | string;
}

export interface McpAnswer {
  output: string;
  raw: string;
  usage: Usage;
  totalMs: number;
  inputChars: number;
  /** Model turns, and how many of them asked sayshape_docs or showed an interface. */
  turns: number;
  docsCalls: number;
  showCalls: number;
}

async function connect(): Promise<McpClient> {
  const path = fileURLToPath(new URL("../../mcp/src/local.ts", import.meta.url));
  let mod: { connectLocal: () => Promise<McpClient> };
  try {
    mod = (await import(/* @vite-ignore */ path)) as typeof mod;
  } catch (e) {
    throw new Error(`The MCP route needs the server's packages: run npm ci --prefix mcp (${e instanceof Error ? e.message : String(e)})`);
  }
  return mod.connectLocal();
}

const textOf = (r: McpResult) => (r.content ?? []).map((c) => c.text ?? "").join("\n");

/** Each turn's usage added in; a figure no turn reported stays unknown, never 0. */
function addUsage(total: Usage, u: Reply["usage"]): void {
  if (!u) return;
  const add = (k: keyof Usage, v: number | undefined) => { if (v !== undefined) total[k] = (total[k] ?? 0) + v; };
  add("promptTokens", u.prompt_tokens);
  add("completionTokens", u.completion_tokens);
  add("cachedTokens", u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens);
  add("cacheWriteTokens", u.prompt_tokens_details?.cache_write_tokens ?? u.cache_write_tokens ?? u.cache_creation_input_tokens);
}

/** The system message as a text block marked for caching. Anthropic caches tools and system together. */
function withCache(messages: Message[], cache: true | "1h" | undefined): unknown[] {
  if (!cache) return messages;
  return messages.map((m) => m.role === "system"
    ? { role: "system", content: [{ type: "text", text: m.content, cache_control: cache === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" } }] }
    : m);
}

/** One request answered through the MCP server's tools. */
export async function askMcp(request: string, config: ModelConfig, fetchImpl: typeof fetch = fetch): Promise<McpAnswer> {
  const client = await connect();
  const start = performance.now();
  try {
    const tools = (await client.listTools()).tools.filter((t) => TOOLS.includes(t.name))
      .map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema } }));
    const system = ["You are a helpful assistant in a chat app.", client.getInstructions() ?? ""].filter(Boolean).join("\n\n");
    const messages: Message[] = [{ role: "system", content: system }, { role: "user", content: request }];
    const usage: Usage = {};
    const cache = config.cache === true ? true : config.cache === "1h" ? "1h" : undefined;
    let spec = "", turns = 0, docsCalls = 0, showCalls = 0;
    const inputChars = system.length + request.length + JSON.stringify(tools).length;
    while (turns < MAX_TURNS) {
      turns++;
      const res = await fetchImpl(`${config.url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
        body: JSON.stringify({ model: config.model, messages: withCache(messages, cache), tools, max_tokens: config.maxTokens ?? 8000, usage: { include: true } }),
      });
      const json = (await res.json()) as Reply;
      if (!res.ok || json.error) {
        const msg = typeof json.error === "string" ? json.error : json.error?.message ?? `HTTP ${res.status}`;
        throw new Error(`The model server reported an error: ${msg}`);
      }
      addUsage(usage, json.usage);
      const message = json.choices?.[0]?.message ?? {};
      const calls = message.tool_calls ?? [];
      messages.push({ role: "assistant", content: message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
      if (!calls.length) break;
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>; } catch { /* the server reports the bad arguments */ }
        if (call.function.name === "sayshape_docs") docsCalls++;
        if (call.function.name === "show_interface") {
          showCalls++;
          if (typeof args.spec === "string") spec = tidySpec(args.spec);
        }
        let result: string;
        try { result = textOf(await client.callTool({ name: call.function.name, arguments: args })); }
        catch (e) { result = `Error: ${e instanceof Error ? e.message : String(e)}`; }
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
    return { output: spec, raw: JSON.stringify(messages.slice(2)), usage, totalMs: performance.now() - start, inputChars, turns, docsCalls, showCalls };
  } finally {
    await client.close();
  }
}

/**
 * A chat completion with tools, from any OpenAI-compatible endpoint (OpenRouter, OpenAI, a local server):
 * one request, no streaming, tools sent as `tools` and answered as `tool_calls`. src/model/ streams
 * plain text without tools, so this is a small client of its own, like eval/compare/mcp-route.ts has.
 *
 * The key goes only into the Authorization header of the request. It's never put in an error message,
 * a transcript or a result.
 */
import type { Usage } from "../../src/model/stream";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** The model's message as the server sent it, kept whole: some servers need fields like reasoning_details sent back with the next request. */
export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
  [extra: string]: unknown;
}

export type Message =
  | { role: "system" | "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatReply {
  message: AssistantMessage;
  usage: Usage;
  ms: number;
}

export type ChatFn = (messages: Message[], tools: ToolSpec[]) => Promise<ChatReply>;

export class ChatError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ChatError";
  }
}

export interface ChatConfig {
  /** Base URL up to /v1. */
  url: string;
  model: string;
  apiKey?: string;
  /** Per reply, thinking included. Default 8000. */
  maxTokens?: number;
  /** Left out by default: the provider's own (some reasoning models refuse the field). */
  temperature?: number;
  /** Mark the system message for prompt caching (true: about 5 minutes, "1h": an hour). */
  cache?: true | "1h";
  fetch?: typeof fetch;
  /** Waits between tries when the server says 429 or fails with 5xx, in ms. Default 2000, 6000. */
  retryDelays?: number[];
}

interface Reply {
  choices?: Array<{ message?: Record<string, unknown> }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
    cache_read_input_tokens?: number;
    cache_write_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: { message?: string } | string;
}

/** A reply's token counts; a figure the server didn't send stays missing, never 0. */
export function usageOf(u: Reply["usage"]): Usage {
  if (!u) return {};
  const out: Usage = {};
  if (u.prompt_tokens !== undefined) out.promptTokens = u.prompt_tokens;
  if (u.completion_tokens !== undefined) out.completionTokens = u.completion_tokens;
  const read = u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens;
  if (read !== undefined) out.cachedTokens = read;
  const written = u.prompt_tokens_details?.cache_write_tokens ?? u.cache_write_tokens ?? u.cache_creation_input_tokens;
  if (written !== undefined) out.cacheWriteTokens = written;
  return out;
}

/** Each figure in b added to a; a figure neither reported stays missing. */
export function addUsage(a: Usage, b: Usage): Usage {
  const out: Usage = { ...a };
  for (const k of Object.keys(b) as Array<keyof Usage>) {
    const v = b[k];
    if (v !== undefined) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/** The system message as a text block marked for caching; Anthropic caches the tools along with it. */
function withCache(messages: Message[], cache: true | "1h" | undefined): unknown[] {
  if (!cache) return messages;
  return messages.map((m) =>
    m.role === "system"
      ? { role: "system", content: [{ type: "text", text: m.content, cache_control: cache === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" } }] }
      : m,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function openAiChat(config: ChatConfig): ChatFn {
  const doFetch = config.fetch ?? fetch;
  const url = `${config.url.replace(/\/+$/, "")}/chat/completions`;
  const delays = config.retryDelays ?? [2000, 6000];
  return async (messages, tools) => {
    const body = JSON.stringify({
      model: config.model,
      messages: withCache(messages, config.cache),
      tools,
      max_tokens: config.maxTokens ?? 8000,
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      // OpenRouter reports cost and cache figures with this; other servers ignore it.
      usage: { include: true },
    });
    for (let attempt = 0; ; attempt++) {
      const start = performance.now();
      let res: Response | undefined;
      let failure = "";
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
          body,
        });
      } catch (e) {
        failure = `The model server could not be reached at ${config.url}: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (res) {
        const text = await res.text();
        let json: Reply = {};
        try { json = JSON.parse(text) as Reply; } catch { /* not JSON: reported below */ }
        const error = typeof json.error === "string" ? json.error : json.error?.message;
        const message = json.choices?.[0]?.message;
        if (res.ok && !error && message) {
          const content = typeof message.content === "string" ? message.content : null;
          const calls = Array.isArray(message.tool_calls) ? (message.tool_calls as ToolCall[]) : undefined;
          return {
            message: { ...message, role: "assistant", content, ...(calls?.length ? { tool_calls: calls } : {}) } as AssistantMessage,
            usage: usageOf(json.usage),
            ms: performance.now() - start,
          };
        }
        failure = `The model server reported an error (HTTP ${res.status}): ${error ?? (message ? "no message" : text.slice(0, 200) || "empty reply")}`;
        if (res.status !== 429 && res.status < 500) throw new ChatError(failure, res.status);
      }
      const wait = delays[attempt];
      if (wait === undefined) throw new ChatError(failure, res?.status);
      await sleep(wait);
    }
  };
}

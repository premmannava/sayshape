/**
 * A scripted stand-in for a model, speaking the OpenAI-compatible chat API with tool calls, so the
 * colors check can run end to end with no model and no key: in tests, and with
 * `npm run colors-eval -- --stub <behavior>` to see the report and the transcripts.
 *
 * It reads the conversation like a very simple model would: it looks up the docs for a chart or a
 * dashboard first, then shows an interface, and what it does with colors is the behavior:
 *
 *   keeper    sends the colors the person named on every call until they ask to go back to normal
 *   forgetter sends them only in the message that names them
 *   inventor  sends colors nobody asked for, always
 *   plain     never sends colors
 *   mixed     keeper, but the second later call has them in another order and the third drops them
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AssistantMessage, Message, ToolCall } from "./chat";

export const STUB_BEHAVIORS = ["keeper", "forgetter", "inventor", "plain", "mixed"] as const;
export type StubBehavior = (typeof STUB_BEHAVIORS)[number];

interface Body {
  messages: Message[];
}

const HEX = /(?<![\w#])#?[0-9a-f]{6}(?!\w)/gi;
const RESET = /normal|default|standard|forget|drop the/i;

/** The hex colors written in a message, with a # on each; words that merely look like hex have no digit and are skipped. */
function hexIn(text: string): string[] {
  return (text.match(HEX) ?? []).filter((h) => /\d/.test(h)).map((h) => (h.startsWith("#") ? h : `#${h}`));
}

const userTexts = (messages: Message[]): string[] => messages.filter((m) => m.role === "user").map((m) => m.content as string);

function colorsFor(behavior: StubBehavior, messages: Message[]): string[] | undefined {
  const users = userTexts(messages);
  const latest = users[users.length - 1] ?? "";
  if (behavior === "plain") return undefined;
  if (behavior === "inventor") return ["#ff6f61", "#2ec4b6"];
  if (behavior === "forgetter") return hexIn(latest).length ? hexIn(latest) : undefined;
  const named = users.findIndex((t) => hexIn(t).length > 0);
  if (named < 0 || RESET.test(latest)) return undefined;
  const list = hexIn(users[named]!);
  if (behavior === "keeper") return list;
  // mixed: how many interfaces came before this one decides what it does
  const shown = messages.filter((m) => m.role === "assistant" && (m as AssistantMessage).tool_calls?.some((c) => c.function.name === "show_interface")).length;
  if (shown === 2 && list.length > 1) return [...list].reverse();
  if (shown === 3) return undefined;
  return list;
}

const callOf = (n: number, name: string, args: unknown): ToolCall => ({ id: `call_${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });

/** The scripted model's next message for a conversation so far. */
export function stubMessage(behavior: StubBehavior, messages: Message[]): AssistantMessage {
  const last = messages[messages.length - 1];
  const n = messages.length;
  if (last?.role === "tool") {
    const asked = [...messages].reverse().find((m): m is AssistantMessage => m.role === "assistant" && !!m.tool_calls?.some((c) => c.id === last.tool_call_id));
    const name = asked?.tool_calls?.find((c) => c.id === last.tool_call_id)?.function.name;
    if (name !== "sayshape_docs") return { role: "assistant", content: "Here it is." };
    return show(behavior, messages, n);
  }
  const text = last?.role === "user" ? last.content : "";
  if (/chart|dashboard|funnel|pie/i.test(text)) return { role: "assistant", content: null, tool_calls: [callOf(n, "sayshape_docs", { elements: ["chart"] })] };
  return show(behavior, messages, n);
}

function show(behavior: StubBehavior, messages: Message[], n: number): AssistantMessage {
  const users = userTexts(messages);
  const title = (users[users.length - 1] ?? "Interface").replace(/[^A-Za-z0-9 ]/g, "").slice(0, 28).trim() || "Interface";
  const colors = colorsFor(behavior, messages);
  const spec = `state n=${n}\ncard\n  text "${title}" style=title\n  stat label="Count" value={n}\n`;
  return { role: "assistant", content: null, tool_calls: [callOf(n, "show_interface", { ...(colors ? { colors } : {}), spec, title })] };
}

/** The server's JSON reply to a chat completion request. */
export function stubReply(behavior: StubBehavior, body: Body): unknown {
  const message = stubMessage(behavior, body.messages);
  const prompt = Math.ceil(JSON.stringify(body.messages).length / 4);
  return {
    choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: prompt, completion_tokens: Math.ceil(JSON.stringify(message).length / 4), prompt_tokens_details: { cached_tokens: 0 } },
  };
}

/** A stub as an HTTP server on a free local port, for the script's --stub flag and for tests of the real HTTP path. */
export async function startStub(behavior: StubBehavior): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      try {
        if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) throw new Error("not found");
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Body;
        res.end(JSON.stringify(stubReply(behavior, body)));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: e instanceof Error ? e.message : String(e) } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  // Node 18's server.close waits for idle keep-alive connections (fetch leaves one open); later Nodes close them.
  const close = () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
  return { url: `http://127.0.0.1:${port}/v1`, close };
}

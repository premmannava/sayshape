/**
 * Measures how a model does with SayShape through this MCP server, the way a
 * chat app runs it: the server's instructions, its tools (sayshape_docs and
 * show_interface), and the model calling them until it answers in text.
 *
 * The question is how often a model gets an interface right the first time,
 * and when it doesn't, which mistakes made it retry. Each retry is a full
 * round trip that resends the conversation, so the common mistakes are worth
 * fixing at the source (examples, messages, or quietly accepting the slip).
 *
 * The model is a function, so the loop can be tested without a network
 * (test/eval.test.ts); scripts/eval.ts calls a real OpenAI-compatible server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export interface ToolCall { id: string; name: string; arguments: string }
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}
export interface ChatTool { type: "function"; function: { name: string; description: string; parameters: unknown } }
export interface ChatReply { text: string | null; toolCalls: ToolCall[]; promptTokens?: number; completionTokens?: number }
/** One model turn: the conversation so far and the tools it may call. */
export type ChatFn = (messages: ChatMessage[], tools: ChatTool[]) => Promise<ChatReply>;

/** One show_interface call as the server judged it. */
export interface ShowCall { toFix: number; repeat: boolean; problems: string[]; refused: boolean }

export interface CaseResult {
  id: string;
  request: string;
  shows: ShowCall[];
  docsCalls: number;
  /** Model turns: each is a full round trip. */
  turns: number;
  promptTokens: number;
  completionTokens: number;
  ms: number;
  finalText: string | null;
  error?: string;
}

/** The server's tools in the shape chat completions APIs take. */
export async function chatTools(client: Client): Promise<ChatTool[]> {
  const { tools } = await client.listTools();
  // fetch_dataset is for the interface only; a chat app never offers it to the model.
  return tools.filter((t) => t.name !== "fetch_dataset").map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema },
  }));
}

/** What the model reads back from a tool call: its text, as chat apps pass it on. */
function resultText(r: Record<string, unknown>): string {
  const content = (r.content as Array<{ type: string; text?: string }> | undefined) ?? [];
  return content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

/** Run one request to the end: until the model answers without calling a tool, or maxTurns. */
export async function runCase(
  opts: { client: Client; chat: ChatFn; id: string; request: string; maxTurns?: number; now?: () => number },
): Promise<CaseResult> {
  const now = opts.now ?? Date.now;
  const start = now();
  const tools = await chatTools(opts.client);
  const messages: ChatMessage[] = [
    { role: "system", content: opts.client.getInstructions() ?? "" },
    { role: "user", content: opts.request },
  ];
  const out: CaseResult = { id: opts.id, request: opts.request, shows: [], docsCalls: 0, turns: 0, promptTokens: 0, completionTokens: 0, ms: 0, finalText: null };
  try {
    for (let turn = 0; turn < (opts.maxTurns ?? 8); turn++) {
      const reply = await opts.chat(messages, tools);
      out.turns++;
      out.promptTokens += reply.promptTokens ?? 0;
      out.completionTokens += reply.completionTokens ?? 0;
      if (!reply.toolCalls.length) { out.finalText = reply.text; break; }
      messages.push({
        role: "assistant",
        content: reply.text,
        tool_calls: reply.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
      });
      for (const call of reply.toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.arguments || "{}") as Record<string, unknown>; } catch { /* the server reports bad arguments */ }
        const r = (await opts.client.callTool({ name: call.name, arguments: args })) as Record<string, unknown>;
        const text = resultText(r);
        if (call.name === "sayshape_docs") out.docsCalls++;
        if (call.name === "show_interface") out.shows.push(showCall(r, text));
        messages.push({ role: "tool", tool_call_id: call.id, content: text });
      }
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  out.ms = now() - start;
  return out;
}

function showCall(r: Record<string, unknown>, text: string): ShowCall {
  const s = (r.structuredContent ?? {}) as { toFix?: number; repeat?: boolean; diagnostics?: Array<{ message: string }> };
  if (r.isError) return { toFix: 1, repeat: false, problems: [text], refused: true };
  return { toFix: s.toFix ?? 0, repeat: s.repeat === true, problems: (s.diagnostics ?? []).map((d) => d.message), refused: false };
}

/**
 * A mistake with its specifics taken out, so the same slip on different
 * elements and names counts once: quoted names and numbers become … and N.
 */
export function mistakeOf(message: string): string {
  return message
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\{[^}]*\}/g, "{…}")
    .replace(/\b\d+(\.\d+)?\b/g, "N")
    .replace(/Known props: .*/, "Known props: …")
    .trim();
}

export interface Summary {
  cases: number;
  /** Requests that showed an interface at all. */
  showed: number;
  /** First show_interface call had nothing to fix. */
  firstTry: number;
  /** The last show_interface call had nothing to fix. */
  endedClean: number;
  /** Calls the server marked as repeats of the interface just shown. */
  repeats: number;
  /** show_interface calls beyond the first, over all requests. */
  extraShows: number;
  docsCalls: number;
  turns: number;
  promptTokens: number;
  completionTokens: number;
  errors: number;
  /** The mistakes behind retries, most common first, with one real example each. */
  mistakes: Array<{ mistake: string; count: number; example: string; cases: string[] }>;
}

export function summarize(results: CaseResult[]): Summary {
  const mistakes = new Map<string, { count: number; example: string; cases: Set<string> }>();
  for (const r of results) {
    for (const s of r.shows) {
      if (s.repeat || s.toFix === 0) continue;
      for (const p of s.problems) {
        const k = mistakeOf(p);
        const m = mistakes.get(k) ?? { count: 0, example: p, cases: new Set<string>() };
        m.count++;
        m.cases.add(r.id);
        mistakes.set(k, m);
      }
    }
  }
  const showed = results.filter((r) => r.shows.length > 0);
  return {
    cases: results.length,
    showed: showed.length,
    firstTry: showed.filter((r) => r.shows[0]!.toFix === 0).length,
    endedClean: showed.filter((r) => r.shows[r.shows.length - 1]!.toFix === 0).length,
    repeats: results.reduce((t, r) => t + r.shows.filter((s) => s.repeat).length, 0),
    extraShows: results.reduce((t, r) => t + Math.max(0, r.shows.length - 1), 0),
    docsCalls: results.reduce((t, r) => t + r.docsCalls, 0),
    turns: results.reduce((t, r) => t + r.turns, 0),
    promptTokens: results.reduce((t, r) => t + r.promptTokens, 0),
    completionTokens: results.reduce((t, r) => t + r.completionTokens, 0),
    errors: results.filter((r) => r.error).length,
    mistakes: [...mistakes.entries()]
      .map(([mistake, m]) => ({ mistake, count: m.count, example: m.example, cases: [...m.cases] }))
      .sort((a, b) => b.count - a.count),
  };
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");

/** The report, in Markdown: the numbers, the top mistakes, then every request. */
export function report(model: string, results: CaseResult[]): string {
  const s = summarize(results);
  const lines = [
    `# SayShape MCP evaluation: ${model}`,
    "",
    `${s.cases} requests, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    "",
    "| | |",
    "|---|---|",
    `| Showed an interface | ${s.showed} of ${s.cases} (${pct(s.showed, s.cases)}) |`,
    `| Right the first time | ${s.firstTry} of ${s.showed} (${pct(s.firstTry, s.showed)}) |`,
    `| Ended with nothing to fix | ${s.endedClean} of ${s.showed} (${pct(s.endedClean, s.showed)}) |`,
    `| Extra show_interface calls | ${s.extraShows} (${(s.extraShows / Math.max(1, s.cases)).toFixed(2)} per request), ${s.repeats} of them repeats |`,
    `| sayshape_docs calls | ${s.docsCalls} |`,
    `| Model turns | ${s.turns} (${(s.turns / Math.max(1, s.cases)).toFixed(1)} per request) |`,
    `| Tokens | ${s.promptTokens.toLocaleString("en-US")} in, ${s.completionTokens.toLocaleString("en-US")} out |`,
    `| Errors | ${s.errors} |`,
    "",
    "## Mistakes that caused retries",
    "",
  ];
  if (!s.mistakes.length) lines.push("None.");
  for (const m of s.mistakes.slice(0, 20)) {
    lines.push(`- **${m.count}×** ${m.mistake}`, `  - e.g. ${m.example}`, `  - in ${m.cases.join(", ")}`);
  }
  lines.push("", "## Every request", "", "| Request | Shows | First try | Ended clean | Docs | Turns |", "|---|---|---|---|---|---|");
  for (const r of results) {
    const first = r.shows[0], last = r.shows[r.shows.length - 1];
    lines.push(`| ${r.id}${r.error ? ` (error: ${r.error.slice(0, 60)})` : ""} | ${r.shows.length} | ${first ? (first.toFix === 0 ? "yes" : `no (${first.toFix})`) : "–"} | ${last ? (last.toFix === 0 ? "yes" : "no") : "–"} | ${r.docsCalls} | ${r.turns} |`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Do models keep the colors? Runs the conversations in prompts.ts against a model that has the MCP
 * server's tools, and scores every show_interface call's colors argument (score.ts).
 *
 * A conversation is a list of what the person says. For each message the model answers until it stops
 * calling tools: it may look up docs, show an interface, fix it, and say something at the end. Every tool
 * call goes to the backend, which in a real run is the real server (connect.ts), and the result goes back
 * to the model. Nothing about colors is in any prompt but the person's own words, the tool's description
 * and the note at the end of a result; those are the real ones unless a variant swaps them (variants.ts).
 *
 * Hard caps keep a conversation from running away: model requests per message, requests per
 * conversation, and tokens per conversation. A conversation that hits one stops there and is marked.
 */
import type { Usage } from "../../src/model/stream";
import { addUsage, ChatError, type AssistantMessage, type ChatFn, type Message, type ToolSpec } from "./chat";
import { SYSTEM, type Conversation } from "./prompts";
import { addToTally, emptyTally, normalizeColors, scoreCall, type CallScore, type Tally, type TurnRecord } from "./score";
import { colorsInNote, NOTE_PATTERN, noteText, type TextVariant } from "./variants";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** What a conversation talks to: the tools, the server's instructions, and a way to call a tool. */
export interface Backend {
  tools: ToolDef[];
  instructions: string;
  /** The text of the tool's result. */
  call(name: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export interface Limits {
  /** Model requests for one message of the person's (docs lookup, show, fix, last words). */
  maxTurnRequests: number;
  /** Model requests in one conversation. */
  maxRequests: number;
  /** Prompt plus reply tokens, added up over a conversation's requests (an estimate where the server reports none). */
  maxTokens: number;
}

export const DEFAULT_LIMITS: Limits = { maxTurnRequests: 6, maxRequests: 40, maxTokens: 400_000 };

/** One show_interface call, scored, with what was sent and what came back. */
export interface CallRecord extends CallScore {
  /** The colors argument as the model wrote it (undefined when it left it out). */
  rawColors: unknown;
  /** The first line of the spec, for finding the call in a transcript. */
  specStart: string;
  /** The result text the model was given. */
  result: string;
}

export interface ConversationResult {
  id: string;
  kind: "A" | "B";
  set: string;
  model: string;
  run: number;
  /** What the person named, normalized. */
  wanted: string[];
  calls: CallRecord[];
  turns: TurnRecord[];
  requests: number;
  usage: Usage;
  /** True when a figure above is an estimate because the server reported none. */
  estimated: boolean;
  ms: number;
  /** Ended before the last message: why. */
  stopped?: string;
  /** show_interface calls whose arguments were not JSON, so they could not be scored. */
  malformed: number;
  /** The whole exchange, system message first. */
  messages: Message[];
}

/** A backend whose colors description or colors note is in a variant's words. Without either, it's the same backend. */
export function withVariant(backend: Backend, variant: TextVariant): Backend {
  const { description, note } = variant;
  if (description === undefined && note === undefined) return backend;
  const tools = backend.tools.map((t) => {
    if (description === undefined || t.name !== "show_interface") return t;
    const props = (t.inputSchema as { properties?: Record<string, Record<string, unknown>> }).properties;
    if (!props?.colors) return t;
    return { ...t, inputSchema: { ...t.inputSchema, properties: { ...props, colors: { ...props.colors, description } } } };
  });
  return {
    ...backend,
    tools,
    async call(name, args) {
      const result = await backend.call(name, args);
      if (note === undefined || name !== "show_interface") return result;
      return result.replace(NOTE_PATTERN, (line, lead: string) => {
        const colors = colorsInNote(line.slice(lead.length));
        return colors.length ? `${lead}${noteText(note, colors)}` : line;
      });
    },
  };
}

const toSpec = (t: ToolDef): ToolSpec => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } });

const guessTokens = (messages: Message[], reply: AssistantMessage) => Math.round((JSON.stringify(messages).length + JSON.stringify(reply).length) / 4);

export interface RunOptions {
  model: string;
  run: number;
  chat: ChatFn;
  backend: Backend;
  limits?: Partial<Limits>;
}

export async function runConversation(conv: Conversation, o: RunOptions): Promise<ConversationResult> {
  const limits = { ...DEFAULT_LIMITS, ...o.limits };
  const start = performance.now();
  const tools = o.backend.tools.map(toSpec);
  const messages: Message[] = [{ role: "system", content: [SYSTEM, o.backend.instructions].filter(Boolean).join("\n\n") }];
  const result: ConversationResult = {
    id: conv.id, kind: conv.kind, set: conv.set, model: o.model, run: o.run, wanted: normalizeColors(conv.wanted),
    calls: [], turns: [], requests: 0, usage: {}, estimated: false, ms: 0, malformed: 0, messages,
  };
  let tokens = 0;

  conversation: for (const [turn, say] of conv.turns.entries()) {
    messages.push({ role: "user", content: say.text });
    const record: TurnRecord = { turn, phase: say.phase, calls: 0, noInterface: true };
    result.turns.push(record);
    for (let n = 0; ; n++) {
      if (n >= limits.maxTurnRequests) { result.stopped = `more than ${limits.maxTurnRequests} model requests for one message (turn ${turn + 1})`; break conversation; }
      if (result.requests >= limits.maxRequests) { result.stopped = `${limits.maxRequests} model requests in one conversation`; break conversation; }
      if (tokens >= limits.maxTokens) { result.stopped = `${tokens.toLocaleString("en-US")} tokens in one conversation (limit ${limits.maxTokens.toLocaleString("en-US")})`; break conversation; }
      let reply;
      try {
        reply = await o.chat(messages, tools);
      } catch (e) {
        result.stopped = e instanceof Error ? e.message : String(e);
        if (!(e instanceof ChatError)) result.stopped = `error: ${result.stopped}`;
        break conversation;
      }
      result.requests++;
      result.usage = addUsage(result.usage, reply.usage);
      const { promptTokens, completionTokens } = reply.usage;
      if (promptTokens === undefined || completionTokens === undefined) result.estimated = true;
      tokens += promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : guessTokens(messages, reply.message);
      messages.push(reply.message);
      const calls = reply.message.tool_calls ?? [];
      if (!calls.length) break;
      for (const call of calls) {
        let args: Record<string, unknown> | undefined;
        try {
          const parsed: unknown = JSON.parse(call.function.arguments || "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
        } catch { /* reported to the model below */ }
        let text: string;
        if (!args) {
          text = "Error: the arguments were not a JSON object.";
          if (call.function.name === "show_interface") result.malformed++;
        } else {
          try { text = await o.backend.call(call.function.name, args); }
          catch (e) { text = `Error: ${e instanceof Error ? e.message : String(e)}`; }
        }
        if (args && call.function.name === "show_interface") {
          record.calls++;
          record.noInterface = false;
          const spec = typeof args.spec === "string" ? args.spec : "";
          result.calls.push({
            ...scoreCall(turn, say.phase, args.colors, conv.wanted),
            rawColors: args.colors,
            specStart: spec.split("\n")[0]?.slice(0, 80) ?? "",
            result: text,
          });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: text });
      }
    }
  }
  // A message the model was stopped in the middle of, with nothing shown yet, wasn't answered: it isn't a turn without an interface.
  if (result.stopped && result.turns[result.turns.length - 1]?.calls === 0) result.turns.pop();
  result.ms = performance.now() - start;
  return result;
}

/** The conversations of a model's results, counted. */
export function tallyOf(results: readonly ConversationResult[]): Tally {
  const t = emptyTally();
  for (const r of results) addToTally(t, { kind: r.kind, stopped: r.stopped !== undefined, calls: r.calls, turns: r.turns });
  return t;
}

export interface EvalJob {
  model: string;
  conversation: Conversation;
  run: number;
}

export interface EvalOptions {
  models: string[];
  conversations: Conversation[];
  runs: number;
  /** One chat function per model. */
  chatFor: (model: string) => ChatFn;
  /** A fresh backend for each conversation. */
  connect: () => Promise<Backend>;
  variant?: TextVariant;
  limits?: Partial<Limits>;
  concurrency?: number;
  onResult?: (r: ConversationResult, done: number, total: number) => void;
}

/** Run order: round by round (run, conversation, model), so a slow server or a changing price touches every model alike. */
export function jobsFor(o: Pick<EvalOptions, "models" | "conversations" | "runs">): EvalJob[] {
  const jobs: EvalJob[] = [];
  for (let run = 1; run <= o.runs; run++) for (const conversation of o.conversations) for (const model of o.models) jobs.push({ model, conversation, run });
  return jobs;
}

export async function runEval(o: EvalOptions): Promise<ConversationResult[]> {
  const jobs = jobsFor(o);
  const results: ConversationResult[] = new Array(jobs.length);
  let next = 0, done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      const job = jobs[i];
      if (!job) return;
      const backend = withVariant(await o.connect(), o.variant ?? {});
      try {
        const r = await runConversation(job.conversation, { model: job.model, run: job.run, chat: o.chatFor(job.model), backend, limits: o.limits });
        results[i] = r;
        o.onResult?.(r, ++done, jobs.length);
      } finally {
        await backend.close();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 1, jobs.length)) }, worker));
  return results;
}

/**
 * Runs the conversations in sessions.ts: every step of a session in order, each format the way
 * it's used across a conversation, scored after every step with that step's checks.
 *
 * - SayShape refines: the model gets the original request, the changes asked for since, the
 *   current spec and the new change (src/model/context.ts), never the whole conversation.
 * - HTML gets the whole conversation, its earlier pages included, and writes the page again,
 *   as chat apps that show HTML do.
 * - A2UI gets the whole conversation and changes the surface it already made: what's drawn after
 *   a step is every message since the surface was last created. A reply that creates the surface
 *   again starts over from that reply.
 *
 * Every answer is a first try, as in run.ts. Cost and time add up over the session.
 */
import { generateSpec } from "../../src/model/generate";
import { nextRefineContext, type RefineContext } from "../../src/model/context";
import { streamChat, type ChatMessage, type ModelConfig, type Usage } from "../../src/model/stream";
import type { GuideOptions } from "../../src/prompt";
import type { Registry } from "../../src/registry";
import { a2uiPrompt } from "./a2ui";
import { cleanA2ui } from "./a2ui-screen";
import { cleanHtml, costOf, HTML_PROMPT, score, type CheckResult, type Prices } from "./run";
import type { Session } from "./sessions";

export type SessionFormat = "sayshape" | "html" | "a2ui";

/** Told to A2UI after its usual framing: how a conversation goes on with the same surface. */
export const A2UI_FOLLOW_UP = "Later requests in the conversation change the interface already shown: reply with only the messages that change it (updateComponents for components to add or replace, updateDataModel for data), without creating the surface again.";

export interface StepResult {
  model: string;
  session: string;
  step: number;
  format: SessionFormat;
  ok: boolean;
  error?: string;
  /** What's drawn after this step: the spec, the page, or the A2UI messages since the surface was made. */
  output: string;
  /** What the model wrote in reply to this step. */
  raw: string;
  usage: Usage;
  cost?: number;
  firstTokenMs?: number;
  totalMs: number;
  valid: boolean;
  problems: string[];
  checks: CheckResult[];
  success: boolean;
}

export interface SessionOptions {
  config: Omit<ModelConfig, "model">;
  models: string[];
  formats?: SessionFormat[];
  registry: Registry;
  guide?: GuideOptions;
  prices?: Record<string, Prices>;
  fetch?: typeof fetch;
  onResult?: (r: StepResult, done: number, total: number) => void;
}

const clock = () => performance.now();

interface Reply { raw: string; usage: Usage; firstTokenMs?: number; totalMs: number }

async function chat(config: ModelConfig, messages: ChatMessage[], fetchImpl?: typeof fetch): Promise<Reply> {
  const start = clock();
  const usage: Usage = {};
  let raw = "", firstTokenMs: number | undefined;
  for await (const part of streamChat(config, messages, { usage, fetch: fetchImpl })) {
    firstTokenMs ??= clock() - start;
    if (part.kind === "content") raw += part.text;
  }
  return { raw, usage, firstTokenMs, totalMs: clock() - start };
}

/** One format's way through a conversation: answer the next step, and what to draw now. */
interface Conversation { next(request: string): Promise<Reply & { output: string }> }

function sayshapeConversation(config: ModelConfig, registry: Registry, guide: GuideOptions, fetchImpl?: typeof fetch): Conversation {
  let ctx: RefineContext | null = null;
  return {
    async next(request) {
      const r = await generateSpec({ config, registry, request, guide, repairOn: "never", fetch: fetchImpl, ...(ctx ? { refine: ctx } : {}) });
      ctx = ctx ? nextRefineContext(ctx, request, r.spec) : { task: request, spec: r.spec };
      return { output: r.spec, raw: r.first.raw, usage: r.first.usage, firstTokenMs: r.first.firstTokenMs, totalMs: r.timings.totalMs };
    },
  };
}

function htmlConversation(config: ModelConfig, fetchImpl?: typeof fetch): Conversation {
  const history: ChatMessage[] = [];
  return {
    async next(request) {
      const reply = await chat(config, [{ role: "system", content: HTML_PROMPT }, ...history, { role: "user", content: request }], fetchImpl);
      history.push({ role: "user", content: request }, { role: "assistant", content: reply.raw });
      return { ...reply, output: cleanHtml(reply.raw) };
    },
  };
}

function a2uiConversation(config: ModelConfig, fetchImpl?: typeof fetch): Conversation {
  const system = `${a2uiPrompt()}\n\n${A2UI_FOLLOW_UP}`;
  const history: ChatMessage[] = [];
  let surface = "";
  return {
    async next(request) {
      const reply = await chat(config, [{ role: "system", content: system }, ...history, { role: "user", content: request }], fetchImpl);
      history.push({ role: "user", content: request }, { role: "assistant", content: reply.raw });
      const messages = cleanA2ui(reply.raw);
      surface = /"createSurface"/.test(messages) || !surface ? messages : `${surface}\n${messages}`;
      return { ...reply, output: surface };
    },
  };
}

/** Every session, in each format and model, step by step; formats rotate by session so none always goes first. */
export async function runSessions(list: Session[], o: SessionOptions): Promise<StepResult[]> {
  const formats = o.formats ?? ["sayshape", "html", "a2ui"];
  const guide = o.guide ?? { imageHosts: [], mode: "compact" };
  const total = o.models.length * formats.length * list.reduce((n, s) => n + s.steps.length, 0);
  const out: StepResult[] = [];
  for (const model of o.models) {
    const config: ModelConfig = { ...o.config, model, streamUsage: o.config.streamUsage ?? true };
    for (const [i, session] of list.entries()) {
      const shift = i % formats.length;
      for (const format of [...formats.slice(shift), ...formats.slice(0, shift)]) {
        const convo = format === "sayshape" ? sayshapeConversation(config, o.registry, guide, o.fetch)
          : format === "html" ? htmlConversation(config, o.fetch) : a2uiConversation(config, o.fetch);
        let failed: string | undefined;
        for (const [j, step] of session.steps.entries()) {
          const base = { model, session: session.id, step: j + 1, format };
          const task = { id: `${session.id}.${j + 1}`, category: "dashboard" as const, request: step.request, checks: step.checks };
          let r: StepResult;
          if (failed) {
            r = { ...base, ok: false, error: `an earlier step failed: ${failed}`, output: "", raw: "", usage: {}, totalMs: 0, valid: false, problems: ["not run"], checks: step.checks.map((c) => ({ label: c.label, passed: false, why: "not run" })), success: false };
          } else {
            try {
              const a = await convo.next(step.request);
              const s = await score(format, task, a.output);
              const p = o.prices?.[model];
              r = { ...base, ok: true, output: a.output, raw: a.raw, usage: a.usage, cost: p ? costOf(a.usage, p) : undefined, firstTokenMs: a.firstTokenMs, totalMs: a.totalMs, valid: s.valid, problems: s.problems, checks: s.checks, success: s.valid && s.checks.every((c) => c.passed) };
            } catch (e) {
              failed = e instanceof Error ? e.message : String(e);
              r = { ...base, ok: false, error: failed, output: "", raw: "", usage: {}, totalMs: 0, valid: false, problems: ["request failed"], checks: step.checks.map((c) => ({ label: c.label, passed: false, why: "request failed" })), success: false };
            }
          }
          out.push(r);
          o.onResult?.(r, out.length, total);
        }
      }
    }
  }
  return out;
}

// ---- Report ----

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const num = (x: number | undefined) => (x === undefined ? "?" : Math.round(x).toLocaleString("en-US"));
const secs = (ms: number | undefined) => (ms === undefined ? "?" : `${(ms / 1000).toFixed(1)} s`);
const usd = (x: number | undefined, digits = 4) => (x === undefined ? "?" : `$${x.toLocaleString("en-US", { minimumFractionDigits: x >= 100 ? 0 : digits, maximumFractionDigits: x >= 100 ? 0 : digits })}`);

export interface SessionSummary {
  model: string;
  format: SessionFormat;
  steps: number;
  stepsWorking: number;
  sessions: number;
  sessionsWorking: number;
  /** Per session, averaged over sessions. */
  inputTokens?: number;
  outputTokens?: number;
  totalMs?: number;
  cost?: number;
  /** Average input tokens at each step number, to show how the context grows. */
  inputByStep: Array<number | undefined>;
}

export function summarizeSessions(results: StepResult[]): SessionSummary[] {
  const keys = [...new Set(results.map((r) => `${r.model}\u0000${r.format}`))];
  return keys.map((k) => {
    const [model, format] = k.split("\u0000") as [string, SessionFormat];
    const rs = results.filter((r) => r.model === model && r.format === format);
    const ids = [...new Set(rs.map((r) => r.session))];
    const per = ids.map((id) => rs.filter((r) => r.session === id));
    const sumOf = (xs: StepResult[], f: (r: StepResult) => number | undefined) => { const v = xs.map(f); return v.every((x) => x !== undefined) ? (v as number[]).reduce((a, b) => a + b, 0) : undefined; };
    const known = (xs: Array<number | undefined>) => xs.filter((x): x is number => x !== undefined);
    const maxStep = Math.max(...rs.map((r) => r.step));
    return {
      model, format,
      steps: rs.length,
      stepsWorking: rs.filter((r) => r.success).length,
      sessions: ids.length,
      sessionsWorking: per.filter((s) => s.every((r) => r.success)).length,
      inputTokens: mean(known(per.map((s) => sumOf(s, (r) => r.usage.promptTokens)))),
      outputTokens: mean(known(per.map((s) => sumOf(s, (r) => r.usage.completionTokens)))),
      totalMs: mean(per.map((s) => s.reduce((t, r) => t + r.totalMs, 0))),
      cost: mean(known(per.map((s) => sumOf(s, (r) => r.cost)))),
      inputByStep: Array.from({ length: maxStep }, (_, i) => mean(known(rs.filter((r) => r.step === i + 1).map((r) => r.usage.promptTokens)))),
    };
  });
}

export function sessionReport(results: StepResult[], meta: { date: string; url: string; guide: string; cache?: true | "1h" }): string {
  const sums = summarizeSessions(results);
  const name = (f: SessionFormat) => (f === "sayshape" ? "SayShape (refine)" : f === "a2ui" ? "A2UI (updates)" : "HTML (rewrites)");
  const lines = [`# Conversations: SayShape, HTML and A2UI over several steps`, "",
    `${meta.date} · ${meta.url} · SayShape guide: ${meta.guide} · prompt caching ${meta.cache ? "marked" : "not marked"} · first tries only`, "",
    "Each session is four requests in a row; each step is checked on the screen as it is after that step. Tokens, time and cost are per whole session, averaged over the sessions.", "",
    "## Summary", "",
    "| Model | Format | Steps working | Whole sessions working | Input tokens | Output tokens | Time | Cost per session | Cost for 100,000 sessions |",
    "|---|---|---|---|---|---|---|---|---|"];
  for (const s of sums) {
    lines.push(`| ${s.model} | ${name(s.format)} | ${s.stepsWorking}/${s.steps} | ${s.sessionsWorking}/${s.sessions} | ${num(s.inputTokens)} | ${num(s.outputTokens)} | ${secs(s.totalMs)} | ${usd(s.cost)} | ${s.cost === undefined ? "?" : usd(s.cost * 100_000, 0)} |`);
  }
  const steps = Math.max(...sums.map((s) => s.inputByStep.length));
  lines.push("", "## How the context grows", "", "Average input tokens sent at each step.", "",
    `| Model | Format | ${Array.from({ length: steps }, (_, i) => `Step ${i + 1}`).join(" | ")} |`, `|---|---|${"---|".repeat(steps)}`);
  for (const s of sums) lines.push(`| ${s.model} | ${name(s.format)} | ${s.inputByStep.map((x) => num(x)).join(" | ")} |`);
  lines.push("", "## Every step", "", "| Session | Step | Model | Format | Works | Failed checks or problems | Input | Output | Time |", "|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const failed = r.ok ? [...r.problems, ...r.checks.filter((c) => !c.passed).map((c) => `${c.label} (${c.why})`)] : [r.error ?? "request failed"];
    lines.push(`| ${r.session} | ${r.step} | ${r.model} | ${r.format} | ${r.success ? "yes" : "no"} | ${failed.join("; ").replace(/\|/g, "\\|").slice(0, 300)} | ${num(r.usage.promptTokens)} | ${num(r.usage.completionTokens)} | ${secs(r.totalMs)} |`);
  }
  return lines.join("\n") + "\n";
}

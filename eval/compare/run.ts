/**
 * Runs the SayShape vs HTML benchmark: every task, in both formats, for each
 * model, a number of times. Each answer is a first try (no repair), so both
 * formats get the same single chance. What's recorded per answer:
 *
 * - cost and speed: input and output tokens as the server reported them,
 *   time to first token, total time, and cost from the model's prices;
 * - whether it works: SayShape with no error diagnostics, HTML with no script
 *   errors, and each task check passed (see tasks.ts and screens.ts);
 * - the code itself: size, and for HTML the patterns that cost safety or
 *   theming (inserting HTML strings, eval, external scripts, fixed colors).
 */
import { generateSpec } from "../../src/model/generate";
import { streamChat, type ChatMessage, type ModelConfig, type Usage } from "../../src/model/stream";
import { languageGuide, type GuideOptions } from "../../src/prompt";
import type { Registry } from "../../src/registry";
import { a2uiPrompt } from "./a2ui";
import { a2uiScreen, cleanA2ui } from "./a2ui-screen";
import { htmlScreen, sayshapeScreen, type Screen } from "./screens";
import type { Task, TaskCheck } from "./tasks";

export type Format = "sayshape" | "html" | "a2ui";

/**
 * What the HTML answer is told. Kept short and fair: the same constraints a
 * chat app puts on generated widgets, and the one chart library it may use.
 */
export const HTML_PROMPT = [
  "You write interactive UI for a chat app as one HTML fragment: markup, a <style> block and <script> blocks, without <html>, <head> or <body>.",
  "It renders in a sandboxed frame about 600px wide, in light or dark mode.",
  'For charts you may load Chart.js 4 with <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>; load nothing else from the network.',
  "Make every control work. Output only the HTML: no explanation and no Markdown fences.",
].join("\n");

export interface Prices {
  /** Dollars per input token and per output token. */
  prompt: number;
  completion: number;
  /** Dollars per input token read from or written to the prompt cache, when the server lists them. */
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * What an answer cost. Cached and cache-written input tokens are part of the
 * prompt tokens; they're charged at their own prices when those are known, and
 * at the normal input price when they aren't (which overstates a cache read).
 */
export function costOf(u: Usage, p: Prices): number | undefined {
  if (u.promptTokens === undefined || u.completionTokens === undefined) return undefined;
  const read = u.cachedTokens ?? 0, written = u.cacheWriteTokens ?? 0;
  const plain = Math.max(0, u.promptTokens - read - written);
  return plain * p.prompt + read * (p.cacheRead ?? p.prompt) + written * (p.cacheWrite ?? p.prompt) + u.completionTokens * p.completion;
}

export interface CheckResult {
  label: string;
  passed: boolean;
  /** Why it failed: a step that found nothing to act on, or the text that didn't match. */
  why?: string;
  /** A check that data stays text (security tasks). */
  safety?: boolean;
}

export interface AnswerResult {
  model: string;
  task: string;
  category: Task["category"];
  format: Format;
  run: number;
  /** False when the request itself failed (network, server error). */
  ok: boolean;
  error?: string;
  output: string;
  raw: string;
  usage: Usage;
  /** Dollars, when the model's prices and both token counts are known. */
  cost?: number;
  firstTokenMs?: number;
  totalMs: number;
  /** Characters sent (system prompt and request). */
  inputChars: number;
  /** Renders without errors: no error diagnostics (SayShape), no script errors (HTML). */
  valid: boolean;
  problems: string[];
  checks: CheckResult[];
  /** Valid and every check passed. */
  success: boolean;
  /**
   * A2UI only: an answer that renders but failed only checks that need using it, and whose
   * controls send an event to the server. A2UI's basic catalog has no client-side way to change
   * data, so the agent answers those events with another model call: by design, not a broken answer.
   */
  waitsOnServer?: boolean;
  /** Whether a repair ran, and the first try's result, when it did. */
  repaired?: boolean;
  firstSuccess?: boolean;
  firstOutput?: string;
  code: CodeStats;
}

export interface CodeStats {
  chars: number;
  lines: number;
  /** HTML: inserting HTML strings (innerHTML, outerHTML, insertAdjacentHTML, document.write). */
  htmlInserts: number;
  /** HTML: eval, new Function, or a string passed to setTimeout/setInterval. */
  codeFromStrings: number;
  externalScripts: number;
  /** HTML: fixed hex or rgb() colors, which don't follow light and dark mode. */
  fixedColors: number;
  /** SayShape: warnings (the element is kept, the bad part ignored). */
  warnings: number;
}

export function codeStats(format: Format, code: string, warnings = 0): CodeStats {
  const n = (re: RegExp) => code.match(re)?.length ?? 0;
  const html = format === "html";
  return {
    chars: code.length,
    lines: code ? code.split("\n").length : 0,
    htmlInserts: html ? n(/\.(innerHTML|outerHTML)\s*\+?=|insertAdjacentHTML\s*\(|document\.write(ln)?\s*\(/g) : 0,
    codeFromStrings: html ? n(/\beval\s*\(|new\s+Function\s*\(|set(Timeout|Interval)\s*\(\s*["'`]/g) : 0,
    externalScripts: html ? n(/<script\b[^>]*\bsrc=/gi) : 0,
    fixedColors: html ? n(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(\s*\d/g) : 0,
    warnings,
  };
}

/** The HTML inside a reply: thinking removed, and the first fenced block if the model fenced it anyway. */
export function cleanHtml(raw: string): string {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "");
  const fenced = /```[a-zA-Z]*\s*\n([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

export interface Answer {
  output: string;
  raw: string;
  usage: Usage;
  firstTokenMs?: number;
  totalMs: number;
  inputChars: number;
  /** SayShape's own count of problems, from the parser. */
  warnings?: number;
  /** When a repair ran: the first answer, before it. output is then the repaired one. */
  firstOutput?: string;
}

const clock = () => performance.now();

/**
 * A SayShape answer. With repair, the way the product works: when the first answer
 * has any diagnostics, they go back to the model once and its fixed spec is used.
 */
export async function askSayShape(task: Task, config: ModelConfig, registry: Registry, guide: GuideOptions, fetchImpl?: typeof fetch, repair = false): Promise<Answer> {
  const r = await generateSpec({ config, registry, request: task.request, guide, repairOn: repair ? "any" : "never", fetch: fetchImpl });
  const u = r.usage;
  return {
    output: r.spec,
    raw: r.repair?.raw ?? r.first.raw,
    // Over both attempts when a repair ran.
    usage: r.repair ? { promptTokens: u.promptTokens, completionTokens: u.completionTokens, reasoningTokens: u.reasoningTokens, cachedTokens: u.cachedTokens, cacheWriteTokens: u.cacheWriteTokens } : r.first.usage,
    firstTokenMs: r.first.firstTokenMs,
    totalMs: r.timings.totalMs,
    inputChars: r.first.inputChars + (r.repair?.inputChars ?? 0),
    warnings: r.diagnostics.filter((d) => d.severity === "warning").length,
    ...(r.repair ? { firstOutput: r.first.spec } : {}),
  };
}

/** What an HTML answer is sent back with when it ran with errors: the counterpart of SayShape's repair. */
export function htmlRepairPrompt(problems: string[]): string {
  return `Your HTML had these problems when it ran:\n${problems.slice(0, 10).map((p) => `- ${p}`).join("\n")}\nReply with the whole corrected HTML fragment only.`;
}

/**
 * An HTML answer. With repair, when the first answer runs with script errors or
 * shows nothing, the problems go back to the model once and its fixed HTML is used.
 */
export async function askHtml(task: Task, config: ModelConfig, fetchImpl?: typeof fetch, repair = false): Promise<Answer> {
  const messages: ChatMessage[] = [{ role: "system", content: HTML_PROMPT }, { role: "user", content: task.request }];
  const start = clock();
  let firstTokenMs: number | undefined;
  const ask = async (msgs: ChatMessage[]) => {
    const usage: Usage = {};
    let raw = "";
    for await (const part of streamChat(config, msgs, { usage, fetch: fetchImpl })) {
      firstTokenMs ??= clock() - start;
      if (part.kind === "content") raw += part.text;
    }
    return { raw, usage };
  };
  const first = await ask(messages);
  const firstOutput = cleanHtml(first.raw);
  const inputChars = HTML_PROMPT.length + task.request.length;
  if (repair) {
    const { valid, problems } = await score("html", { ...task, checks: [] }, firstOutput);
    if (!valid) {
      const fix: ChatMessage[] = [...messages, { role: "assistant", content: first.raw }, { role: "user", content: htmlRepairPrompt(problems) }];
      const second = await ask(fix);
      return {
        output: cleanHtml(second.raw), raw: second.raw, usage: addUsage(first.usage, second.usage), firstTokenMs, totalMs: clock() - start,
        inputChars: inputChars + fix.reduce((n, m) => n + m.content.length, 0), firstOutput,
      };
    }
  }
  return { output: firstOutput, raw: first.raw, usage: first.usage, firstTokenMs, totalMs: clock() - start, inputChars };
}

let a2uiSystem: string | undefined;

/**
 * An A2UI answer: A2UI's own schemas and examples as the system prompt (a2ui.ts), the
 * reply's JSON messages kept. First try only: A2UI has no repair step of its own here.
 */
export async function askA2ui(task: Task, config: ModelConfig, fetchImpl?: typeof fetch): Promise<Answer> {
  a2uiSystem ??= a2uiPrompt();
  const messages: ChatMessage[] = [{ role: "system", content: a2uiSystem }, { role: "user", content: task.request }];
  const start = clock();
  let firstTokenMs: number | undefined;
  const usage: Usage = {};
  let raw = "";
  for await (const part of streamChat(config, messages, { usage, fetch: fetchImpl })) {
    firstTokenMs ??= clock() - start;
    if (part.kind === "content") raw += part.text;
  }
  return { output: cleanA2ui(raw), raw, usage, firstTokenMs, totalMs: clock() - start, inputChars: a2uiSystem.length + task.request.length };
}

/** Two attempts' usage added up; a figure either didn't report stays unknown. */
function addUsage(a: Usage, b: Usage): Usage {
  const out: Usage = {};
  for (const k of ["promptTokens", "completionTokens", "reasoningTokens", "cachedTokens", "cacheWriteTokens"] as const) {
    if (a[k] !== undefined && b[k] !== undefined) out[k] = a[k]! + b[k]!;
  }
  return out;
}

async function open(format: Format, code: string): Promise<Screen> {
  return format === "sayshape" ? sayshapeScreen(code) : format === "a2ui" ? a2uiScreen(code) : htmlScreen(code);
}

/** Run one check on a fresh screen. */
export async function runCheck(format: Format, code: string, check: TaskCheck): Promise<CheckResult> {
  const r = await runSteps(format, code, check);
  return check.safe ? { ...r, safety: true } : r;
}

async function runSteps(format: Format, code: string, check: TaskCheck): Promise<CheckResult> {
  const screen = await open(format, code);
  try {
    const before = screen.text();
    for (const step of check.steps ?? []) {
      const did = "type" in step ? await screen.type(...step.type) : await screen.press(step.press);
      if (!did && !("press" in step && step.optional)) return { label: check.label, passed: false, why: "type" in step ? `no text field #${step.type[0] + 1} to type in` : `nothing to press matching ${step.press}` };
    }
    const after = screen.text();
    const joined = after.join("\n");
    const missing = (check.shows ?? []).filter((re) => !re.test(joined));
    if (missing.length) return { label: check.label, passed: false, why: `doesn't show ${missing.join(", ")}` };
    const present = (check.hides ?? []).filter((re) => re.test(joined));
    if (present.length) return { label: check.label, passed: false, why: `still shows ${present.join(", ")}` };
    if (check.changes && after.join("\n") === before.join("\n")) return { label: check.label, passed: false, why: "nothing on screen changed" };
    if (check.test && !check.test(after, before)) return { label: check.label, passed: false, why: "what's shown isn't right" };
    if (check.safe && screen.injected()) return { label: check.label, passed: false, why: "text from the data became HTML elements" };
    return { label: check.label, passed: true };
  } catch (e) {
    return { label: check.label, passed: false, why: `the check crashed: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    screen.destroy();
  }
}

/** Load the answer once for validity, then run every check on its own fresh screen. */
export async function score(format: Format, task: Task, code: string): Promise<{ valid: boolean; problems: string[]; checks: CheckResult[] }> {
  if (!code.trim()) return { valid: false, problems: ["empty answer"], checks: task.checks.map((c) => ({ label: c.label, passed: false, why: "empty answer" })) };
  let problems: string[];
  let empty = false;
  try {
    const screen = await open(format, code);
    problems = [...screen.errors];
    empty = screen.text().length === 0;
    screen.destroy();
  } catch (e) {
    problems = [`couldn't load: ${e instanceof Error ? e.message : String(e)}`];
  }
  if (empty) problems.push("shows nothing");
  const checks: CheckResult[] = [];
  for (const c of task.checks) checks.push(await runCheck(format, code, c));
  return { valid: problems.length === 0, problems, checks };
}

export interface CompareOptions {
  /** Base settings; model is replaced per model. */
  config: Omit<ModelConfig, "model">;
  models: string[];
  formats?: Format[];
  runs?: number;
  registry: Registry;
  guide?: GuideOptions;
  /** One repair per answer when the first has problems (SayShape diagnostics, HTML script errors). */
  repair?: boolean;
  prices?: Record<string, Prices>;
  fetch?: typeof fetch;
  onResult?: (r: AnswerResult, done: number, total: number) => void;
}

/**
 * Every task × format × model × run, one request at a time so timings aren't
 * skewed by requests competing. Formats alternate per task, so a server that
 * slows down over the run affects both alike.
 */
export async function runCompare(tasks: Task[], o: CompareOptions): Promise<AnswerResult[]> {
  const formats = o.formats ?? ["sayshape", "html"];
  const runs = o.runs ?? 1;
  const guide = o.guide ?? { imageHosts: [] };
  const total = tasks.length * formats.length * o.models.length * runs;
  const out: AnswerResult[] = [];
  for (let run = 1; run <= runs; run++) {
    for (const model of o.models) {
      const config: ModelConfig = { ...o.config, model, streamUsage: o.config.streamUsage ?? true };
      for (const [i, task] of tasks.entries()) {
        // Rotate which format goes first, task by task, so none is always first (or last).
        const shift = (i + run - 1) % formats.length;
        const order = [...formats.slice(shift), ...formats.slice(0, shift)];
        for (const format of order) {
          const r = await answerOne(task, format, model, run, config, o, guide);
          out.push(r);
          o.onResult?.(r, out.length, total);
        }
      }
    }
  }
  return out;
}

async function answerOne(task: Task, format: Format, model: string, run: number, config: ModelConfig, o: CompareOptions, guide: GuideOptions): Promise<AnswerResult> {
  const base = { model, task: task.id, category: task.category, format, run };
  let a: Answer;
  try {
    a = format === "sayshape" ? await askSayShape(task, config, o.registry, guide, o.fetch, o.repair)
      : format === "a2ui" ? await askA2ui(task, config, o.fetch)
      : await askHtml(task, config, o.fetch, o.repair);
  } catch (e) {
    return {
      ...base, ok: false, error: e instanceof Error ? e.message : String(e), output: "", raw: "", usage: {}, totalMs: 0, inputChars: 0,
      valid: false, problems: ["request failed"], checks: task.checks.map((c) => ({ label: c.label, passed: false, why: "request failed" })), success: false, code: codeStats(format, ""),
    };
  }
  const s = await score(format, task, a.output);
  const p = o.prices?.[model];
  const cost = p ? costOf(a.usage, p) : undefined;
  return {
    ...base, ok: true, output: a.output, raw: a.raw, usage: a.usage, cost, firstTokenMs: a.firstTokenMs, totalMs: a.totalMs, inputChars: a.inputChars,
    valid: s.valid, problems: s.problems, checks: s.checks, success: s.valid && s.checks.every((c) => c.passed),
    ...(format === "a2ui" ? { waitsOnServer: waitsOnServer(task, a.output, s) } : {}),
    code: codeStats(format, a.output, a.warnings ?? 0),
    ...(o.repair ? await firstTry(format, task, a) : {}),
  };
}

/** See AnswerResult.waitsOnServer. */
export function waitsOnServer(task: Task, code: string, s: { valid: boolean; checks: CheckResult[] }): boolean {
  if (!s.valid || s.checks.every((c) => c.passed)) return false;
  const failedNeedUse = task.checks.every((c, i) => s.checks[i]?.passed || (c.steps?.length ?? 0) > 0);
  return failedNeedUse && /"action"\s*:\s*\{\s*"event"/.test(code);
}

/** With repair on: whether it ran, and how the first answer did on its own. */
async function firstTry(format: Format, task: Task, a: Answer): Promise<Pick<AnswerResult, "repaired" | "firstSuccess" | "firstOutput">> {
  if (a.firstOutput === undefined) return { repaired: false };
  const f = await score(format, task, a.firstOutput);
  return { repaired: true, firstOutput: a.firstOutput, firstSuccess: f.valid && f.checks.every((c) => c.passed) };
}

/** The system prompt each format is sent, for the report. */
export function systemPrompt(format: Format, registry: Registry, guide: GuideOptions = { imageHosts: [] }): string {
  if (format === "a2ui") return (a2uiSystem ??= a2uiPrompt());
  return format === "sayshape" ? languageGuide(registry, guide) : HTML_PROMPT;
}

// ---- Summaries ----

const median = (xs: number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
};
const known = (xs: Array<number | undefined>) => xs.filter((x): x is number => x !== undefined);

export interface Summary {
  model: string;
  format: Format;
  answers: number;
  failedRequests: number;
  validRate: number;
  successRate: number;
  /** Without the repair: first answers that worked (equals successRate when repair is off). */
  firstSuccessRate: number;
  /** Answers a repair ran on. */
  repaired: number;
  /** A2UI: answers that only failed because using them needs the agent to answer an event. */
  waitsOnServer: number;
  checkRate: number;
  /** Medians over answered requests; undefined when the server didn't report them. */
  inputTokens?: number;
  /** Share of input tokens, over all answers, read from the prompt cache; undefined when never reported. */
  cachedShare?: number;
  outputTokens?: number;
  firstTokenMs?: number;
  totalMs?: number;
  chars?: number;
  /** Total dollars over every answer, and per working answer. */
  cost?: number;
  costPerSuccess?: number;
  htmlInserts: number;
  codeFromStrings: number;
  externalScripts: number;
  fixedColors: number;
  /** Security tasks whose markup stayed text, of those answered. */
  safe: number;
  safeOf: number;
}

function cachedShare(rs: AnswerResult[]): number | undefined {
  const reported = rs.filter((r) => r.usage.cachedTokens !== undefined && r.usage.promptTokens);
  if (!reported.length) return undefined;
  return reported.reduce((t, r) => t + r.usage.cachedTokens!, 0) / reported.reduce((t, r) => t + r.usage.promptTokens!, 0);
}

export function summarize(results: AnswerResult[]): Summary[] {
  const keys = [...new Set(results.map((r) => `${r.model}\u0000${r.format}`))];
  return keys.map((k) => {
    const [model, format] = k.split("\u0000") as [string, Format];
    const rs = results.filter((r) => r.model === model && r.format === format);
    const answered = rs.filter((r) => r.ok);
    const checks = answered.flatMap((r) => r.checks);
    const costs = known(answered.map((r) => r.cost));
    const successes = answered.filter((r) => r.success).length;
    const security = answered.filter((r) => r.category === "security");
    const sum = (f: (c: CodeStats) => number) => answered.reduce((t, r) => t + f(r.code), 0);
    return {
      model, format,
      answers: rs.length,
      failedRequests: rs.length - answered.length,
      validRate: answered.length ? answered.filter((r) => r.valid).length / answered.length : 0,
      successRate: answered.length ? successes / answered.length : 0,
      firstSuccessRate: answered.length ? answered.filter((r) => (r.repaired ? r.firstSuccess : r.success)).length / answered.length : 0,
      repaired: answered.filter((r) => r.repaired).length,
      waitsOnServer: answered.filter((r) => r.waitsOnServer).length,
      checkRate: checks.length ? checks.filter((c) => c.passed).length / checks.length : 0,
      inputTokens: median(known(answered.map((r) => r.usage.promptTokens))),
      cachedShare: cachedShare(answered),
      outputTokens: median(known(answered.map((r) => r.usage.completionTokens))),
      firstTokenMs: median(known(answered.map((r) => r.firstTokenMs))),
      totalMs: median(answered.map((r) => r.totalMs)),
      chars: median(answered.map((r) => r.code.chars)),
      cost: costs.length === answered.length && costs.length ? costs.reduce((a, b) => a + b, 0) : undefined,
      costPerSuccess: costs.length === answered.length && successes ? costs.reduce((a, b) => a + b, 0) / successes : undefined,
      htmlInserts: sum((c) => c.htmlInserts),
      codeFromStrings: sum((c) => c.codeFromStrings),
      externalScripts: sum((c) => c.externalScripts),
      fixedColors: sum((c) => c.fixedColors),
      safe: security.filter((r) => r.checks.every((c) => !c.safety || c.passed)).length,
      safeOf: security.length,
    };
  });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number | undefined, unit = "") => (x === undefined ? "?" : `${Math.round(x).toLocaleString("en-US")}${unit}`);
const secs = (ms: number | undefined) => (ms === undefined ? "?" : `${(ms / 1000).toFixed(1)} s`);
const usd = (x: number | undefined) => (x === undefined ? "?" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);

export function report(results: AnswerResult[], meta: { date: string; url: string; runs: number; guideChars: number; htmlPromptChars: number; a2uiPromptChars?: number; cache?: true | "1h" }): string {
  const sums = summarize(results);
  const lines: string[] = [];
  const formatsRun = [...new Set(results.map((r) => r.format))];
  const title = formatsRun.map((f) => (f === "sayshape" ? "SayShape" : f === "a2ui" ? "A2UI" : "HTML")).join(" vs ");
  lines.push(`# ${title}`, "", `${meta.date} · ${meta.url} · ${meta.runs} run${meta.runs === 1 ? "" : "s"} per task · first tries only, no repair`, "");
  lines.push(`System prompts: SayShape guide ${meta.guideChars.toLocaleString("en-US")} characters, HTML instructions ${meta.htmlPromptChars} characters${meta.a2uiPromptChars ? `, A2UI schemas and examples ${meta.a2uiPromptChars.toLocaleString("en-US")} characters` : ""}. Prompt caching: ${meta.cache === "1h" ? "marked, 1 hour" : meta.cache ? "marked, about 5 minutes" : "not marked (servers that cache on their own still may)"}.`, "");
  lines.push("## Summary", "");
  const repair = results.some((r) => r.repaired !== undefined);
  lines.push(`| Model | Format | ${repair ? "Works first try | Works after repair | Repairs |" : "Works (all checks) |"} Checks passed | Renders cleanly | Input tokens | From cache | Output tokens | First token | Total time | Cost | Cost per working UI |`);
  lines.push(`|---|---|${repair ? "---|---|---|" : "---|"}---|---|---|---|---|---|---|---|---|`);
  for (const s of sums) {
    lines.push(`| ${s.model} | ${s.format} | ${repair ? `${pct(s.firstSuccessRate)} | ${pct(s.successRate)} | ${s.repaired} |` : `${pct(s.successRate)} |`} ${pct(s.checkRate)} | ${pct(s.validRate)} | ${num(s.inputTokens)} | ${s.cachedShare === undefined ? "?" : pct(s.cachedShare)} | ${num(s.outputTokens)} | ${secs(s.firstTokenMs)} | ${secs(s.totalMs)} | ${usd(s.cost)} | ${usd(s.costPerSuccess)} |`);
  }
  const waiting = sums.filter((s) => s.waitsOnServer);
  if (waiting.length) lines.push("", ...waiting.map((s) => `${s.model} A2UI: ${s.waitsOnServer} of ${s.answers} answers render fine but wait on the server when used (their buttons send an event for the agent to answer with another model call; A2UI's basic catalog can't change data on its own). They count as not working on their own here.`));
  lines.push("", "Token and time figures are medians per answer; From cache is the share of all input tokens the server read from its prompt cache; cost is the total over all answers.", "");
  lines.push(...projection(results, 100_000), "");
  lines.push("## Code", "");
  lines.push("| Model | Format | Median size | HTML inserted as strings | Code from strings | External scripts | Fixed colors | Security tasks kept safe |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const s of sums) lines.push(`| ${s.model} | ${s.format} | ${num(s.chars)} chars | ${s.htmlInserts} | ${s.codeFromStrings} | ${s.externalScripts} | ${s.fixedColors} | ${s.safe} of ${s.safeOf} |`);
  lines.push("", "## By category", "");
  const cats = [...new Set(results.map((r) => r.category))];
  lines.push(`| Model | Format | ${cats.join(" | ")} |`, `|---|---|${cats.map(() => "---").join("|")}|`);
  for (const s of sums) {
    const cells = cats.map((c) => {
      const rs = results.filter((r) => r.model === s.model && r.format === s.format && r.category === c && r.ok);
      return rs.length ? pct(rs.filter((r) => r.success).length / rs.length) : "–";
    });
    lines.push(`| ${s.model} | ${s.format} | ${cells.join(" | ")} |`);
  }
  lines.push("", "## Every answer", "", "| Task | Model | Format | Run | Works | Failed checks or problems | Output tokens | Time |", "|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const failed = r.ok ? [...r.problems, ...r.checks.filter((c) => !c.passed).map((c) => `${c.label} (${c.why})`)] : [r.error ?? "request failed"];
    lines.push(`| ${r.task} | ${r.model} | ${r.format} | ${r.run} | ${r.success ? "yes" : r.waitsOnServer ? "waits on server" : "no"} | ${failed.join("; ").replace(/\|/g, "\\|").slice(0, 300)} | ${num(r.usage.completionTokens)} | ${secs(r.totalMs)} |`);
  }
  return lines.join("\n") + "\n";
}

/**
 * What `requests` answers would cost and take, from the averages measured here (means, not
 * medians, since a bill adds up every answer). Cost per working UI divides by the share that
 * worked: the honest figure when failures have to be asked again.
 */
export function projection(results: AnswerResult[], requests: number): string[] {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const lines = [`## ${requests.toLocaleString("en-US")} requests, projected`, "",
    `From the average per answer in this run. A rough estimate: ${results.length} answers in all, so treat small differences as ties.`, "",
    "| Model | Format | Avg input tokens | Avg output tokens | Avg cost per answer | Avg time | Cost for " + requests.toLocaleString("en-US") + " | Cost for " + requests.toLocaleString("en-US") + " working UIs |",
    "|---|---|---|---|---|---|---|---|"];
  for (const s of summarize(results)) {
    const rs = results.filter((r) => r.model === s.model && r.format === s.format && r.ok);
    const costs = known(rs.map((r) => r.cost));
    const c = mean(costs);
    const per = (x: number | undefined) => (x === undefined ? "?" : `$${x.toLocaleString("en-US", { maximumFractionDigits: x < 100 ? 2 : 0 })}`);
    lines.push(`| ${s.model} | ${s.format} | ${num(mean(known(rs.map((r) => r.usage.promptTokens))))} | ${num(mean(known(rs.map((r) => r.usage.completionTokens))))} | ${c === undefined ? "?" : `$${c.toFixed(5)}`} | ${secs(mean(rs.map((r) => r.totalMs)))} | ${per(c === undefined ? undefined : c * requests)} | ${per(c === undefined || !s.successRate ? undefined : (c * requests) / s.successRate)} |`);
  }
  return lines;
}

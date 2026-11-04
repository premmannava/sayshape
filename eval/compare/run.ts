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
import { streamChat, type ModelConfig, type Usage } from "../../src/model/stream";
import { languageGuide, type GuideOptions } from "../../src/prompt";
import type { Registry } from "../../src/registry";
import { htmlScreen, sayshapeScreen, type Screen } from "./screens";
import type { Task, TaskCheck } from "./tasks";

export type Format = "sayshape" | "html";

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
}

const clock = () => performance.now();

export async function askSayShape(task: Task, config: ModelConfig, registry: Registry, guide: GuideOptions, fetchImpl?: typeof fetch): Promise<Answer> {
  const r = await generateSpec({ config, registry, request: task.request, guide, repairOn: "never", fetch: fetchImpl });
  return {
    output: r.spec,
    raw: r.first.raw,
    usage: r.first.usage,
    firstTokenMs: r.first.firstTokenMs,
    totalMs: r.timings.totalMs,
    inputChars: r.first.inputChars,
    warnings: r.diagnostics.filter((d) => d.severity === "warning").length,
  };
}

export async function askHtml(task: Task, config: ModelConfig, fetchImpl?: typeof fetch): Promise<Answer> {
  const messages = [{ role: "system" as const, content: HTML_PROMPT }, { role: "user" as const, content: task.request }];
  const usage: Usage = {};
  const start = clock();
  let raw = "", firstTokenMs: number | undefined;
  for await (const part of streamChat(config, messages, { usage, fetch: fetchImpl })) {
    firstTokenMs ??= clock() - start;
    if (part.kind === "content") raw += part.text;
  }
  return { output: cleanHtml(raw), raw, usage, firstTokenMs, totalMs: clock() - start, inputChars: HTML_PROMPT.length + task.request.length };
}

async function open(format: Format, code: string): Promise<Screen> {
  return format === "sayshape" ? sayshapeScreen(code) : htmlScreen(code);
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
      for (const task of tasks) {
        const order = run % 2 === 0 ? [...formats].reverse() : formats;
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
    a = format === "sayshape" ? await askSayShape(task, config, o.registry, guide, o.fetch) : await askHtml(task, config, o.fetch);
  } catch (e) {
    return {
      ...base, ok: false, error: e instanceof Error ? e.message : String(e), output: "", raw: "", usage: {}, totalMs: 0, inputChars: 0,
      valid: false, problems: ["request failed"], checks: task.checks.map((c) => ({ label: c.label, passed: false, why: "request failed" })), success: false, code: codeStats(format, ""),
    };
  }
  const s = await score(format, task, a.output);
  const p = o.prices?.[model];
  const cost = p && a.usage.promptTokens !== undefined && a.usage.completionTokens !== undefined ? a.usage.promptTokens * p.prompt + a.usage.completionTokens * p.completion : undefined;
  return {
    ...base, ok: true, output: a.output, raw: a.raw, usage: a.usage, cost, firstTokenMs: a.firstTokenMs, totalMs: a.totalMs, inputChars: a.inputChars,
    valid: s.valid, problems: s.problems, checks: s.checks, success: s.valid && s.checks.every((c) => c.passed),
    code: codeStats(format, a.output, a.warnings ?? 0),
  };
}

/** The system prompt each format is sent, for the report. */
export function systemPrompt(format: Format, registry: Registry, guide: GuideOptions = { imageHosts: [] }): string {
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
  checkRate: number;
  /** Medians over answered requests; undefined when the server didn't report them. */
  inputTokens?: number;
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
      checkRate: checks.length ? checks.filter((c) => c.passed).length / checks.length : 0,
      inputTokens: median(known(answered.map((r) => r.usage.promptTokens))),
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

export function report(results: AnswerResult[], meta: { date: string; url: string; runs: number; guideChars: number; htmlPromptChars: number }): string {
  const sums = summarize(results);
  const lines: string[] = [];
  lines.push(`# SayShape vs HTML`, "", `${meta.date} · ${meta.url} · ${meta.runs} run${meta.runs === 1 ? "" : "s"} per task · first tries only, no repair`, "");
  lines.push(`System prompts: SayShape guide ${meta.guideChars.toLocaleString("en-US")} characters, HTML instructions ${meta.htmlPromptChars} characters.`, "");
  lines.push("## Summary", "");
  lines.push("| Model | Format | Works (all checks) | Checks passed | Renders cleanly | Input tokens | Output tokens | First token | Total time | Cost | Cost per working UI |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of sums) {
    lines.push(`| ${s.model} | ${s.format} | ${pct(s.successRate)} | ${pct(s.checkRate)} | ${pct(s.validRate)} | ${num(s.inputTokens)} | ${num(s.outputTokens)} | ${secs(s.firstTokenMs)} | ${secs(s.totalMs)} | ${usd(s.cost)} | ${usd(s.costPerSuccess)} |`);
  }
  lines.push("", "Token and time figures are medians per answer; cost is the total over all answers.", "");
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
    lines.push(`| ${r.task} | ${r.model} | ${r.format} | ${r.run} | ${r.success ? "yes" : "no"} | ${failed.join("; ").replace(/\|/g, "\\|").slice(0, 300)} | ${num(r.usage.completionTokens)} | ${secs(r.totalMs)} |`);
  }
  return lines.join("\n") + "\n";
}

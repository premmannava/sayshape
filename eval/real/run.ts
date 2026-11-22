/**
 * The real-world benchmark runner (see PLAN.md): the same request, answered by the same model
 * in SayShape (adaptive guides, as the library ships) and as HTML, under the conditions a
 * deployment has: prompt caching, a warm-up, one retry, the maker's own endpoint.
 *
 * Scoring is eval/compare's `score` (real engine / jsdom), with the app's data passed in by name.
 * Nothing here reads results.json; report.ts does that.
 */
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tokens } from "../../bench/tokens/measure";
import { coreComponents } from "../../src/components";
import { mapComponents } from "../../src/components/map";
import { languageMap, FULL_GUIDE_TOPIC } from "../../src/capabilities";
import { generateAdaptive } from "../../src/model/adaptive";
import { nextRefineContext, type RefineContext } from "../../src/model/context";
import { generateSpec } from "../../src/model/generate";
import { streamChat, type ChatMessage, type ModelConfig, type Usage } from "../../src/model/stream";
import { languageGuide } from "../../src/prompt";
import { Registry } from "../../src/registry";
import { cleanHtml, codeStats, costOf, HTML_PROMPT, runCheck, score, type CheckResult, type CodeStats, type Prices } from "../compare/run";
import type { ScreenEnv } from "../compare/screens";
import type { Task, TaskCheck } from "../compare/tasks";
import { looser } from "./data";
import type { RealTask } from "./tasks";

export type RealFormat = "adaptive" | "html" | "sayshape";
export type Level = RealTask["level"];

// ---- Models ----

export interface ModelSpec {
  /** Short name used by --models. */
  key: string;
  label: string;
  /** How to find the id in OpenRouter's /models list: an exact id, or a pattern (shortest match wins). */
  id: string | RegExp;
  /** Which provider is the maker's own endpoint, matched on its name. */
  maker: RegExp;
  /** How many times the set runs, to show how much results move between runs. */
  runs: number;
  /** Mark the system prompt for caching (cache_control). OpenAI and DeepSeek cache on their own. */
  markCache: boolean;
  /** Served by someone other than the maker: its cache figures are not comparable. */
  thirdParty?: boolean;
}

const NOT_VARIANT = /lite|image|tts|audio|live|embed|search|thinking-exp/i;

export const MODEL_SPECS: ModelSpec[] = [
  { key: "luna", label: "GPT-6 Luna", id: /^openai\/gpt-6(?![.\d]).*luna/i, maker: /^openai$/i, runs: 3, markCache: false },
  { key: "sol", label: "GPT-6.1 Sol", id: /^openai\/gpt-6\.1.*sol/i, maker: /^openai$/i, runs: 1, markCache: false },
  { key: "gemini", label: "Gemini 3.8 Flash", id: /^google\/gemini-3\.8.*flash/i, maker: /^google( ai studio|-ai-studio)?$/i, runs: 1, markCache: true },
  { key: "deepseek", label: "DeepSeek V4.1 Flash", id: "deepseek/deepseek-v4.1-flash-1017", maker: /^particle ai$/i, runs: 1, markCache: false, thirdParty: true },
  { key: "haiku", label: "Claude Haiku 5.5", id: "anthropic/claude-haiku-5.5", maker: /^anthropic$/i, runs: 3, markCache: true },
  { key: "sonnet", label: "Claude Sonnet 5.5", id: "anthropic/claude-sonnet-5.5", maker: /^anthropic$/i, runs: 1, markCache: true },
];

export interface ResolvedModel {
  key: string;
  label: string;
  /** The OpenRouter id. */
  id: string;
  /** The maker's own endpoint: its OpenRouter provider slug, or undefined when it couldn't be found (dry runs only). */
  provider?: string;
  providerName?: string;
  thirdParty?: boolean;
  prices: Prices;
  runs: number;
  markCache: boolean;
}

interface ListedModel { id: string; name?: string; pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string } }
interface ListedEndpoint { provider_name?: string; tag?: string; name?: string; pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string } }

const num = (s: string | undefined): number | undefined => (s === undefined || s === "" || Number.isNaN(Number(s)) ? undefined : Number(s));

function pricesOf(p: ListedModel["pricing"] | undefined): Prices | undefined {
  const prompt = num(p?.prompt), completion = num(p?.completion);
  if (prompt === undefined || completion === undefined) return undefined;
  const read = num(p?.input_cache_read), write = num(p?.input_cache_write);
  return { prompt, completion, ...(read !== undefined ? { cacheRead: read } : {}), ...(write !== undefined ? { cacheWrite: write } : {}) };
}

/** Looks the models up on OpenRouter. Throws a clear message for an id that isn't listed, unless `lenient` (dry runs). */
export async function resolveModels(url: string, apiKey: string | undefined, wanted: string[], lenient: boolean): Promise<ResolvedModel[]> {
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const res = await fetch(`${url}/models`, { headers }).catch(() => null);
  if (!res?.ok) throw new Error(`Couldn't read the model list from ${url}/models${res ? ` (${res.status})` : ""}.`);
  const listed = ((await res.json()) as { data?: ListedModel[] }).data ?? [];
  const out: ResolvedModel[] = [];
  for (const w of wanted) {
    const spec = MODEL_SPECS.find((m) => m.key === w) ?? (w.includes("/") ? { key: w.replace(/[^\w.-]+/g, "_"), label: w, id: w, maker: new RegExp(`^${w.split("/")[0]!.replace(/\W/g, "")}`, "i"), runs: 1, markCache: /^(anthropic|google)\//.test(w) } : undefined);
    if (!spec) throw new Error(`Unknown model "${w}". Use one of ${MODEL_SPECS.map((m) => m.key).join(", ")}, or an OpenRouter id such as anthropic/claude-haiku-5.5.`);
    const hits = typeof spec.id === "string" ? listed.filter((m) => m.id === spec.id) : listed.filter((m) => (spec.id as RegExp).test(m.id) && !NOT_VARIANT.test(m.id)).sort((a, b) => a.id.length - b.id.length);
    const hit = hits[0];
    if (!hit) {
      const msg = `${spec.label}: no model ${typeof spec.id === "string" ? `"${spec.id}"` : `matching ${spec.id}`} in OpenRouter's list. Pass the exact id with --models.`;
      if (lenient) { out.push({ key: spec.key, label: spec.label, id: `(not listed: ${msg})`, prices: { prompt: 0, completion: 0 }, runs: spec.runs, markCache: spec.markCache }); continue; }
      throw new Error(msg);
    }
    // The maker's own endpoint, from the model's endpoint list.
    let provider: string | undefined, providerName: string | undefined, endpointPrices: Prices | undefined;
    const er = await fetch(`${url}/models/${hit.id}/endpoints`, { headers }).catch(() => null);
    if (er?.ok) {
      const body = (await er.json()) as { data?: { endpoints?: ListedEndpoint[] } };
      const eps = body.data?.endpoints ?? [];
      const own = eps.find((e) => spec.maker.test(e.provider_name ?? "") || spec.maker.test(e.tag ?? ""));
      if (own) {
        providerName = own.provider_name ?? own.name;
        provider = own.tag ?? (own.provider_name ?? "").toLowerCase().replace(/\s+/g, "-");
        endpointPrices = pricesOf(own.pricing);
      }
    }
    if (!provider && !lenient) throw new Error(`${spec.label} (${hit.id}): couldn't find the maker's own OpenRouter endpoint, so it can't be pinned. Check ${url}/models/${hit.id}/endpoints.`);
    const prices = endpointPrices ?? pricesOf(hit.pricing);
    if (!prices && !lenient) throw new Error(`${spec.label} (${hit.id}): OpenRouter lists no prices, so the budget can't be kept.`);
    out.push({ key: spec.key, label: spec.label, id: hit.id, provider, providerName, prices: prices ?? { prompt: 0, completion: 0 }, runs: spec.runs, markCache: spec.markCache, ...(spec.thirdParty ? { thirdParty: true } : {}) });
  }
  return out;
}

// ---- One request: provider pinning and the retry ----

const RETRY_WAIT_MS = 4000;

/** Fetch that pins the maker's endpoint with fallbacks off, and retries once on 429/5xx. */
function pinnedFetch(model: ResolvedModel, counter: { retries: number }): typeof fetch {
  return async (input, init) => {
    let body = init?.body;
    if (typeof body === "string" && model.provider) {
      try { body = JSON.stringify({ ...JSON.parse(body), provider: { order: [model.provider], allow_fallbacks: false } }); } catch { /* sent as it was */ }
    }
    const go = () => fetch(input, { ...init, body });
    let res: Response | undefined;
    try { res = await go(); } catch (e) {
      if (init?.signal?.aborted) throw e;
      counter.retries++;
      await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
      return go();
    }
    if (res.status === 429 || res.status >= 500) {
      counter.retries++;
      await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
      return go();
    }
    return res;
  };
}

// ---- Prompts ----

export const DATA_LINE = (names: string[]) =>
  `The app supplies its data as lists of objects on window.DATA before your scripts run: ${names.map((n) => `window.DATA.${n}`).join(", ")}. Read them from there. Never copy the rows into your code.`;

export const htmlPromptFor = (data?: Record<string, unknown>): string => (data ? `${HTML_PROMPT}\n${DATA_LINE(Object.keys(data))}` : HTML_PROMPT);

// ---- Answers ----

export interface RealAnswer {
  model: string;
  task: string;
  level: Level;
  audience: RealTask["audience"];
  wording: RealTask["wording"];
  category: Task["category"];
  format: RealFormat;
  run: number;
  /** 1 for the request, 2 for its follow-up. */
  turn: 1 | 2;
  /** False when the request failed even after the retry: "no answer". */
  ok: boolean;
  error?: string;
  retries: number;
  finishReason?: string;
  /** Cut off at the token limit. */
  cutOff: boolean;
  // Tokens as the provider reported them.
  inputTokens?: number;
  freshInputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  modelCalls: number;
  /** The answer counted with one tokenizer (bench/tokens/measure.ts), and in characters. */
  answerTokens: number;
  answerChars: number;
  firstTokenMs?: number;
  totalMs: number;
  tokensPerSecond?: number;
  /** Dollars as billed (with the cache), and as if nothing were cached. */
  cost?: number;
  costNoCache?: number;
  valid: boolean;
  problems: string[];
  /** `passedRounded`: also passes when each figure is shown rounded or compact (K, M, B) and correct at the precision shown. */
  checks: Array<CheckResult & { passedRounded: boolean }>;
  success: boolean;
  /** Valid and every check passed, rounded figures accepted. */
  successRounded: boolean;
  /** Adaptive only. */
  route?: { kind: "known" | "map" | "chosen" | "full"; capabilities: string[]; elements: string[] };
  /** HTML only: hard-coded colors, HTML from strings, external scripts. */
  code: CodeStats;
  /** Extreme only: the answer copied the rows it was told the app supplies. */
  copiedRows?: boolean;
  /** Path of the answer file under answers/. */
  file?: string;
  /** The answer was empty once cleaned (the model wrote no screen); its raw reply is saved beside it as <file>.raw.txt. Still counts as not working. */
  noScreen?: boolean;
}

interface Raw {
  output: string;
  usage: Usage;
  calls: number;
  firstTokenMs?: number;
  totalMs: number;
  route?: RealAnswer["route"];
  warnings: number;
  /** HTML: the model's whole reply, for the next turn. */
  reply?: string;
}

const clock = () => performance.now();

/** Cost of one answer's usage, undefined when a figure is unknown. */
function costs(u: Usage, p: Prices): { cost?: number; costNoCache?: number } {
  if (u.promptTokens === undefined || u.completionTokens === undefined) return {};
  return { cost: costOf(u, p), costNoCache: u.promptTokens * p.prompt + u.completionTokens * p.completion };
}

/** Whether an answer repeats rows the app supplies: 10 or more rows (not in the request) with their first column value. */
export function copiedRows(task: RealTask, output: string): boolean {
  if (!task.data) return false;
  let hits = 0;
  for (const rows of Object.values(task.data)) {
    for (const row of rows) {
      const first = Object.values(row).find((v) => v !== null && String(v).length >= 4);
      if (first === undefined || first === null) continue;
      const s = String(first);
      if (task.request.includes(s)) continue;
      if (output.includes(s)) hits++;
    }
  }
  return hits >= 10;
}

// ---- Conversation state per format, for the follow-up ----

interface Convo {
  /** SayShape: what refine needs. */
  refine?: RefineContext;
  /** SayShape adaptive: the sized guide the first turn used, asked for again by name. */
  topics?: string[];
  /** HTML: the messages so far. */
  messages?: ChatMessage[];
}

export interface RunnerContext {
  registry: Registry;
  url: string;
  apiKey?: string;
  maxTokens: number;
  budget: Budget;
}

export class Budget {
  spent = 0;
  unknown = 0;
  constructor(readonly limit: number) {}
  get over(): boolean { return this.spent >= this.limit; }
  add(cost: number | undefined): void { if (cost === undefined) this.unknown++; else this.spent += cost; }
}

function configFor(c: RunnerContext, m: ResolvedModel): ModelConfig {
  return { url: c.url, model: m.id, apiKey: c.apiKey, streamUsage: true, maxTokens: c.maxTokens, ...(m.markCache ? { cache: true as const } : {}) };
}

/** One model call (or two, for adaptive). Throws when the request fails after its retry. */
async function ask(c: RunnerContext, m: ResolvedModel, format: RealFormat, request: string, data: Record<string, unknown> | undefined, convo: Convo, counter: { retries: number }): Promise<{ raw: Raw; convo: Convo; finishReason?: string }> {
  const config = configFor(c, m);
  const fetchImpl = pinnedFetch(m, counter);
  const stateNames = data ? Object.keys(data) : undefined;
  if (format === "html") {
    const system = htmlPromptFor(data);
    const messages: ChatMessage[] = [{ role: "system", content: system }, ...(convo.messages ?? []), { role: "user", content: request }];
    const start = clock();
    let firstTokenMs: number | undefined;
    const usage: Usage = {};
    let reply = "";
    for await (const part of streamChat(config, messages, { usage, fetch: fetchImpl })) {
      firstTokenMs ??= clock() - start;
      if (part.kind === "content") reply += part.text;
    }
    const output = cleanHtml(reply);
    return {
      raw: { output, usage, calls: 1, firstTokenMs, totalMs: clock() - start, warnings: 0, reply },
      convo: { messages: [...(convo.messages ?? []), { role: "user", content: request }, { role: "assistant", content: reply }] },
      finishReason: usage.finishReason,
    };
  }
  const guideOpts = { imageHosts: [] as string[] };
  const refine = convo.refine;
  const base = { config, registry: c.registry, request, repairOn: "never" as const, fetch: fetchImpl, ...(stateNames ? { stateNames } : {}), ...(refine ? { refine } : {}) };
  let reply: string | undefined;
  let spec: string, usage: Usage, calls: number, firstTokenMs: number | undefined, totalMs: number, route: RealAnswer["route"] | undefined, finishReason: string | undefined, warnings: number, topics: string[] | undefined;
  if (format === "adaptive") {
    const r = await generateAdaptive({ ...base, guide: guideOpts, presets: true, ...(convo.topics ? { capabilities: convo.topics } : {}) });
    spec = r.spec; usage = r.usage; calls = r.route.calls; totalMs = r.timings.totalMs; reply = r.first.raw;
    firstTokenMs = r.discovery ? r.discovery.timings.totalMs + (r.first.firstTokenMs ?? 0) : r.first.firstTokenMs;
    route = { kind: r.route.kind, capabilities: r.route.capabilities, elements: r.route.elements };
    finishReason = (r.repair ?? r.first).usage.finishReason;
    warnings = r.diagnostics.filter((d) => d.severity === "warning").length;
    // The follow-up asks for the same sized guide the model chose; with the map alone, the map again.
    topics = convo.topics ?? (r.route.kind === "full" ? [FULL_GUIDE_TOPIC] : r.route.kind === "chosen" ? [...r.route.capabilities, ...r.route.elements] : undefined);
  } else {
    const r = await generateSpec({ ...base, guide: { ...guideOpts, mode: "full" } });
    spec = r.spec; usage = r.usage; calls = 1; totalMs = r.timings.totalMs; firstTokenMs = r.first.firstTokenMs; reply = r.first.raw;
    finishReason = (r.repair ?? r.first).usage.finishReason;
    warnings = r.diagnostics.filter((d) => d.severity === "warning").length;
  }
  const next: RefineContext = refine ? nextRefineContext(refine, request, spec) : { task: request, spec };
  return { raw: { output: spec, usage, calls, firstTokenMs, totalMs, route, warnings, ...(reply !== undefined ? { reply } : {}) }, convo: { refine: next, ...(topics ? { topics } : {}) }, finishReason };
}

/** Score one answer on a fresh screen per check: exact, then (for a failed check) with every figure pattern loosened to its rounded twin. Number controls (steppers, sliders, range inputs) count as fields. */
export async function scoreOutput(task: RealTask, turn: 1 | 2, format: RealFormat, output: string): Promise<{ valid: boolean; problems: string[]; checks: RealAnswer["checks"]; success: boolean; successRounded: boolean }> {
  const checks: TaskCheck[] = turn === 1 ? task.checks : task.followUp!.checks;
  const request = turn === 1 ? task.request : task.followUp!.request;
  const scoreFormat = format === "html" ? "html" : "sayshape";
  const env: ScreenEnv = { numberControls: true, ...(task.data ? { data: task.data } : {}), ...(format !== "html" ? { presets: true } : {}) };
  const s = await score(scoreFormat, { id: task.id, category: task.category, request, checks }, output, env);
  const rounded: RealAnswer["checks"] = [];
  for (const [i, r] of s.checks.entries()) {
    const c = checks[i];
    const retry = !r.passed && c?.shows?.length ? await runCheck(scoreFormat, output, { ...c, shows: c.shows.map(looser) }, env) : r;
    rounded.push({ ...r, passedRounded: r.passed || retry.passed });
  }
  return { valid: s.valid, problems: s.problems, checks: rounded, success: s.valid && s.checks.every((x) => x.passed), successRounded: s.valid && rounded.every((x) => x.passedRounded) };
}

/** Ask, score, and shape one answer record. Never throws. */
async function answerOne(c: RunnerContext, m: ResolvedModel, task: RealTask, format: RealFormat, run: number, turn: 1 | 2, convo: Convo, outDir: string | undefined): Promise<{ answer: RealAnswer; convo: Convo }> {
  const request = turn === 1 ? task.request : task.followUp!.request;
  const checks: TaskCheck[] = turn === 1 ? task.checks : task.followUp!.checks;
  const base = { model: m.key, task: task.id, level: task.level, audience: task.audience, wording: task.wording, category: task.category, format, run, turn };
  const counter = { retries: 0 };
  let got: Awaited<ReturnType<typeof ask>>;
  try {
    got = await ask(c, m, format, request, task.data, convo, counter);
  } catch (e) {
    const answer: RealAnswer = { ...base, ok: false, error: e instanceof Error ? e.message : String(e), retries: counter.retries, cutOff: false, modelCalls: 0, answerTokens: 0, answerChars: 0, totalMs: 0, valid: false, problems: ["request failed"], checks: [], success: false, successRounded: false, code: codeStats(format === "html" ? "html" : "sayshape", "") };
    return { answer, convo };
  }
  const { raw } = got;
  const scoreFormat = format === "html" ? "html" : "sayshape";
  const sc = await scoreOutput(task, turn, format, raw.output);
  const u = raw.usage;
  const { cost, costNoCache } = costs(u, m.prices);
  c.budget.add(cost);
  const read = u.cachedTokens ?? 0, written = u.cacheWriteTokens ?? 0;
  const file = outDir ? `${m.key}.${task.id}.r${run}.t${turn}.${format}.${format === "html" ? "html" : "sayshape"}` : undefined;
  const noScreen = !raw.output.trim();
  if (outDir && file) {
    writeFileSync(resolve(outDir, "answers", file), raw.output);
    if (noScreen) writeFileSync(resolve(outDir, "answers", `${file}.raw.txt`), raw.reply ?? "");
  }
  const gen = raw.totalMs - (raw.firstTokenMs ?? 0);
  const answer: RealAnswer = {
    ...base, ok: true, retries: counter.retries, finishReason: got.finishReason, cutOff: got.finishReason === "length",
    inputTokens: u.promptTokens, freshInputTokens: u.promptTokens === undefined ? undefined : Math.max(0, u.promptTokens - read - written),
    cachedTokens: u.cachedTokens, cacheWriteTokens: u.cacheWriteTokens, outputTokens: u.completionTokens, thinkingTokens: u.reasoningTokens,
    modelCalls: raw.calls, answerTokens: tokens(raw.output), answerChars: raw.output.length,
    firstTokenMs: raw.firstTokenMs, totalMs: raw.totalMs,
    tokensPerSecond: u.completionTokens !== undefined && gen > 0 ? u.completionTokens / (gen / 1000) : undefined,
    cost, costNoCache, valid: sc.valid, problems: sc.problems, checks: sc.checks, success: sc.success, successRounded: sc.successRounded, ...(noScreen ? { noScreen: true } : {}),
    ...(raw.route ? { route: raw.route } : {}),
    code: codeStats(scoreFormat, raw.output, raw.warnings),
    ...(task.data ? { copiedRows: copiedRows(task, raw.output) } : {}),
    ...(file ? { file } : {}),
  };
  return { answer, convo: got.convo };
}

// ---- The run ----

export interface ColdRequest {
  model: string;
  format: RealFormat;
  ok: boolean;
  error?: string;
  inputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  firstTokenMs?: number;
  totalMs: number;
  cost?: number;
  costNoCache?: number;
}

export interface PromptSizes { adaptiveMap: { chars: number; tokens: number }; full: { chars: number; tokens: number }; html: { chars: number; tokens: number } }

export interface RunRecord {
  meta: {
    version: string;
    commit: string;
    date: string;
    flags: Record<string, unknown>;
    models: Array<{ key: string; label: string; id: string; provider?: string; providerName?: string; thirdParty?: boolean; prices: Prices; runs: number; cache: boolean }>;
    promptSizes: PromptSizes;
    budget: number;
    spent: number;
    spentUnknown: number;
    stoppedByBudget: boolean;
    taskCount: number;
  };
  cold: ColdRequest[];
  answers: RealAnswer[];
}

export function promptSizes(registry: Registry): PromptSizes {
  const map = languageMap(registry, { imageHosts: [], presets: true });
  const full = languageGuide(registry, { imageHosts: [], mode: "full" });
  const html = HTML_PROMPT;
  const size = (t: string) => ({ chars: t.length, tokens: tokens(t) });
  return { adaptiveMap: size(map), full: size(full), html: size(html) };
}

export function makeRegistry(): Registry {
  return new Registry([...coreComponents, ...mapComponents]);
}

const WARM_UP_REQUEST = "Show a short greeting in a card.";

export interface RunOptions {
  models: ResolvedModel[];
  formats: RealFormat[];
  tasks: RealTask[];
  /** Overrides each model's own number of runs (smoke: 1). */
  runsOverride?: number;
  budget: number;
  url: string;
  apiKey?: string;
  outDir: string;
  flags: Record<string, unknown>;
  onAnswer?: (a: RealAnswer, spent: number) => void;
}

/** Calls the plan makes, counting an adaptive answer as one (it takes a second call when the model asks for a guide). */
export function plannedCalls(o: Pick<RunOptions, "models" | "formats" | "tasks" | "runsOverride">): { perModel: Array<{ model: ResolvedModel; runs: number; calls: number }>; total: number } {
  const turns = o.tasks.length + o.tasks.filter((t) => t.followUp).length;
  const perModel = o.models.map((model) => {
    const runs = o.runsOverride ?? model.runs;
    const calls = runs * turns * o.formats.length + o.formats.length;
    return { model, runs, calls };
  });
  return { perModel, total: perModel.reduce((n, p) => n + p.calls, 0) };
}

function gitCommit(): string {
  try { return execSync("git rev-parse --short HEAD", { cwd: resolve(__dirname, "../.."), stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "unknown"; }
}

/** Six models in parallel; within a model, one request after another so its cache stays warm. */
export async function runReal(o: RunOptions): Promise<RunRecord> {
  const registry = makeRegistry();
  const budget = new Budget(o.budget);
  const ctx: RunnerContext = { registry, url: o.url, apiKey: o.apiKey, maxTokens: 16000, budget };
  mkdirSync(resolve(o.outDir, "answers"), { recursive: true });
  const answers: RealAnswer[] = [];
  const cold: ColdRequest[] = [];
  const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as { version: string };

  const metaNow = (): RunRecord["meta"] => ({
    version: pkg.version, commit: gitCommit(), date: startedAt, flags: o.flags,
    models: o.models.map((m) => ({ key: m.key, label: m.label, id: m.id, provider: m.provider, providerName: m.providerName, ...(m.thirdParty ? { thirdParty: true } : {}), prices: m.prices, runs: o.runsOverride ?? m.runs, cache: m.markCache })),
    promptSizes: promptSizes(registry), budget: o.budget, spent: budget.spent, spentUnknown: budget.unknown, stoppedByBudget: budget.over, taskCount: o.tasks.length,
  });
  // Every answer is saved as it completes, so a crash loses nothing already paid for (see loadSaved).
  const saveProgress = () => writeFileSync(resolve(o.outDir, "partial.json"), JSON.stringify({ meta: metaNow(), cold }));
  const record = (a: RealAnswer) => {
    answers.push(a);
    appendFileSync(resolve(o.outDir, "answers.jsonl"), `${JSON.stringify(a)}\n`);
    saveProgress();
    o.onAnswer?.(a, budget.spent);
  };
  const startedAt = new Date().toISOString();
  saveProgress();

  const worker = async (m: ResolvedModel) => {
    // Warm-up: one call per format, recorded apart and left out of the medians.
    for (const format of o.formats) {
      if (budget.over) break;
      const counter = { retries: 0 };
      try {
        const g = await ask(ctx, m, format, WARM_UP_REQUEST, undefined, {}, counter);
        const { cost, costNoCache } = costs(g.raw.usage, m.prices);
        budget.add(cost);
        cold.push({ model: m.key, format, ok: true, inputTokens: g.raw.usage.promptTokens, cachedTokens: g.raw.usage.cachedTokens, cacheWriteTokens: g.raw.usage.cacheWriteTokens, outputTokens: g.raw.usage.completionTokens, firstTokenMs: g.raw.firstTokenMs, totalMs: g.raw.totalMs, cost, costNoCache });
      } catch (e) {
        cold.push({ model: m.key, format, ok: false, error: e instanceof Error ? e.message : String(e), totalMs: 0 });
      }
    }
    const runs = o.runsOverride ?? m.runs;
    for (let run = 1; run <= runs; run++) {
      for (const [i, task] of o.tasks.entries()) {
        // Rotate which format goes first, so none is always first.
        const shift = (i + run - 1) % o.formats.length;
        const order = [...o.formats.slice(shift), ...o.formats.slice(0, shift)];
        for (const format of order) {
          if (budget.over) return;
          let convo: Convo = {};
          const first = await answerOne(ctx, m, task, format, run, 1, convo, o.outDir);
          record(first.answer);
          if (task.followUp && first.answer.ok && !budget.over) {
            const second = await answerOne(ctx, m, task, format, run, 2, first.convo, o.outDir);
            record(second.answer);
          }
        }
      }
    }
  };
  await Promise.all(o.models.map(worker));

  return {
    meta: { ...metaNow(), date: new Date().toISOString() },
    cold, answers,
  };
}

/** A finished run's results.json; or, for a run that didn't finish, what it saved as it went (partial.json and answers.jsonl). */
export function loadSaved(dir: string): RunRecord {
  const done = resolve(dir, "results.json");
  if (existsSync(done)) return JSON.parse(readFileSync(done, "utf8")) as RunRecord;
  const part = JSON.parse(readFileSync(resolve(dir, "partial.json"), "utf8")) as Pick<RunRecord, "meta" | "cold">;
  const lines = readFileSync(resolve(dir, "answers.jsonl"), "utf8").split("\n").filter(Boolean);
  return { meta: part.meta, cold: part.cold, answers: lines.map((l) => JSON.parse(l) as RealAnswer) };
}

/** Score the saved answer files of a finished (or stopped) run again, with no model calls. Returns the record to write beside the original. */
export async function rescore(dir: string, tasks: RealTask[]): Promise<RunRecord> {
  const rec = loadSaved(dir);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const answers: RealAnswer[] = [];
  for (const a of rec.answers) {
    const task = byId.get(a.task);
    if (!a.ok || !a.file || !task || (a.turn === 2 && !task.followUp)) { answers.push(a); continue; }
    const output = readFileSync(resolve(dir, "answers", a.file), "utf8");
    const sc = await scoreOutput(task, a.turn, a.format, output);
    answers.push({ ...a, valid: sc.valid, problems: sc.problems, checks: sc.checks, success: sc.success, successRounded: sc.successRounded });
  }
  return { ...rec, meta: { ...rec.meta, flags: { ...rec.meta.flags, rescoredFrom: dir } }, answers };
}

/** Rough cost of the plan, with no caching: input and output sizes are guesses, so it's an upper-ish bound for the budget. */
export function estimateCost(o: Pick<RunOptions, "models" | "formats" | "tasks" | "runsOverride">, sizes: PromptSizes): Array<{ model: string; dollars: number }> {
  const avgRequest = o.tasks.reduce((n, t) => n + tokens(t.request), 0) / Math.max(1, o.tasks.length);
  return o.models.map((m) => {
    const runs = o.runsOverride ?? m.runs;
    const turns = o.tasks.length + o.tasks.filter((t) => t.followUp).length;
    let dollars = 0;
    for (const f of o.formats) {
      // Adaptive: the map, then often a sized guide of about half the full one. HTML: its short prompt. Output includes thinking, guessed at 3x the answer.
      const input = f === "html" ? sizes.html.tokens + avgRequest : f === "adaptive" ? sizes.adaptiveMap.tokens * 1.6 + sizes.full.tokens * 0.4 + avgRequest * 1.6 : sizes.full.tokens + avgRequest;
      const output = f === "html" ? 9000 : 6000;
      dollars += runs * turns * (input * m.prices.prompt + output * m.prices.completion);
    }
    return { model: m.label, dollars };
  });
}

/**
 * Builds report.md from a run record (eval/real/run.ts). All figures are computed here, never by a
 * model. Every percentage says how many answers is behind it.
 *
 * "Adaptive" is SayShape the way the library ships it; "html" is the same request as an HTML page.
 * Answers that got no reply even after the retry ("no answer") are counted on their own line and
 * left out of every comparison.
 */
import type { RealAnswer, RealFormat, RunRecord } from "./run";

const FORMATS: RealFormat[] = ["adaptive", "sayshape", "html"];
const LEVELS = ["low", "medium", "hard", "extreme"] as const;

// ---- Small helpers ----

const known = (xs: Array<number | undefined>): number[] => xs.filter((x): x is number => x !== undefined);
function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const n0 = (x: number | undefined) => (x === undefined ? "?" : Math.round(x).toLocaleString("en-US"));
const secs = (ms: number | undefined) => (ms === undefined ? "?" : `${(ms / 1000).toFixed(1)} s`);
const usd = (x: number | undefined) => (x === undefined ? "?" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);
const ratio = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined || b === 0 ? "?" : `${(a / b).toFixed(2)}x`);
/** "63% (19/30)": the count is always shown. */
const share = (k: number, n: number) => (n === 0 ? "n/a (0)" : `${Math.round((k / n) * 100)}% (${k}/${n})`);

function table(head: string[], rows: string[][]): string {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

/** Figures for a set of answers, all of one format. Only answered requests count. */
interface Stat {
  n: number;
  works: number;
  answerTokens?: number;
  outputTokens?: number;
  totalMs?: number;
  firstTokenMs?: number;
  tps?: number;
  cost?: number;
  costPerWorking?: number;
  /** How many answers have a known cost. */
  costed: number;
}

function stat(rs: RealAnswer[]): Stat {
  const a = rs.filter((r) => r.ok);
  const costs = known(a.map((r) => r.cost));
  const works = a.filter((r) => r.success).length;
  const costedWorks = a.filter((r) => r.cost !== undefined && r.success).length;
  const total = costs.length ? sum(costs) : undefined;
  return {
    n: a.length, works, costed: costs.length,
    answerTokens: median(a.map((r) => r.answerTokens)),
    outputTokens: median(known(a.map((r) => r.outputTokens))),
    totalMs: median(a.map((r) => r.totalMs)),
    firstTokenMs: median(known(a.map((r) => r.firstTokenMs))),
    tps: median(known(a.map((r) => r.tokensPerSecond))),
    cost: total,
    // Cost over answers with a known cost, divided by those of them that work.
    costPerWorking: total !== undefined && costedWorks ? total / costedWorks : undefined,
  };
}

const by = <T>(xs: T[], key: (x: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
};

/**
 * The run each model's tables use: for a model that ran the set more than once, the run whose number
 * of working answers is the median of its runs (the lower middle for an even count).
 */
export function medianRuns(answers: RealAnswer[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [model, rs] of by(answers, (a) => a.model)) {
    const runs = [...new Set(rs.map((r) => r.run))].sort((a, b) => a - b);
    const scored = runs.map((run) => ({ run, works: rs.filter((r) => r.run === run && r.success).length }));
    scored.sort((a, b) => a.works - b.works || a.run - b.run);
    out.set(model, scored[Math.floor((scored.length - 1) / 2)]!.run);
  }
  return out;
}

// ---- The report ----

export function buildReport(rec: RunRecord): string {
  const label = new Map(rec.meta.models.map((m) => [m.key, m.label]));
  const name = (k: string) => label.get(k) ?? k;
  const formats = FORMATS.filter((f) => rec.answers.some((a) => a.format === f));
  const all = rec.answers;
  const mr = medianRuns(all);
  const used = all.filter((a) => a.run === mr.get(a.model)); // tables use the median run
  const noAnswer = all.filter((a) => !a.ok);
  const out: string[] = [];
  const h = (t: string) => out.push(`\n## ${t}\n`);

  out.push(`# SayShape vs HTML, real-world benchmark\n`);
  out.push(`${rec.meta.date} · SayShape ${rec.meta.version} · commit ${rec.meta.commit} · ${rec.meta.taskCount} requests (first turns), formats: ${formats.join(", ")}.`);
  out.push(`Spent ${usd(rec.meta.spent)} of a ${usd(rec.meta.budget)} budget${rec.meta.stoppedByBudget ? " (**stopped by the budget: the set is incomplete**)" : ""}${rec.meta.spentUnknown ? `; ${rec.meta.spentUnknown} answers had no cost figure and aren't in the total` : ""}.`);
  out.push(`Answer sizes are counted with one tokenizer (o200k_base) so models can be compared; "output tokens" are what each provider reported and differ in how they count. Models that ran more than once use their median run in every table (the run with the median number of working answers); the spread section shows all runs.`);

  h("Setup");
  out.push(table(["Model", "OpenRouter id", "Endpoint", "$/M in", "$/M out", "$/M cache read", "Runs", "Cache marked"], rec.meta.models.map((m) => [m.label, m.id, m.providerName ?? m.provider ?? "unpinned", (m.prices.prompt * 1e6).toFixed(2), (m.prices.completion * 1e6).toFixed(2), m.prices.cacheRead !== undefined ? (m.prices.cacheRead * 1e6).toFixed(2) : "?", String(m.runs), m.cache ? "yes" : "no (automatic)"])));
  const ps = rec.meta.promptSizes;
  out.push(`\nSystem prompts: adaptive map ${n0(ps.adaptiveMap.tokens)} tokens (${n0(ps.adaptiveMap.chars)} chars), whole guide ${n0(ps.full.tokens)} tokens (${n0(ps.full.chars)} chars), HTML ${n0(ps.html.tokens)} tokens (${n0(ps.html.chars)} chars).`);

  h("Headline: SayShape vs HTML, per model");
  out.push(`Ratios are HTML divided by SayShape (adaptive): above 1 means HTML is larger, slower or dearer. Cost per working screen is the model's cost over the answers that work.\n`);
  const head = ["Model", "Format", "Answers", "Works", "Answer size (yardstick tokens, median)", "Output tokens (reported, median)", "Total time (median)", "Cost per working screen"];
  const rows: string[][] = [];
  for (const m of rec.meta.models) {
    const mine = used.filter((a) => a.model === m.key);
    for (const f of formats) {
      const s = stat(mine.filter((a) => a.format === f));
      rows.push([name(m.key), f, String(s.n), share(s.works, s.n), n0(s.answerTokens), n0(s.outputTokens), secs(s.totalMs), usd(s.costPerWorking)]);
    }
    if (formats.includes("adaptive") && formats.includes("html")) {
      const a = stat(mine.filter((x) => x.format === "adaptive")), t = stat(mine.filter((x) => x.format === "html"));
      rows.push([`**${name(m.key)}**`, "**html / adaptive**", "", "", ratio(t.answerTokens, a.answerTokens), ratio(t.outputTokens, a.outputTokens), ratio(t.totalMs, a.totalMs), ratio(t.costPerWorking, a.costPerWorking)]);
    }
  }
  out.push(table(head, rows));

  if (formats.includes("adaptive") && formats.includes("html")) {
    out.push(`\nAll models together (${used.filter((a) => a.ok && a.format === "adaptive").length} adaptive and ${used.filter((a) => a.ok && a.format === "html").length} HTML answers; per-model medians, then the median of those):`);
    const per = (f: RealFormat, pick: (s: Stat) => number | undefined) => median(known(rec.meta.models.map((m) => pick(stat(used.filter((a) => a.model === m.key && a.format === f))))));
    out.push(table(["Figure", "adaptive", "html", "html / adaptive"], [
      ["Output tokens (reported)", n0(per("adaptive", (s) => s.outputTokens)), n0(per("html", (s) => s.outputTokens)), ratio(per("html", (s) => s.outputTokens), per("adaptive", (s) => s.outputTokens))],
      ["Answer size (yardstick tokens)", n0(per("adaptive", (s) => s.answerTokens)), n0(per("html", (s) => s.answerTokens)), ratio(per("html", (s) => s.answerTokens), per("adaptive", (s) => s.answerTokens))],
      ["Total time", secs(per("adaptive", (s) => s.totalMs)), secs(per("html", (s) => s.totalMs)), ratio(per("html", (s) => s.totalMs), per("adaptive", (s) => s.totalMs))],
      ["Cost per working screen", usd(per("adaptive", (s) => s.costPerWorking)), usd(per("html", (s) => s.costPerWorking)), ratio(per("html", (s) => s.costPerWorking), per("adaptive", (s) => s.costPerWorking))],
    ]));
  }

  h("Model against model (answer size on one yardstick)");
  out.push(table(["Model", ...formats.flatMap((f) => [`${f} size`, `${f} time`, `${f} first token`, `${f} tok/s`])], rec.meta.models.map((m) => [name(m.key), ...formats.flatMap((f) => { const s = stat(used.filter((a) => a.model === m.key && a.format === f)); return [n0(s.answerTokens), secs(s.totalMs), secs(s.firstTokenMs), n0(s.tps)]; })])));

  h("By level");
  out.push(`All models together, first turns, each model's median run.\n`);
  const lvl = used.filter((a) => a.turn === 1);
  out.push(table(["Level", "Format", "Answers", "Works", "Answer size (median)", "Output tokens (median)", "Total time (median)", "Cost per working screen"], LEVELS.flatMap((L) => formats.map((f) => { const s = stat(lvl.filter((a) => a.level === L && a.format === f)); return [L, f, String(s.n), share(s.works, s.n), n0(s.answerTokens), n0(s.outputTokens), secs(s.totalMs), usd(s.costPerWorking)]; }))));

  h("Personal vs enterprise, tidy vs vague");
  out.push(`Across all ${rec.meta.taskCount} requests only (four a side inside one level is too few to say anything), first turns.\n`);
  const split = (key: (a: RealAnswer) => string, values: string[]) => table([" ", "Format", "Answers", "Works", "Answer size (median)", "Total time (median)", "Cost per working screen"], values.flatMap((v) => formats.map((f) => { const s = stat(lvl.filter((a) => key(a) === v && a.format === f)); return [v, f, String(s.n), share(s.works, s.n), n0(s.answerTokens), secs(s.totalMs), usd(s.costPerWorking)]; })));
  out.push(split((a) => a.audience, ["personal", "enterprise"]));
  out.push("\n" + split((a) => a.wording, ["tidy", "vague"]));

  h("First turn vs follow-up");
  out.push(table(["Turn", "Format", "Answers", "Works", "Answer size (median)", "Output tokens (median)", "Total time (median)", "Cost per working screen"], ([1, 2] as const).flatMap((t) => formats.map((f) => { const s = stat(used.filter((a) => a.turn === t && a.format === f)); return [t === 1 ? "request" : "follow-up", f, String(s.n), share(s.works, s.n), n0(s.answerTokens), n0(s.outputTokens), secs(s.totalMs), usd(s.costPerWorking)]; }))));

  h("Prompt cache");
  out.push(`Share of input tokens read from the cache, over the median run's answers. The cold request is the warm-up call (one per model and format), left out of every median above.\n`);
  out.push(table(["Model", "Format", "Cached share of input", "Cold: input", "Cold: cache write", "Cold: time", "Cold: cost"], rec.meta.models.flatMap((m) => formats.map((f) => {
    const a = used.filter((x) => x.model === m.key && x.format === f && x.ok && x.inputTokens !== undefined);
    const withCache = a.filter((x) => x.cachedTokens !== undefined);
    const c = rec.cold.find((x) => x.model === m.key && x.format === f);
    return [name(m.key), f, withCache.length ? share(sum(known(withCache.map((x) => x.cachedTokens))), sum(known(withCache.map((x) => x.inputTokens)))).replace(/\((\d+)\/(\d+)\)/, `($1 of $2 tokens, ${withCache.length} answers)`) : `not reported (${a.length} answers)`, c?.ok ? n0(c.inputTokens) : c ? "failed" : "-", c?.ok ? n0(c.cacheWriteTokens) : "-", c?.ok ? secs(c.totalMs) : "-", c?.ok ? usd(c.cost) : "-"];
  }))));

  if (formats.includes("adaptive")) {
    h("Adaptive routes");
    out.push(`known: the app named the guide. map: answered from the map. chosen: the model asked for a sized guide. full: it asked for, or fell back to, the whole guide. Over all runs, first turns.\n`);
    out.push(table(["Model", "Answers", "map", "chosen", "full", "known", "Whole guide share", "Extra model call share"], rec.meta.models.map((m) => {
      const a = all.filter((x) => x.model === m.key && x.format === "adaptive" && x.ok && x.turn === 1 && x.route);
      const c = (k: string) => a.filter((x) => x.route!.kind === k).length;
      return [name(m.key), String(a.length), String(c("map")), String(c("chosen")), String(c("full")), String(c("known")), share(c("full"), a.length), share(a.filter((x) => x.modelCalls > 1).length, a.length)];
    })));
    const asked = new Map<string, number>();
    for (const a of all) if (a.format === "adaptive" && a.route) for (const t of [...a.route.capabilities, ...a.route.elements]) asked.set(t, (asked.get(t) ?? 0) + 1);
    const top = [...asked].sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (top.length) out.push(`\nAsked for most often: ${top.map(([t, c]) => `${t} (${c})`).join(", ")}.`);
  }

  h("Run-to-run spread");
  const multi = rec.meta.models.filter((m) => new Set(all.filter((a) => a.model === m.key).map((a) => a.run)).size > 1);
  if (!multi.length) out.push("No model ran the set more than once in this run.");
  for (const m of multi) {
    out.push(`\n**${name(m.key)}** (lowest and highest of ${new Set(all.filter((a) => a.model === m.key).map((a) => a.run)).size} runs; median run is run ${mr.get(m.key)}):\n`);
    const runs = [...new Set(all.filter((a) => a.model === m.key).map((a) => a.run))].sort((a, b) => a - b);
    const range = (f: RealFormat, pick: (s: Stat) => number | undefined, fmt: (x: number | undefined) => string, pct = false) => {
      const vs = known(runs.map((r) => pick(stat(all.filter((a) => a.model === m.key && a.format === f && a.run === r)))));
      return vs.length ? `${fmt(Math.min(...vs))} to ${fmt(Math.max(...vs))}` : "?";
    };
    out.push(table(["Figure", ...formats], [
      ["Working answers (share)", ...formats.map((f) => range(f, (s) => (s.n ? s.works / s.n : undefined), (x) => (x === undefined ? "?" : `${Math.round(x * 100)}%`)))],
      ["Output tokens (median)", ...formats.map((f) => range(f, (s) => s.outputTokens, n0))],
      ["Total time (median)", ...formats.map((f) => range(f, (s) => s.totalMs, secs))],
      ["Cost per working screen", ...formats.map((f) => range(f, (s) => s.costPerWorking, usd))],
    ]));
  }

  h("Requests with no answer");
  out.push(`A request that failed even after one retry. Counted here, never as a failure of the format.\n`);
  out.push(table(["Model", ...formats.map((f) => `${f} (of requests)`), "Retries used"], rec.meta.models.map((m) => [name(m.key), ...formats.map((f) => { const a = all.filter((x) => x.model === m.key && x.format === f); return `${a.filter((x) => !x.ok).length}/${a.length}`; }), String(sum(all.filter((x) => x.model === m.key).map((x) => x.retries)))])));
  for (const a of noAnswer.slice(0, 20)) out.push(`- ${name(a.model)} ${a.task} ${a.format} run ${a.run} turn ${a.turn}: ${(a.error ?? "").slice(0, 160)}`);

  h("Answer quality notes");
  out.push(table(["Model", "Format", "Cut off at the limit", "Renders with errors", "Copied the rows (extreme)", "HTML: fixed colors", "HTML: HTML from strings", "HTML: external scripts"], rec.meta.models.flatMap((m) => formats.map((f) => {
    const a = all.filter((x) => x.model === m.key && x.format === f && x.ok);
    const ext = a.filter((x) => x.copiedRows !== undefined);
    return [name(m.key), f, share(a.filter((x) => x.cutOff).length, a.length), share(a.filter((x) => !x.valid).length, a.length), ext.length ? share(ext.filter((x) => x.copiedRows).length, ext.length) : "-", f === "html" ? String(sum(a.map((x) => x.code.fixedColors))) : "-", f === "html" ? String(sum(a.map((x) => x.code.htmlInserts))) : "-", f === "html" ? String(sum(a.map((x) => x.code.externalScripts))) : "-"];
  }))));

  h("Every answer whose checks failed");
  out.push(`Listed so a wrong check is easy to spot by eye: if one check fails across many models and both formats, suspect the check. Answers are in answers/<file>.\n`);
  const failed = all.filter((a) => a.ok && !a.success);
  const checkFails = new Map<string, number>();
  for (const a of failed) for (const c of a.checks.filter((x) => !x.passed)) checkFails.set(`${a.task}: ${c.label}`, (checkFails.get(`${a.task}: ${c.label}`) ?? 0) + 1);
  const common = [...checkFails].filter(([, c]) => c >= 6).sort((a, b) => b[1] - a[1]);
  if (common.length) out.push(`Checks that failed 6 or more times (most likely to be wrong):\n${common.map(([k, c]) => `- ${k} (${c})`).join("\n")}\n`);
  if (!failed.length) out.push("None.");
  for (const a of failed) {
    const bad = a.checks.filter((c) => !c.passed).map((c) => `${c.label}${c.why ? ` (${c.why})` : ""}`);
    const probs = a.valid ? [] : a.problems.slice(0, 2).map((p) => `renders badly: ${p.slice(0, 100)}`);
    out.push(`- ${name(a.model)} · ${a.task}${a.turn === 2 ? " follow-up" : ""} · ${a.format} · run ${a.run}${a.file ? ` · ${a.file}` : ""}: ${[...bad, ...probs].join("; ") || "failed"}`);
  }
  return out.join("\n") + "\n";
}

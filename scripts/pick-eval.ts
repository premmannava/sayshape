/**
 * Does a model pick the representation that shows the data best? Scores
 * answers to eval/picks.ts: best (2), ok (1), poor or other (0), plus whether
 * each answer parses and draws cleanly.
 *
 *   npm run pick-eval                         ask the model from .env.local (full guide)
 *   npm run pick-eval -- --guide compact      the compact guide instead
 *   npm run pick-eval -- --runs 2             each request twice
 *   npm run pick-eval -- --only a,b           only these requests (by id)
 *   npm run pick-eval -- --answers a.jsonl    score answers made elsewhere, one JSON per line:
 *                                             {"id", "spec", "model"?, "setup"?, "run"?}
 *   npm run pick-eval -- --prompts <dir>      write what a model is given (the quick start, the
 *                                             full guide, each element's docs, the requests)
 *                                             without the grades, for running models by hand
 *
 * Reports go to eval/results/picks-<date>/ (report.md and results.json), or to --out.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { languageGuide, type GuideMode } from "../src/prompt";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import { generateSpec } from "../src/model";
import { elementSignatures, pickCases, registryDefaults, scoreElements, type Grade, type PickCase } from "../eval/picks";
import { textOverflows } from "../test/overflow";
import { readModelEnv } from "./model-env";

const registry = new Registry([...coreComponents, ...mapComponents]);
/** Props left out take the element's own default (a chart without kind= is a bar chart). */
const defaults = registryDefaults(registry);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface PickAnswer {
  id: string;
  spec: string;
  model?: string;
  setup?: string;
  run?: number;
  /** Set when asking the model failed, so the case counts against it instead of vanishing. */
  failed?: string;
}

export interface PickResult extends Required<Omit<PickAnswer, "spec" | "failed">> {
  group: string;
  trap: boolean;
  round: number;
  /** For a case with several parts, each part's grade. */
  parts?: Array<{ label: string; grade: Grade }>;
  grade: Grade;
  points: number;
  matched: string[];
  /** What the answer was made of (its signatures that any grade list names). */
  used: string[];
  errors: number;
  warnings: string[];
  overflows: number;
  /** It threw while drawing (an engine bug, never the model's fault). */
  crashed?: string;
  /** No answer came back for this case (scored 0), or asking for it failed. */
  missing?: string;
}

/** Grade one answer and check it parses and draws at a chat's width. */
export function scoreAnswer(c: PickCase, a: PickAnswer): PickResult {
  if (a.failed !== undefined) return missingResult(c, a, a.failed);
  const parsed = parse(a.spec, registry);
  const elements = elementSignatures(parsed.root, defaults);
  const sigs = new Set(elements.flat());
  const g = scoreElements(c, elements);
  const named = new Set([...c.best, ...(c.ok ?? []), ...(c.poor ?? []), ...(c.never ?? []), ...(c.parts ?? []).flatMap((p) => [...p.best, ...(p.ok ?? [])])]);
  let overflows = 0;
  let crashed: string | undefined;
  try {
    const ui = render(a.spec, { width: 600, components: [...coreComponents, ...mapComponents] });
    overflows = textOverflows(ui.sayshape.boxes!, ui.drawOps).length;
    ui.destroy();
  } catch (e) {
    crashed = e instanceof Error ? e.message : String(e);
  }
  return {
    id: a.id,
    model: a.model ?? "?",
    setup: a.setup ?? "?",
    run: a.run ?? 1,
    group: c.group,
    trap: !!c.trap,
    round: c.round ?? 1,
    grade: g.grade,
    points: g.points,
    matched: g.matched,
    ...(g.parts ? { parts: g.parts } : {}),
    used: [...sigs].filter((s) => named.has(s) || s.startsWith("chart:")).sort(),
    errors: parsed.diagnostics.filter((d) => d.severity === "error").length,
    warnings: parsed.diagnostics.filter((d) => d.severity === "warning").map((d) => `line ${d.line}: ${d.message}`),
    overflows,
    ...(crashed ? { crashed } : {}),
  };
}

/** A case with no answer: 0 points, so a model can't score higher by skipping. */
function missingResult(c: PickCase, a: Pick<PickAnswer, "id" | "model" | "setup" | "run">, why: string): PickResult {
  return {
    id: a.id, model: a.model ?? "?", setup: a.setup ?? "?", run: a.run ?? 1,
    group: c.group, trap: !!c.trap, round: c.round ?? 1,
    grade: "other", points: 0, matched: [], used: [], errors: 0, warnings: [], overflows: 0, missing: why,
  };
}

/**
 * Every case for every model, setup and run that answered anything: a case with no answer is
 * scored 0 and named, and a repeated answer keeps the last one.
 */
export function completeResults(results: PickResult[], cases: readonly PickCase[] = pickCases): { results: PickResult[]; repeated: string[] } {
  const keyOf = (r: Pick<PickResult, "model" | "setup" | "run">) => `${r.model}\u0000${r.setup}\u0000${r.run}`;
  const byRun = new Map<string, Map<string, PickResult>>();
  const repeated: string[] = [];
  for (const r of results) {
    const k = keyOf(r);
    const m = byRun.get(k) ?? new Map<string, PickResult>();
    if (m.has(r.id)) repeated.push(`${r.id} (${r.model} · ${r.setup}, run ${r.run})`);
    m.set(r.id, r);
    byRun.set(k, m);
  }
  const out: PickResult[] = [];
  for (const m of byRun.values()) {
    const first = m.values().next().value as PickResult;
    for (const c of cases) out.push(m.get(c.id) ?? missingResult(c, { id: c.id, model: first.model, setup: first.setup, run: first.run }, "no answer"));
  }
  return { results: out, repeated };
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");

/** A Markdown report: scores per model and setup, per group, traps, and every case that missed best. */
export function pickReport(results: PickResult[], title: string, cases: readonly PickCase[] = pickCases): string {
  const keyOf = (r: PickResult) => `${r.model} · ${r.setup}`;
  const keys = [...new Set(results.map(keyOf))].sort();
  const out: string[] = [`# ${title}`, ""];
  const score = (rs: PickResult[]) => `${pct(rs.reduce((a, r) => a + r.points, 0), rs.length * 2)} (best ${rs.filter((r) => r.grade === "best").length}/${rs.length})`;
  out.push("| Model · setup | Score | Round 1 | Round 2 | Charts | Structure | Inputs | Content | Traps | Clean | Warned | Missing |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const k of keys) {
    const rs = results.filter((r) => keyOf(r) === k);
    const g = (name: string) => score(rs.filter((r) => r.group === name));
    const answered = rs.filter((r) => !r.missing);
    const clean = answered.filter((r) => !r.errors && !r.crashed && !r.overflows).length;
    const warned = answered.filter((r) => r.warnings.length).length;
    out.push(`| ${k} | ${score(rs)} | ${score(rs.filter((r) => r.round === 1))} | ${score(rs.filter((r) => r.round === 2))} | ${g("chart")} | ${g("structure")} | ${g("input")} | ${g("content")} | ${score(rs.filter((r) => r.trap))} | ${pct(clean, answered.length)} | ${warned} | ${rs.length - answered.length} |`);
  }
  out.push("", "## Each case", "", `| Case | Best | ${keys.join(" | ")} |`, `|---|---|${keys.map(() => "---").join("|")}|`);
  for (const c of cases) {
    const cells = keys.map((k) => {
      const rs = results.filter((r) => r.id === c.id && keyOf(r) === k);
      return rs.map((r) => {
        if (r.missing) return "– missing";
        if (r.grade === "best") return "✓";
        const mark = r.grade === "ok" ? "~" : "✗";
        if (r.parts) return `${mark} ${r.parts.filter((p) => p.grade !== "best").map((p) => `${p.label}: ${p.grade}`).join(", ")}`;
        return `${mark} ${r.used.filter((u) => !c.best.includes(u)).slice(0, 3).join(", ") || "—"}`;
      }).join(" / ") || "";
    });
    const best = c.parts ? c.parts.map((p) => `${p.label}: ${p.best.join("/")}`).join("; ") : c.best.join(", ");
    out.push(`| ${c.id}${c.trap ? " (trap)" : ""}${c.round === 2 ? " ²" : ""} | ${best} | ${cells.join(" | ")} |`);
  }
  const bad = results.filter((r) => r.errors || r.crashed || r.overflows);
  if (bad.length) {
    out.push("", "## Answers that didn't draw cleanly", "");
    for (const r of bad) {
      const what = [r.crashed ? `crashed: ${r.crashed}` : "", r.errors ? `${r.errors} errors` : "", r.overflows ? `${r.overflows} pieces of text spilling out of their box` : ""].filter(Boolean);
      out.push(`- ${r.id} (${keyOf(r)}, run ${r.run}): ${what.join("; ")}`);
    }
  }
  const warned = results.filter((r) => r.warnings.length);
  if (warned.length) {
    out.push("", "## Warnings", "");
    for (const r of warned) out.push(`- ${r.id} (${keyOf(r)}, run ${r.run}): ${r.warnings.join("; ")}`);
  }
  const missing = results.filter((r) => r.missing);
  if (missing.length) {
    out.push("", "## Missing answers (scored 0)", "");
    for (const r of missing) out.push(`- ${r.id} (${keyOf(r)}, run ${r.run}): ${r.missing}`);
  }
  out.push("", "✓ best · ~ acceptable (what it used instead) · ✗ poor or something else · – no answer · ² round 2 (harder)", "");
  return out.join("\n");
}

/** One answer from a JSON line, checked, or a message saying what's wrong with it. */
function answerFrom(value: unknown, where: string): PickAnswer {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || typeof v.id !== "string" || typeof v.spec !== "string") {
    throw new Error(`${where}: an answer needs "id" and "spec" as text, e.g. {"id": "share-few", "spec": "chart kind=pie …"}`);
  }
  if (v.run !== undefined && !(typeof v.run === "number" && Number.isInteger(v.run) && v.run >= 1)) {
    throw new Error(`${where}: "run" is a whole number from 1, not ${JSON.stringify(v.run)}`);
  }
  return {
    id: v.id, spec: v.spec,
    ...(typeof v.model === "string" ? { model: v.model } : {}),
    ...(typeof v.setup === "string" ? { setup: v.setup } : {}),
    ...(typeof v.run === "number" ? { run: v.run } : {}),
  };
}

function readJsonLines(file: string): PickAnswer[] {
  const out: PickAnswer[] = [];
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${file}, line ${i + 1}: not valid JSON`);
    }
    out.push(answerFrom(value, `${file}, line ${i + 1}`));
  });
  return out;
}

/**
 * Answers from a file of JSON lines, or a folder of .jsonl files and answer folders named
 * <model>-<setup>-r<run> (the setup without hyphens) holding one <id>.sayshape per request.
 * Anything else in the folder is skipped, with a warning.
 */
function readAnswers(path: string): PickAnswer[] {
  if (!existsSync(path)) throw new Error(`No answers at ${path}: give a .jsonl file or a folder of answers`);
  if (!statSync(path).isDirectory()) return readJsonLines(path);
  const out: PickAnswer[] = [];
  for (const name of readdirSync(path)) {
    const full = join(path, name);
    if (statSync(full).isFile()) {
      if (name.endsWith(".jsonl")) out.push(...readJsonLines(full));
      else console.warn(`Skipped ${name}: answers are .jsonl files or <model>-<setup>-r<run> folders`);
      continue;
    }
    const tag = /^(.+)-([^-]+)-r(\d+)$/.exec(name);
    if (!tag) {
      console.warn(`Skipped the folder ${name}: answer folders are named <model>-<setup>-r<run>, e.g. haiku-A-r1`);
      continue;
    }
    for (const f of readdirSync(full)) {
      if (!f.endsWith(".sayshape")) { console.warn(`Skipped ${name}/${f}: answers are <id>.sayshape files`); continue; }
      out.push({ id: f.replace(/\.sayshape$/, ""), spec: readFileSync(join(full, f), "utf8"), model: tag[1]!, setup: tag[2]!, run: Number(tag[3]) });
    }
  }
  return out;
}

/** What a model is shown, without the grades: for running models by hand (or as agents). */
async function writePrompts(dir: string): Promise<void> {
  mkdirSync(join(dir, "docs"), { recursive: true });
  // The MCP server's own texts, so a model sees exactly what it sees in a chat app. The path is a
  // variable so the library's typecheck doesn't follow it into mcp/, whose packages are installed
  // separately (npm --prefix mcp install).
  const server = "../mcp/src/server";
  const mcp = (await import(server)) as { quickStart(): string; docsText(elements: string[], topics: string[]): string };
  writeFileSync(join(dir, "quickstart.txt"), mcp.quickStart());
  writeFileSync(join(dir, "guide-full.txt"), languageGuide(registry));
  for (const def of [...coreComponents, ...mapComponents]) writeFileSync(join(dir, "docs", `${def.type}.txt`), mcp.docsText([def.type], []));
  writeFileSync(join(dir, "requests.json"), JSON.stringify(pickCases.map((c) => ({ id: c.id, request: c.request })), null, 2));
}

async function main(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const prompts = arg("prompts");
  if (prompts) {
    await writePrompts(resolve(prompts));
    console.log(`Wrote the quick start, the full guide, ${coreComponents.length + mapComponents.length} element docs and ${pickCases.length} requests to ${prompts}`);
    return;
  }
  const only = arg("only")?.split(",").map((x) => x.trim()).filter(Boolean);
  const unknownOnly = (only ?? []).filter((id) => !pickCases.some((c) => c.id === id));
  if (unknownOnly.length) throw new Error(`--only names no case: ${unknownOnly.join(", ")}`);
  const cases = only ? pickCases.filter((c) => only.includes(c.id)) : pickCases;
  const byId = new Map(cases.map((c) => [c.id, c] as const));
  let answers: PickAnswer[];
  const from = arg("answers");
  if (from) {
    answers = readAnswers(resolve(from));
    if (!answers.length) throw new Error(`No answers found in ${from}: answers are .jsonl files or <model>-<setup>-r<run> folders of <id>.sayshape files`);
  }
  else {
    const env = readModelEnv();
    if (!env.model) throw new Error("Set SAYSHAPE_MODEL (and SAYSHAPE_MODEL_URL, SAYSHAPE_API_KEY) in .env.local, or score answers with --answers");
    const guide = arg("guide") ?? "full";
    if (guide !== "full" && guide !== "compact") throw new Error(`--guide is full or compact, not "${guide}"`);
    const mode: GuideMode = guide;
    const runs = Number(arg("runs") ?? 1);
    if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs is a whole number from 1, not "${arg("runs")}"`);
    answers = [];
    for (let run = 1; run <= runs; run++) {
      for (const c of cases) {
        try {
          const r = await generateSpec({ config: { url: env.url, model: env.model, apiKey: env.apiKey }, registry, guide: { mode }, request: c.request, userSuffix: env.userSuffix, repairOn: "errors" });
          answers.push({ id: c.id, spec: r.spec, model: env.model, setup: mode, run });
          process.stdout.write(".");
        } catch (e) {
          // One failed request counts against the model; the rest of the run goes on.
          answers.push({ id: c.id, spec: "", model: env.model, setup: mode, run, failed: `asking failed: ${e instanceof Error ? e.message : String(e)}` });
          process.stdout.write("x");
        }
      }
    }
    process.stdout.write("\n");
  }
  const unknown = answers.filter((a) => !byId.has(a.id)).map((a) => a.id);
  if (unknown.length) console.warn(`Not scored (no such case${only ? ", or not in --only" : ""}): ${[...new Set(unknown)].join(", ")}`);
  const { results, repeated } = completeResults(answers.filter((a) => byId.has(a.id)).map((a) => scoreAnswer(byId.get(a.id)!, a)), cases);
  if (repeated.length) console.warn(`Answered more than once (the last answer counts): ${repeated.join(", ")}`);
  const out = resolve(arg("out") ?? `eval/results/picks-${date}`);
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  const md = pickReport(results, `Picking the right representation: ${date}`, cases);
  writeFileSync(join(out, "report.md"), md);
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(md.split("\n## Each case")[0]);
  console.log(`Report: ${join(out, "report.md")}`);
}

// Run as a script, not when the tests import its scorer.
if (!process.env.VITEST) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

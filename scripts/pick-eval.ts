/**
 * Does a model pick the representation that shows the data best? Scores
 * answers to eval/picks.ts: best (2), ok (1), poor or other (0), plus whether
 * each answer parses and draws cleanly.
 *
 *   npm run pick-eval                         ask the model from .env.local (full guide)
 *   npm run pick-eval -- --guide compact      the compact guide instead
 *   npm run pick-eval -- --runs 2             each request twice
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
import { grade, pickCases, POINTS, signatures, type Grade, type PickCase } from "../eval/picks";
import { textOverflows } from "../test/overflow";
import { readModelEnv } from "./model-env";

const registry = new Registry([...coreComponents, ...mapComponents]);

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
}

export interface PickResult extends Required<Omit<PickAnswer, "spec">> {
  group: string;
  trap: boolean;
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
}

/** Grade one answer and check it parses and draws at a chat's width. */
export function scoreAnswer(c: PickCase, a: PickAnswer): PickResult {
  const parsed = parse(a.spec, registry);
  const sigs = signatures(parsed.root);
  const g = grade(c, sigs);
  const named = new Set([...c.best, ...(c.ok ?? []), ...(c.poor ?? [])]);
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
    grade: g.grade,
    points: POINTS[g.grade],
    matched: g.matched,
    used: [...sigs].filter((s) => named.has(s) || s.startsWith("chart:")).sort(),
    errors: parsed.diagnostics.filter((d) => d.severity === "error").length,
    warnings: parsed.diagnostics.filter((d) => d.severity === "warning").map((d) => `line ${d.line}: ${d.message}`),
    overflows,
    ...(crashed ? { crashed } : {}),
  };
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");

/** A Markdown report: scores per model and setup, per group, traps, and every case that missed best. */
export function pickReport(results: PickResult[], title: string): string {
  const keyOf = (r: PickResult) => `${r.model} · ${r.setup}`;
  const keys = [...new Set(results.map(keyOf))].sort();
  const out: string[] = [`# ${title}`, ""];
  const score = (rs: PickResult[]) => `${pct(rs.reduce((a, r) => a + r.points, 0), rs.length * 2)} (best ${rs.filter((r) => r.grade === "best").length}/${rs.length})`;
  out.push("| Model · setup | Score | Charts | Structure | Inputs | Content | Traps | Clean |", "|---|---|---|---|---|---|---|---|");
  for (const k of keys) {
    const rs = results.filter((r) => keyOf(r) === k);
    const g = (name: string) => score(rs.filter((r) => r.group === name));
    const clean = rs.filter((r) => !r.errors && !r.crashed && !r.overflows).length;
    out.push(`| ${k} | ${score(rs)} | ${g("chart")} | ${g("structure")} | ${g("input")} | ${g("content")} | ${score(rs.filter((r) => r.trap))} | ${pct(clean, rs.length)} |`);
  }
  out.push("", "## Each case", "", `| Case | Best | ${keys.join(" | ")} |`, `|---|---|${keys.map(() => "---").join("|")}|`);
  for (const c of pickCases) {
    const cells = keys.map((k) => {
      const rs = results.filter((r) => r.id === c.id && keyOf(r) === k);
      return rs.map((r) => (r.grade === "best" ? "✓" : `${r.grade === "ok" ? "~" : "✗"} ${r.used.filter((u) => !c.best.includes(u)).slice(0, 3).join(", ") || "—"}`)).join(" / ") || "";
    });
    out.push(`| ${c.id}${c.trap ? " (trap)" : ""} | ${c.best.join(", ")} | ${cells.join(" | ")} |`);
  }
  const bad = results.filter((r) => r.errors || r.crashed || r.overflows);
  if (bad.length) {
    out.push("", "## Answers that didn't draw cleanly", "");
    for (const r of bad) out.push(`- ${r.id} (${keyOf(r)}, run ${r.run}): ${r.crashed ? `crashed: ${r.crashed}` : ""}${r.errors ? `${r.errors} errors ` : ""}${r.overflows ? `${r.overflows} overflowing text ` : ""}`);
  }
  out.push("", "✓ best · ~ acceptable (what it used instead) · ✗ poor or something else", "");
  return out.join("\n");
}

/**
 * Answers from a file of JSON lines, a folder of them, or a folder of answer folders named
 * <model>-<setup>-r<run> holding one <id>.sayshape per request (as written by hand-run models).
 */
function readAnswers(path: string): PickAnswer[] {
  const out: PickAnswer[] = [];
  if (statSync(path).isDirectory()) {
    for (const sub of readdirSync(path)) {
      const dir = join(path, sub);
      const tag = /^(.+)-([^-]+)-r(\d+)$/.exec(sub);
      if (!tag || !statSync(dir).isDirectory()) continue;
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".sayshape"))) {
        out.push({ id: f.replace(/\.sayshape$/, ""), spec: readFileSync(join(dir, f), "utf8"), model: tag[1]!, setup: tag[2]!, run: Number(tag[3]) });
      }
    }
  }
  const files = statSync(path).isDirectory() ? readdirSync(path).filter((f) => f.endsWith(".jsonl") || f.endsWith(".json")).map((f) => join(path, f)) : [path];
  for (const f of files) {
    const text = readFileSync(f, "utf8").trim();
    if (!text) continue;
    if (text.startsWith("[")) out.push(...(JSON.parse(text) as PickAnswer[]));
    else for (const line of text.split("\n")) if (line.trim()) out.push(JSON.parse(line) as PickAnswer);
  }
  return out;
}

/** What a model is shown, without the grades: for running models by hand (or as agents). */
async function writePrompts(dir: string): Promise<void> {
  mkdirSync(join(dir, "docs"), { recursive: true });
  // The MCP server's own texts, so a model sees exactly what it sees in a chat app.
  const mcp = await import("../mcp/src/server");
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
  const byId = new Map(pickCases.map((c) => [c.id, c] as const));
  let answers: PickAnswer[];
  const from = arg("answers");
  if (from) answers = readAnswers(resolve(from));
  else {
    const env = readModelEnv();
    if (!env.model) throw new Error("Set SAYSHAPE_MODEL (and SAYSHAPE_MODEL_URL, SAYSHAPE_API_KEY) in .env.local, or score answers with --answers");
    const mode = (arg("guide") ?? "full") as GuideMode;
    const runs = Math.max(1, Number(arg("runs") ?? 1));
    answers = [];
    for (let run = 1; run <= runs; run++) {
      for (const c of pickCases) {
        const r = await generateSpec({ config: { url: env.url, model: env.model, apiKey: env.apiKey }, registry, guide: { mode }, request: c.request, userSuffix: env.userSuffix, repairOn: "errors" });
        answers.push({ id: c.id, spec: r.spec, model: env.model, setup: `guide ${mode}`, run });
        process.stdout.write(".");
      }
    }
    process.stdout.write("\n");
  }
  const unknown = answers.filter((a) => !byId.has(a.id)).map((a) => a.id);
  if (unknown.length) console.warn(`No case for: ${[...new Set(unknown)].join(", ")}`);
  const results = answers.filter((a) => byId.has(a.id)).map((a) => scoreAnswer(byId.get(a.id)!, a));
  const out = resolve(arg("out") ?? `eval/results/picks-${date}`);
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  const md = pickReport(results, `Picking the right representation: ${date}`);
  writeFileSync(join(out, "report.md"), md);
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(md.split("\n## Each case")[0]);
  console.log(`Report: ${join(out, "report.md")}`);
}

// Run as a script, not when the tests import its scorer.
if (!process.env.VITEST) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

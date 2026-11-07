/**
 * Interactive scenes against real models: each request in eval/scenes.ts is
 * sent with the scene elements turned on, streamed, checked (the parser and
 * the drawing check), repaired once when either finds something, and then
 * rendered and used (eval/scenes.ts scoreScene).
 *
 *   npm run scene-eval                              every request once, the model from .env.local
 *   npm run scene-eval -- --models a,b --runs 3     two models on the same server, three runs each
 *   npm run scene-eval -- --only factory,network    some requests
 *   npm run scene-eval -- --guide compact           the compact guide (default: full)
 *   npm run scene-eval -- --score <dir>             score spec files someone else generated:
 *                                                   <dir>/<model>/<task>-<run>.txt, and an optional
 *                                                   <task>-<run>.repair.txt for the repaired one
 *
 * Settings come from .env.local (scripts/model-env.ts). Results go to
 * eval/results/scenes-<date>/: report.md, results.json and every spec.
 *
 * Time to first useful render is when the streamed spec, cut at its last
 * whole line, first shows a scene with at least one pressable shape.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateSpec, tidySpec, type ModelConfig } from "../src/model";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { reviewScenes } from "../src/components/scene";
import { render } from "../src/testing";
import type { GuideMode } from "../src/prompt";
import { SCENE_COMPONENTS, sceneTasks, scoreScene, type SceneScore, type SceneTask } from "../eval/scenes";
import { readModelEnv } from "./model-env";

interface Row {
  model: string;
  task: string;
  run: number;
  first: SceneScore;
  final: SceneScore;
  repaired: boolean;
  outputChars: number;
  outputTokens?: number;
  inputTokens?: number;
  firstUsefulMs?: number;
  totalMs?: number;
}

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const registry = new Registry(SCENE_COMPONENTS);

/** Whether a streamed prefix already shows a scene with something to press. */
function usefulYet(spec: string): boolean {
  const cut = spec.slice(0, spec.lastIndexOf("\n") + 1);
  if (!/^\s*scene\b/m.test(cut) || !/\bon=/.test(cut)) return false;
  const ui = render(cut, { components: SCENE_COMPONENTS });
  try { return ui.hits.some((h) => h.box.node.type === "scene"); } finally { ui.destroy(); }
}

async function generate(task: SceneTask, model: string, run: number, mode: GuideMode): Promise<Row> {
  const env = readModelEnv("development", resolve(__dirname, ".."));
  const config: ModelConfig = { url: env.url, model, apiKey: env.apiKey || undefined, cache: env.cache };
  const start = performance.now();
  let text = "", lines = 0, firstUsefulMs: number | undefined;
  const r = await generateSpec({
    config, registry, request: task.request, guide: { mode },
    // The drawing check's warnings go back to the model with the parser's, as the MCP server returns them.
    check: (spec) => reviewScenes(parse(spec, registry)),
    onText: (t) => {
      text += t;
      const n = text.split("\n").length;
      // Check every few lines, not every token: rendering a prefix costs a few milliseconds.
      if (firstUsefulMs === undefined && n - lines >= 3) { lines = n; if (usefulYet(text)) firstUsefulMs = performance.now() - start; }
    },
    onReset: () => { text = ""; lines = 0; },
  });
  if (firstUsefulMs === undefined && usefulYet(r.first.spec + "\n")) firstUsefulMs = r.first.ms;
  return {
    model, task: task.id, run,
    first: scoreScene(task, r.first.spec), final: scoreScene(task, r.spec), repaired: !!r.repair,
    outputChars: r.first.spec.length, outputTokens: r.usage.completionTokens, inputTokens: r.usage.promptTokens,
    firstUsefulMs, totalMs: r.timings.totalMs,
  };
}

function scoreDir(dir: string): Row[] {
  const rows: Row[] = [];
  for (const model of readdirSync(dir).filter((d) => !d.includes("."))) {
    for (const f of readdirSync(join(dir, model)).filter((f) => /^[a-z]+-\d+\.txt$/.test(f))) {
      const [id, n] = f.replace(".txt", "").split("-");
      const task = sceneTasks.find((t) => t.id === id);
      if (!task) continue;
      const first = tidySpec(readFileSync(join(dir, model, f), "utf8"));
      const repairFile = join(dir, model, f.replace(".txt", ".repair.txt"));
      const final = existsSync(repairFile) ? tidySpec(readFileSync(repairFile, "utf8")) : first;
      rows.push({ model, task: id!, run: Number(n), first: scoreScene(task, first), final: scoreScene(task, final), repaired: existsSync(repairFile), outputChars: first.length });
    }
  }
  return rows;
}

function report(rows: Row[]): string {
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");
  const models = [...new Set(rows.map((r) => r.model))];
  const out = ["# Interactive scenes: real-model evaluation", "", `${rows.length} answers, ${sceneTasks.length} requests, models: ${models.join(", ")}.`, ""];
  out.push("| Model | Parses (first try) | Works (first try) | Clean drawing (first try) | Works after one repair | Repaired | Mean output chars |", "|---|---|---|---|---|---|---|");
  for (const m of models) {
    const rs = rows.filter((r) => r.model === m);
    out.push(`| ${m} | ${pct(rs.filter((r) => !r.first.errors.length).length, rs.length)} | ${pct(rs.filter((r) => r.first.passes).length, rs.length)} | ${pct(rs.filter((r) => !r.first.drawing.length).length, rs.length)} | ${pct(rs.filter((r) => r.final.passes).length, rs.length)} | ${rs.filter((r) => r.repaired).length} | ${Math.round(rs.reduce((n, r) => n + r.outputChars, 0) / Math.max(1, rs.length))} |`);
  }
  out.push("", "| Model | Request | Run | First try | After repair | Pressable (worked) | Keyboard | Drawing warnings (first → final) | Tokens out | First useful render | Total |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const f = r.final;
    const s = (x: SceneScore) => (x.passes ? "works" : x.failures.join("; "));
    out.push(`| ${r.model} | ${r.task} | ${r.run} | ${s(r.first)} | ${r.repaired ? s(f) : "–"} | ${f.pressable} (${f.pressesWork}) | ${f.keyboard} | ${r.first.drawing.length} → ${f.drawing.length} | ${r.outputTokens ?? "–"} | ${r.firstUsefulMs === undefined ? "–" : `${(r.firstUsefulMs / 1000).toFixed(1)} s`} | ${r.totalMs === undefined ? "–" : `${(r.totalMs / 1000).toFixed(1)} s`} |`);
  }
  return out.join("\n") + "\n";
}

async function main(): Promise<void> {
  const scored = arg("score");
  let rows: Row[];
  if (scored) rows = scoreDir(resolve(scored));
  else {
    const env = readModelEnv("development", resolve(__dirname, ".."));
    const models = (arg("models") ?? env.model).split(",").map((s) => s.trim()).filter(Boolean);
    if (!models.length) throw new Error("No model: set SAYSHAPE_MODEL in .env.local or pass --models");
    const only = arg("only")?.split(",");
    const runs = Number(arg("runs") ?? 1);
    const mode = (arg("guide") ?? "full") as GuideMode;
    rows = [];
    for (let run = 1; run <= runs; run++) {
      for (const task of sceneTasks.filter((t) => !only || only.includes(t.id))) {
        for (const model of models) {
          process.stdout.write(`${model} ${task.id} ${run}… `);
          const row = await generate(task, model, run, mode);
          console.log(row.final.passes ? "works" : row.final.failures.join("; "));
          rows.push(row);
        }
      }
    }
  }
  const dir = resolve(__dirname, "..", "eval", "results", `scenes-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "results.json"), JSON.stringify(rows, null, 1));
  writeFileSync(join(dir, "report.md"), report(rows));
  console.log(report(rows));
  console.log(`Wrote ${dir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

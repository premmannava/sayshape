/**
 * The real-world benchmark (eval/real, see eval/real/PLAN.md): SayShape vs HTML, six models,
 * under deployment conditions. Models are reached through OpenRouter.
 *
 *   npm run real -- --dry                 print models, prices, call count and a cost estimate; no calls
 *   npm run real -- --smoke               2 low requests, GPT-6 Luna only, one run
 *   npm run real                          the whole benchmark
 *   npm run real -- --models luna,haiku   some models (luna, sol, gemini, deepseek, haiku, sonnet, or an OpenRouter id)
 *   npm run real -- --formats adaptive,html,sayshape   sayshape (the whole guide up front) is off by default
 *   npm run real -- --only hard           a level (low, medium, hard, extreme) or request ids
 *   npm run real -- --budget 20           hard stop in dollars (default 20)
 *   npm run real -- --report <dir>        build report.md again from a finished run's results.json
 *
 * Settings: SAYSHAPE_API_KEY (an OpenRouter key) and optionally SAYSHAPE_MODEL_URL, from .env.local.
 * Results: eval/real/results/<date>/ with results.json, report.md and answers/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReport } from "../eval/real/report";
import { estimateCost, plannedCalls, promptSizes, makeRegistry, resolveModels, runReal, loadSaved, MODEL_SPECS, type RealFormat } from "../eval/real/run";
import { realTasks } from "../eval/real/tasks";
import { readModelEnv } from "./model-env";

const OPENROUTER = "https://openrouter.ai/api/v1";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const list = (name: string) => arg(name)?.split(",").map((s) => s.trim()).filter(Boolean);
const usd = (x: number) => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);

async function main(): Promise<void> {
  const root = resolve(__dirname, "..");
  const reportDir = arg("report");
  if (reportDir) {
    const dir = resolve(reportDir);
    const rec = loadSaved(dir);
    writeFileSync(resolve(dir, "report.md"), buildReport(rec));
    console.log(`Wrote ${dir}/report.md`);
    return;
  }

  const env = readModelEnv("development", root);
  const url = /openrouter\.ai/.test(env.url) ? env.url : OPENROUTER;
  const dry = flag("dry"), smoke = flag("smoke");
  if (!dry && !env.apiKey) throw new Error("No API key: set SAYSHAPE_API_KEY (an OpenRouter key) in .env.local.");

  const formats = (list("formats") ?? ["adaptive", "html"]) as RealFormat[];
  for (const f of formats) if (!["adaptive", "html", "sayshape"].includes(f)) throw new Error(`--formats takes adaptive, html and sayshape, not "${f}"`);
  const budget = Number(arg("budget") ?? 20);
  if (!(budget > 0)) throw new Error("--budget takes a number of dollars above 0");

  let tasks = realTasks;
  const only = list("only");
  if (smoke) tasks = realTasks.filter((t) => t.level === "low").slice(0, 2);
  else if (only) tasks = realTasks.filter((t) => only.includes(t.id) || only.includes(t.level));
  if (!tasks.length) throw new Error(`No requests match${only ? ` --only ${only.join(",")}` : ""}.`);

  const wanted = smoke ? ["luna"] : list("models") ?? MODEL_SPECS.map((m) => m.key);
  const models = await resolveModels(url, env.apiKey || undefined, wanted, dry);
  const runsOverride = smoke ? 1 : undefined;

  const plan = plannedCalls({ models, formats, tasks, runsOverride });
  const sizes = promptSizes(makeRegistry());
  const est = estimateCost({ models, formats, tasks, runsOverride }, sizes);
  const total = est.reduce((n, e) => n + e.dollars, 0);

  console.log(`Real-world benchmark: ${tasks.length} requests (${tasks.filter((t) => t.followUp).length} with a follow-up) x ${formats.join(" and ")} x ${models.length} model${models.length === 1 ? "" : "s"}${smoke ? " (smoke)" : ""}`);
  console.log(`System prompts: adaptive map ${sizes.adaptiveMap.tokens} tokens, whole guide ${sizes.full.tokens}, HTML ${sizes.html.tokens}.\n`);
  for (const [i, p] of plan.perModel.entries()) {
    const m = p.model;
    console.log(`  ${m.label.padEnd(20)} ${m.id.padEnd(40)} ${(m.providerName ?? m.provider ?? "unpinned").padEnd(16)} $${(m.prices.prompt * 1e6).toFixed(2)} in / $${(m.prices.completion * 1e6).toFixed(2)} out per M${m.prices.cacheRead !== undefined ? ` (cache read $${(m.prices.cacheRead * 1e6).toFixed(2)})` : ""}  ${p.runs} run${p.runs === 1 ? "" : "s"}, ${p.calls} requests, about ${usd(est[i]!.dollars)}`);
  }
  console.log(`\nPlanned: ${plan.total} requests (an adaptive answer takes a second call when the model asks for a guide). Estimated cost about ${usd(total)} with no caching (rough: sizes guessed, thinking counted at 3x). Budget ${usd(budget)}: the run stops there.`);
  if (total > budget) console.log(`Note: the estimate is above the budget, so a full run may stop early.`);
  if (dry) { console.log("\nDry run: no calls made."); return; }

  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const outDir = resolve(root, "eval", "real", "results", stamp);
  mkdirSync(resolve(outDir, "answers"), { recursive: true });
  let done = 0;
  const rec = await runReal({
    models, formats, tasks, runsOverride, budget, url, apiKey: env.apiKey || undefined, outDir,
    flags: { smoke, models: wanted, formats, only: only ?? null, budget },
    onAnswer: (a, spent) => {
      done++;
      const mark = !a.ok ? `NO ANSWER: ${a.error?.slice(0, 60)}` : a.noScreen ? "no screen" : a.success ? "works" : a.successRounded ? "rounded" : !a.valid ? "render error" : "check failed";
      console.log(`${String(done).padStart(4)}/${plan.total}  ${a.model.padEnd(9)} ${a.task.padEnd(10)} t${a.turn} ${a.format.padEnd(8)} ${mark.padEnd(10)} ${a.outputTokens ?? "?"} tok ${(a.totalMs / 1000).toFixed(1)}s  spent ${usd(spent)}`);
    },
  });
  writeFileSync(resolve(outDir, "results.json"), JSON.stringify(rec, null, 2));
  writeFileSync(resolve(outDir, "report.md"), buildReport(rec));
  console.log(`\nSpent ${usd(rec.meta.spent)}${rec.meta.stoppedByBudget ? " (stopped by the budget)" : ""}. Report: ${outDir}/report.md`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

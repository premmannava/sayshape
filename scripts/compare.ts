/**
 * Runs the SayShape vs HTML benchmark (eval/compare) against real models:
 *
 *   npm run compare                                  the model from .env.local, every task, once
 *   npm run compare -- --models openai/gpt-4.1,anthropic/claude-sonnet-4.5
 *   npm run compare -- --runs 3                      each task three times per model and format
 *   npm run compare -- --only kpi,d1                 some categories or task ids
 *   npm run compare -- --guide compact               SayShape's compact guide instead of the full one
 *
 * Settings come from .env.local like `npm run eval` (LOOM_MODEL_URL,
 * LOOM_API_KEY). With OpenRouter, each model's prices are looked up so the
 * report can show cost. Every answer is a first try, with no repair.
 *
 * Results go to eval/compare/results/<date>/: report.md, results.json, and
 * each answer as .loom or .html under answers/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import type { GuideMode } from "../src/prompt";
import { Registry } from "../src/registry";
import { HTML_PROMPT, report, runCompare, summarize, systemPrompt, type Format, type Prices } from "../eval/compare/run";
import { tasks } from "../eval/compare/tasks";
import { readModelEnv } from "./model-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const list = (name: string) => arg(name)?.split(",").map((s) => s.trim()).filter(Boolean);

/** Dollars per token for each model, from OpenRouter's model list. Other servers: unknown. */
async function pricesFor(url: string, models: string[]): Promise<Record<string, Prices>> {
  if (!/openrouter\.ai/.test(url)) return {};
  const res = await fetch(`${url}/models`).catch(() => null);
  if (!res?.ok) return {};
  const json = (await res.json()) as { data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
  const out: Record<string, Prices> = {};
  for (const m of json.data ?? []) {
    if (models.includes(m.id) && m.pricing?.prompt !== undefined && m.pricing.completion !== undefined) {
      out[m.id] = { prompt: Number(m.pricing.prompt), completion: Number(m.pricing.completion) };
    }
  }
  return out;
}

async function main(): Promise<void> {
  const env = readModelEnv("development", resolve(__dirname, ".."));
  const models = list("models") ?? (env.model ? [env.model] : []);
  if (!models.length) throw new Error("No model: pass --models, or set LOOM_MODEL in .env.local.");
  const only = list("only");
  const chosen = only ? tasks.filter((t) => only.includes(t.id) || only.includes(t.category)) : tasks;
  if (!chosen.length) throw new Error(`No tasks match --only ${only?.join(",")}`);
  const runs = Math.max(1, Number(arg("runs") ?? 1) || 1);
  const formats = (list("formats") ?? ["sayshape", "html"]) as Format[];
  const mode = (arg("guide") ?? "full") as GuideMode;
  if (mode !== "full" && mode !== "compact") throw new Error(`--guide takes full or compact, not "${mode}"`);

  const registry = new Registry([...coreComponents, ...mapComponents]);
  const guide = { imageHosts: [], mode };
  const prices = await pricesFor(env.url, models);
  const total = chosen.length * formats.length * models.length * runs;
  console.log(`SayShape vs HTML: ${chosen.length} tasks × ${formats.join(" and ")} × ${models.length} model${models.length === 1 ? "" : "s"} × ${runs} run${runs === 1 ? "" : "s"} = ${total} requests at ${env.url}`);
  for (const m of models) console.log(`  ${m}: ${prices[m] ? `$${(prices[m].prompt * 1e6).toFixed(2)} / $${(prices[m].completion * 1e6).toFixed(2)} per million tokens in / out` : "price unknown"}`);
  console.log("");

  const results = await runCompare(chosen, {
    config: { url: env.url, apiKey: env.apiKey || undefined, streamUsage: true, maxTokens: 8000 },
    models,
    formats,
    runs,
    registry,
    guide,
    prices,
    onResult: (r, done, n) => {
      const mark = !r.ok ? `failed: ${r.error?.slice(0, 80)}` : r.success ? "works" : `${r.checks.filter((c) => !c.passed).length + (r.valid ? 0 : 1)} problem(s)`;
      console.log(`${String(done).padStart(4)}/${n}  ${r.model.slice(0, 28).padEnd(28)} ${r.task.padEnd(4)} ${r.format.padEnd(9)} ${mark.padEnd(14)} ${r.usage.completionTokens ?? "?"} tokens, ${(r.totalMs / 1000).toFixed(1)} s`);
      if (!r.ok && done <= formats.length) {
        console.error("\nThe first requests failed, so the server is probably unreachable or the model name is wrong. Stopping.");
        process.exit(1);
      }
    },
  });

  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const dir = resolve(__dirname, "..", "eval", "compare", "results", stamp);
  mkdirSync(resolve(dir, "answers"), { recursive: true });
  const md = report(results, { date: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", url: env.url, runs, guideChars: systemPrompt("sayshape", registry, guide).length, htmlPromptChars: HTML_PROMPT.length });
  writeFileSync(resolve(dir, "report.md"), md);
  writeFileSync(resolve(dir, "results.json"), JSON.stringify({ url: env.url, models, runs, guide, prices, summary: summarize(results), results }, null, 2));
  for (const r of results) {
    if (!r.output) continue;
    writeFileSync(resolve(dir, "answers", `${r.model.replace(/[^\w.-]+/g, "_")}.${r.task}.${r.run}.${r.format === "sayshape" ? "loom" : "html"}`), r.output);
  }
  console.log("\n" + md.split("\n## By category")[0]);
  console.log(`Full report: ${dir}/report.md`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

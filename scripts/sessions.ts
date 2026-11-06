/**
 * Runs the conversation benchmark (eval/compare/sessions.ts) against real models: four-step
 * sessions answered in SayShape (refining), HTML (rewriting the page) and A2UI (updating its
 * surface), checked after every step.
 *
 *   npm run sessions -- --models openai/gpt-4.1,anthropic/claude-haiku-5.5
 *   npm run sessions -- --formats sayshape,html      some formats only
 *   npm run sessions -- --only s1,s3                 some sessions only
 *   npm run sessions -- --guide full                 SayShape's full guide instead of compact
 *   npm run sessions -- --cache 5m                   mark system prompts for caching (1h, 5m or off)
 *   npm run sessions -- --rescore <results dir> …    score saved runs again with the current checks;
 *                                                    with several dirs, also writes a combined report
 *
 * Settings come from .env.local like npm run compare. Results go to
 * eval/compare/results/<date>-sessions/: report.md and results.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import type { GuideMode } from "../src/prompt";
import { Registry } from "../src/registry";
import { pricesFor } from "../eval/compare/prices";
import { rescoreSessions, runSessions, sessionReport, summarizeSessions, type SessionFormat, type StepResult } from "../eval/compare/session-run";
import { sessions } from "../eval/compare/sessions";
import { parseCache, readModelEnv } from "./model-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const list = (name: string) => arg(name)?.split(",").map((s) => s.trim()).filter(Boolean);

/** --rescore: each saved run scored again in place, and with several, one combined report. */
async function rescore(dirs: string[]): Promise<void> {
  type Saved = { url: string; guide: string; cache: true | "1h" | null; prices: unknown; models: string[]; results: StepResult[] };
  const all: StepResult[] = [];
  const prices: Record<string, unknown> = {};
  const models: string[] = [];
  let first: Saved | undefined;
  for (const dir of dirs) {
    const saved = JSON.parse(readFileSync(resolve(dir, "results.json"), "utf8")) as Saved;
    first ??= saved;
    Object.assign(prices, saved.prices);
    models.push(...saved.models);
    const results = await rescoreSessions(saved.results, sessions);
    all.push(...results);
    const meta = { date: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC (rescored)", url: saved.url, guide: saved.guide, ...(saved.cache ? { cache: saved.cache } : {}) };
    writeFileSync(resolve(dir, "report.md"), sessionReport(results, meta));
    writeFileSync(resolve(dir, "results.json"), JSON.stringify({ ...saved, summary: summarizeSessions(results), results }, null, 2));
    console.log(`${dir}/report.md`);
  }
  if (dirs.length > 1 && first) {
    const out = resolve(dirs[0]!, "..", `${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)}-sessions-combined`);
    mkdirSync(out, { recursive: true });
    const md = sessionReport(all, { date: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC (combined)", url: first.url, guide: first.guide, ...(first.cache ? { cache: first.cache } : {}) });
    writeFileSync(resolve(out, "report.md"), md);
    writeFileSync(resolve(out, "results.json"), JSON.stringify({ ...first, models: [...new Set(models)], prices, summary: summarizeSessions(all), results: all }, null, 2));
    console.log("\n" + md.split("\n## Every step")[0]);
    console.log(`Combined report: ${out}/report.md`);
  }
}

async function main(): Promise<void> {
  const at = process.argv.indexOf("--rescore");
  if (at >= 0) return rescore(process.argv.slice(at + 1).filter((a) => !a.startsWith("--")));
  const env = readModelEnv("development", resolve(__dirname, ".."));
  const models = list("models") ?? (env.model ? [env.model] : []);
  if (!models.length) throw new Error("No model: pass --models, or set SAYSHAPE_MODEL in .env.local.");
  const formats = (list("formats") ?? ["sayshape", "html", "a2ui"]) as SessionFormat[];
  for (const f of formats) if (!["sayshape", "html", "a2ui"].includes(f)) throw new Error(`--formats takes sayshape, html and a2ui, not "${f}"`);
  const only = list("only");
  const chosen = only ? sessions.filter((s) => only.includes(s.id)) : sessions;
  if (!chosen.length) throw new Error(`No sessions match --only ${only?.join(",")}`);
  const mode = (arg("guide") ?? "compact") as GuideMode;
  if (mode !== "full" && mode !== "compact") throw new Error(`--guide takes full or compact, not "${mode}"`);
  const cacheArg = arg("cache");
  const cache = cacheArg === undefined ? env.cache : cacheArg === "off" ? undefined : parseCache(cacheArg);
  if (cacheArg !== undefined && cacheArg !== "off" && !cache) throw new Error(`--cache takes 1h, 5m or off, not "${cacheArg}"`);

  const registry = new Registry([...coreComponents, ...mapComponents]);
  const prices = await pricesFor(env.url, models);
  const steps = chosen.reduce((n, s) => n + s.steps.length, 0);
  console.log(`Conversations: ${chosen.length} sessions (${steps} steps) × ${formats.join(", ")} × ${models.length} model${models.length === 1 ? "" : "s"} = ${steps * formats.length * models.length} requests at ${env.url}`);
  for (const m of models) console.log(`  ${m}: ${prices[m] ? `$${(prices[m].prompt * 1e6).toFixed(2)} / $${(prices[m].completion * 1e6).toFixed(2)} per million tokens in / out` : "price unknown"}`);
  console.log("");

  const results = await runSessions(chosen, {
    config: { url: env.url, apiKey: env.apiKey || undefined, streamUsage: true, maxTokens: 8000, cache },
    models, formats, registry, guide: { imageHosts: [], mode }, prices,
    onResult: (r, done, n) => {
      const mark = !r.ok ? `failed: ${r.error?.slice(0, 60)}` : r.success ? "works" : `${r.checks.filter((c) => !c.passed).length + (r.valid ? 0 : 1)} problem(s)`;
      console.log(`${String(done).padStart(4)}/${n}  ${r.model.slice(0, 28).padEnd(28)} ${r.session} step ${r.step}  ${r.format.padEnd(9)} ${mark.padEnd(14)} ${r.usage.promptTokens ?? "?"} in, ${r.usage.completionTokens ?? "?"} out, ${(r.totalMs / 1000).toFixed(1)} s`);
    },
  });

  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const dir = resolve(__dirname, "..", "eval", "compare", "results", `${stamp}-sessions`);
  mkdirSync(dir, { recursive: true });
  const md = sessionReport(results, { date: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", url: env.url, guide: mode, ...(cache ? { cache } : {}) });
  writeFileSync(resolve(dir, "report.md"), md);
  writeFileSync(resolve(dir, "results.json"), JSON.stringify({ url: env.url, models, formats, guide: mode, cache: cache ?? null, prices, summary: summarizeSessions(results), results }, null, 2));
  console.log("\n" + md.split("\n## Every step")[0]);
  console.log(`Full report: ${dir}/report.md`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

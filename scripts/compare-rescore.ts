/**
 * Scores the answers of earlier `npm run compare` runs again, with the checks and screens as they
 * are now, without asking a model again: after a fix to the harness, old answers get the new
 * scoring for free. Rewrites each run's results.json and report.md in place.
 *
 *   npx vite-node scripts/compare-rescore.ts -- eval/compare/results/<run> [<run> ...]
 *   npx vite-node scripts/compare-rescore.ts -- --merge out/ eval/compare/results/<a> eval/compare/results/<b>
 *
 * With --merge, the runs' answers are scored and written as one report into the folder given.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { Registry } from "../src/registry";
import { a2uiPrompt } from "../eval/compare/a2ui";
import { HTML_PROMPT, report, score, summarize, systemPrompt, waitsOnServer, type AnswerResult } from "../eval/compare/run";
import { stressTasks } from "../eval/compare/stress";
import { tasks } from "../eval/compare/tasks";

interface Saved { url: string; models: string[]; runs: number; guide: { imageHosts: string[]; mode?: "full" | "compact" }; cache: true | "1h" | null; prices: unknown; results: AnswerResult[] }

async function rescore(results: AnswerResult[]): Promise<AnswerResult[]> {
  const out: AnswerResult[] = [];
  for (const r of results) {
    const task = [...tasks, ...stressTasks].find((t) => t.id === r.task);
    if (!task || !r.ok) { out.push(r); continue; }
    const s = await score(r.format, task, r.output);
    out.push({
      ...r, valid: s.valid, problems: s.problems, checks: s.checks, success: s.valid && s.checks.every((c) => c.passed),
      ...(r.format === "a2ui" ? { waitsOnServer: waitsOnServer(task, r.output, s) } : {}),
    });
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const mergeAt = args.indexOf("--merge");
  const out = mergeAt >= 0 ? args.splice(mergeAt, 2)[1] : undefined;
  const registry = new Registry([...coreComponents, ...mapComponents]);
  const runs = args.map((dir) => ({ dir: resolve(dir), saved: JSON.parse(readFileSync(resolve(dir, "results.json"), "utf8")) as Saved }));
  const write = (dir: string, saved: Saved, results: AnswerResult[]) => {
    const formats = new Set(results.map((r) => r.format));
    const md = report(results, {
      date: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC (rescored)", url: saved.url, runs: saved.runs,
      guideChars: systemPrompt("sayshape", registry, saved.guide).length, htmlPromptChars: HTML_PROMPT.length,
      ...(formats.has("a2ui") ? { a2uiPromptChars: a2uiPrompt().length } : {}), ...(saved.cache ? { cache: saved.cache } : {}),
    });
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "report.md"), md);
    writeFileSync(resolve(dir, "results.json"), JSON.stringify({ ...saved, summary: summarize(results), results }, null, 2));
    console.log(`${dir}/report.md`);
  };
  if (out) {
    const all: AnswerResult[] = [];
    for (const r of runs) all.push(...(await rescore(r.saved.results)));
    const first = runs[0]!.saved;
    write(resolve(out), { ...first, models: [...new Set(runs.flatMap((r) => r.saved.models))], prices: Object.assign({}, ...runs.map((r) => r.saved.prices)) }, all);
  } else {
    for (const r of runs) write(r.dir, r.saved, await rescore(r.saved.results));
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

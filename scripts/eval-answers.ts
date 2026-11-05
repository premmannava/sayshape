/**
 * Score a model on the landing page's data questions (eval/answers.ts): each
 * is answered the way the live proxy answers it, drawn by the engine with
 * every row, and checked for the right figures.
 *
 *   npm run eval:answers                                   settings from .env.local (see .env.example)
 *   npm run eval:answers -- --model <id> --only sov-country,sales-region
 *
 * For NVIDIA's API, set SAYSHAPE_MODEL_URL=https://integrate.api.nvidia.com/v1,
 * SAYSHAPE_API_KEY=nvapi-… and SAYSHAPE_MODEL to the model's id. Run it for
 * each model you're considering and compare the pass counts.
 */
import { answerCases, runAnswerCase, type AnswerResult } from "../eval/answers";
import { readModelEnv } from "./model-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const env = readModelEnv();
const model = arg("model") ?? env.model;
if (!model) throw new Error("No model: pass --model, or set SAYSHAPE_MODEL in .env.local.");
const only = arg("only")?.split(",").map((s) => s.trim());
const cases = answerCases().filter((c) => !only || only.includes(c.id));
const config = { url: env.url, model, apiKey: env.apiKey || undefined, maxTokens: 3000, streamUsage: process.env.SAYSHAPE_STREAM_USAGE !== "false" };

console.log(`${model} at ${env.url}: ${cases.length} questions\n`);
const results: AnswerResult[] = [];
for (const c of cases) {
  const r = await runAnswerCase(c, config);
  results.push(r);
  const tokens = r.promptTokens !== undefined ? ` · ${r.promptTokens.toLocaleString("en-US")} in / ${r.completionTokens?.toLocaleString("en-US")} out` : "";
  console.log(`${r.pass ? "✓" : "✗"} ${c.id.padEnd(22)} ${(r.ms / 1000).toFixed(1).padStart(5)} s${r.repaired ? " · repaired" : ""}${tokens}${r.why ? `\n    ${r.why}` : ""}`);
}
const passed = results.filter((r) => r.pass).length;
const ms = results.map((r) => r.ms).filter(Boolean).sort((a, b) => a - b);
console.log(`\n${passed} of ${results.length} right · median ${((ms[Math.floor(ms.length / 2)] ?? 0) / 1000).toFixed(1)} s · ${results.filter((r) => r.repaired).length} repaired`);
if (process.argv.includes("--specs")) for (const r of results) console.log(`\n--- ${r.id}: ${r.question}\n${r.spec}`);

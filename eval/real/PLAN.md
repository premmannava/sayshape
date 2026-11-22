# Real-world benchmark: SayShape vs HTML across six models

You are the orchestrator. Build a new benchmark in this repo with two sub-agents, then stop and give me the commands to run it. Do not run the benchmark yourself and do not spend any API money.

## First step

Save this whole prompt as `eval/real/PLAN.md`. Both sub-agents read that file, so never re-explain the design in a brief.

## Orchestrator rules (keep your own context small)

- Work on a new branch `real-benchmark` off `develop`. One PR at the end.
- Spawn agents A and B in parallel.
- Each brief is: "Read `eval/real/PLAN.md`, you are agent X" plus nothing else.
- Agents reply in 10 lines or fewer: files changed and how to verify. No diffs, no pasted code.
- Do not read the agents' code in full. Verify only with `npm run typecheck` and `npm run real -- --dry`. Never run the test suite and write no test files.
- Nobody (you or any agent) opens a `results.json`. Only scripts read it.

## What we are measuring

The same request, answered by the same model, once in SayShape and once as HTML, the way real deployments work. Then compare tokens, speed, cost and correctness.

Fixed decisions:

- **Models (via OpenRouter):** GPT-6 Luna, GPT-6.1 Sol, Gemini 3.8 Flash, DeepSeek V4.1 Flash, Claude Haiku 5.5, Claude Sonnet 5.5. Resolve exact ids from OpenRouter's `/models` list at run time (known so far: `anthropic/claude-haiku-5.5`, `anthropic/claude-sonnet-5.5`, `deepseek/deepseek-v4.1-flash-1017`). Fail clearly on an id that isn't listed.
- **Formats:** `adaptive` (SayShape the way the library ships: `generateSpec` with no `guide`, so the model gets the map first, asks for a sized guide when it needs one, and may ask for the whole guide) and `html` (existing `HTML_PROMPT`). `--formats` may also add `sayshape` (full guide up front); it is off by default. No MCP route here.
- **Runs:** GPT-6 Luna and Claude Haiku 5.5 run the set three times, to show how much results move between runs. The other four run it once. First try, no repair.
- **Budget:** hard stop at $20 total (`--budget`, default 20). The script prints prices and the planned call count before the first call.
- **Not in scope:** screenshots, a visual judge, test files, reference answers, the MCP route, the existing 26 tasks, the stress set, light/dark switching, motion, scenes, slide decks, maps.

## The request set (32 requests + 8 follow-ups)

- Four levels, 8 requests each: `low`, `medium`, `hard`, `extreme`.
- In every level: 4 `personal` and 4 `enterprise`; and 4 `tidy` wording, 4 `vague` (the short, loose way people actually type).
- **Low:** one thing, data in the sentence (a chart, a KPI row, a small table).
- **Medium:** two or three parts and one interaction (filter, sort, toggle, calculator, validated form). Up to 15 rows, in the request text.
- **Hard:** a full screen over about 50 rows, in the request text: filters drive every figure, chart and table; derived totals; a form that updates them.
- **Extreme:** about 200 rows of messy data (blanks, mixed date and money formats), several screens, grouped totals, multi-select filters, pagination, a detail view. **The rows are passed by name, not pasted in** (see below).
- Personal themes: monthly budget, subscriptions, trip cost split, loan comparison, workout log, study plan. Enterprise themes: insurance renewals pipeline, claims review, sales pipeline, support tickets, headcount, budget vs actual.
- **Follow-ups:** 4 hard and 4 extreme requests get one second turn ("now only Q3", "add a column for margin"), with its own checks.
- Datasets come from a seeded generator, never typed by hand, so every run and every model sees identical data and the expected figures are exact.
- **Checks stay light:** two to four per request, in the existing `TaskCheck` shape, using only what a person would see and do. Every expected figure is computed in code from the dataset, never typed in.

### Data by name (extreme level)

A real chatbot hands fetched rows to the screen; the model does not retype them. For extreme requests:

- The request text gives each list's name, its columns, five sample rows and the row count, and says the app supplies the rows.
- `RealTask.data` holds the full lists by name.
- **SayShape:** the host sets each list on the engine before the spec is drawn (as `draw` does in `bench/tokens/measure.ts`), and the guide is told the data is read by name (`GuideOptions` in `src/prompt.ts`, around the "never copy its rows" note).
- **HTML:** the lists are on `window.DATA.<name>` before the page's scripts run, and one line is added to the HTML instructions for these requests saying so and telling it not to copy the rows.
- An answer that copies the rows anyway is still scored, and flagged `copiedRows`.

## How a run works (real-world conditions)

- **Caching on wherever the model supports it.** Mark the system prompt for caching (existing `ModelConfig.cache`); OpenAI caches on its own. Record cached and cache-write tokens and bill them at the model's cache prices.
- **Warm-up:** one call per model and format before the set, recorded separately as the cold request and left out of the medians.
- **Order:** within a model, requests run one after another so the cache stays warm; the six models run in parallel.
- **Routing:** pin each model to its maker's own OpenRouter endpoint with fallbacks off, so cache hits are not lost. Check OpenRouter's current docs for the request field.
- **Same settings for both formats:** `maxTokens` 16000, no temperature override, same thinking setting.
- **Retry:** one retry after a short wait on a rate limit or server error (429, 5xx). Record `retries`. A request that still fails is "no answer": counted on its own line and left out of the format comparison, never scored as a failure of the format.
- **Follow-ups:** SayShape refines the existing spec; HTML gets the conversation and rewrites the page (as `eval/compare/session-run.ts` does today).
- **Scoring:** reuse `score` from `eval/compare/run.ts` (SayShape in the real engine, HTML in jsdom). Adaptive answers may be `report` presets, so render with the engine's `presets` on.
- **Run record:** `results.json` starts with the SayShape version, git commit, date, flags, each model's id and provider, its prices, and the size of each system prompt.
- **Flags:** `--dry` (print models, prices, call count and a cost estimate; make no calls), `--smoke` (2 low requests, GPT-6 Luna only, one run), `--models`, `--formats`, `--only <level|id>`, `--budget`.

## Metrics per answer

- Tokens as the provider reported them: input sent, fresh input, cached read, cache write, output, thinking, number of model calls (adaptive can take two).
- **Answer size on one yardstick:** the answer text counted with `tokens()` from `bench/tokens/measure.ts`, plus its characters. Providers count tokens differently, so use this for any model-against-model size comparison.
- Speed: time to first token, total time, output tokens per second.
- Cost: as billed, with no caching, the cold request, cost per working screen.
- Correctness: request ok, retries, cut off at the token limit (finish reason), renders without errors, each check, works overall.
- Adaptive only: route taken (`known`/`map`/`chosen`/`full`) and capabilities asked for, so the report shows how often a model asked for the whole guide.
- HTML only: hard-coded colors, HTML built from strings, external scripts (existing `codeStats`).
- Extreme only: `copiedRows`.
- Follow-up turn: all of the above again.

## Report (computed by code, never by a model)

`report.md` with medians and totals:

- SayShape vs HTML per model, and model vs model (sizes on the common yardstick).
- By level: low, medium, hard, extreme.
- Personal vs enterprise, and tidy vs vague, across all 32 requests only (never inside one level: four a side is too few).
- First turn vs follow-up.
- Share of input read from cache, and the cold request, per model.
- Adaptive routes taken per model.
- Run-to-run spread for GPT-6 Luna and Claude Haiku 5.5: lowest and highest of the three runs for each headline figure. Their tables use the median run.
- Headline ratios: output tokens, total time, cost per working screen.
- Requests with no answer, per model.
- Every answer whose checks failed, with the check's label, so a wrong check is easy to spot by eye.

State the count behind every percentage.

## Files and owners

| Agent | Model | Owns | May read |
|---|---|---|---|
| A. Request and dataset author | Opus | `eval/real/tasks.ts`, `eval/real/data.ts` | `eval/compare/tasks.ts`, `eval/compare/stress.ts` (first 80 lines), `eval/compare/sessions.ts` (first 60 lines) |
| B. Runner engineer | Sonnet | `eval/real/run.ts`, `eval/real/report.ts`, `scripts/real.ts`, the `real` line in `package.json`, the `.gitignore` line, a finish-reason field in `src/model/stream.ts` if missing, and one optional `data` argument on `score`, `sayshapeScreen` and `htmlScreen` | `eval/compare/run.ts`, `eval/compare/screens.ts`, `eval/compare/session-run.ts`, `eval/compare/prices.ts`, `scripts/compare.ts`, `scripts/model-env.ts`, `src/model/stream.ts`, `src/model/adaptive.ts`, `src/model/generate.ts`, `src/prompt.ts` (lines 140–180), `bench/tokens/measure.ts` |

Shared contract, fixed now so A and B can work at the same time:

```ts
// eval/real/tasks.ts
import type { Task, TaskCheck } from "../compare/tasks";
export interface RealTask extends Task {
  level: "low" | "medium" | "hard" | "extreme";
  audience: "personal" | "enterprise";
  wording: "tidy" | "vague";
  /** Extreme level: the lists the app supplies, by name. The request text shows only columns, five sample rows and the count. */
  data?: Record<string, Array<Record<string, string | number | null>>>;
  followUp?: { request: string; checks: TaskCheck[] };
}
export const realTasks: RealTask[];
```

Results go to `eval/real/results/<date>/` (git-ignored): `results.json`, `report.md`, `answers/`.

## Agent notes

- **A:** `request` holds the full text sent to the model: data included for low, medium and hard; columns, samples and count for extreme. Use category values that already exist on `Task`. Keep checks tolerant of formatting (`1,200` and `1200`, `$` or none).
- **B:** in `eval/compare/*` the only change allowed is the optional `data` argument named above, with behavior unchanged when it is left out; import everything else. Add a format `adaptive` in your own runner. The script must work with A's contract before A finishes (use two stub tasks while building, then remove them).

## Done means

1. `npm run typecheck` passes and `npm run real -- --dry` prints the plan.
2. The branch is pushed and a PR to `develop` is open.
3. You print, and do not run, the commands for me:
   - `npm run real -- --smoke`
   - `npm run real`
4. After I say the run finished, read only `report.md` (no sub-agent, no other file) and write `SUMMARY.md` beside it: the five most important findings, each with its numbers, and anything that looks unreliable.

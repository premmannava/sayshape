# Token benchmark

How much a model must read and write to produce a SayShape screen, and how much of it arrives before anything is drawn. It is the yardstick for the token work (presets, layout-first streaming, follow-ups as edits, prompt caching, parallel sections): each one is measured here the same way.

## What's here

| File | What it is |
|---|---|
| `requests.ts` | The seven requests (the claims review twice: data pasted, data by reference), with checks that every requested part is drawn, and ten follow-up changes |
| `claims.ts` | The fixed claims dataset: 40 claims, 12 monthly rows, 6 by-line rows, from a seed |
| `guides.ts` | The guides compared, by name. `compact` is the baseline |
| `measure.ts` | Scoring one answer |
| `runs/<variant>/` | The guide the writers read (`guide.txt`), their answers (`<request>__<run>.ss`) and the scores (`results.json`). A variant whose answers use new elements is added by the pull request that adds them, and scores only with that code |

## What is measured, per answer

- **Guide tokens**: the system prompt the writer read.
- **Output tokens**: the answer.
- **First-try clean**: draws with zero error diagnostics, with no repair. Warnings are counted separately in `results.json`.
- **Complete**: every requested part is drawn (the checks in `requests.ts` run on the rendered screen, so a filter has to filter and a table has to show all 40 claims).
- **Tokens before first paint**: the spec is cut at each line, as a stream arrives, and drawn; this is the tokens written up to and including the first line that draws an element.
- **Composition**: output tokens split into data (`state` lines), formulas (`derive` lines and `{…}`), visible words (quoted text) and structure (everything else).

One tokenizer throughout: **o200k_base**, from `gpt-tokenizer` (a dev dependency). It isn't Claude's tokenizer, so absolute numbers differ from a provider's usage report; compare variants with each other.

## How answers were written

No model is configured in `.env.local` here, so `npm run eval` can't run. Each answer was written by a fresh Claude Sonnet subagent that read only the guide text and one request, wrote its answer to a file in one go, and didn't test or revise it. Three runs per request. Two caveats: the writers ran inside this repository's working directory, so their own harness may have shown them this repository's `CLAUDE.md` as context; and a subagent isn't a production model call, so wall-clock time wasn't measured.

```bash
npm run token-bench -- kit /tmp/kit            # guides/<variant>.txt and requests/<id>.txt for writers
npm run token-bench -- score bench/tokens/runs # score every variant's answers, print the table
```

## Baseline (compact guide)

Tokenizer o200k_base. Medians of three runs.

| Request | Guide tokens | Output tokens | Tokens before first paint | First-try clean | Complete |
|---|---|---|---|---|---|
| r1-table | 5,534 | 206 | 135 | 3/3 | 3/3 |
| r2-revenue | 5,534 | 179 | 94 | 3/3 | 3/3 |
| r3-contact | 5,534 | 274 | 48 | 3/3 | 3/3 |
| r4-analytics | 5,534 | 989 | 553 | 3/3 | 3/3 |
| r5-pricing | 5,534 | 826 | 178 | 2/3 | 3/3 |
| r6-settings | 5,534 | 325 | 34 | 3/3 | 3/3 |
| r7-claims-pasted | 5,534 | 2,646 | 2,269 | 3/3 | 3/3 |
| r7-claims-ref | 5,534 | 393 | 35 | 3/3 | 3/3 |

Where the output tokens go, over all 24 answers: data 52%, structure 25%, visible words 16%, formulas 8%. (The earlier measurement, on a different set of eight screens, was 61%, 26%, 7% and 6%.)

The claims review with its data pasted needs about 2,300 tokens before anything is drawn, because the data comes first; by reference it needs 35.

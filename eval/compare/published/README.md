# Published comparison runs

Raw results of SayShape against HTML, kept so the figures quoted from them can be checked. Each folder is one run of `npm run compare`: the same requests answered in SayShape and as HTML by one model, first try with no repair, scored the same way.

| Run | Model | Answers |
|---|---|---|
| [`2026-11-05-gpt-4.1`](2026-11-05-gpt-4.1/SUMMARY.md) | openai/gpt-4.1 | 26 requests × 3 runs × 2 formats = 156 |
| [`2026-11-05-gpt-5.6-luna`](2026-11-05-gpt-5.6-luna/SUMMARY.md) | openai/gpt-5.6-luna | 26 requests × 3 runs × 2 formats = 156 |

In each folder:

- `SUMMARY.md`: the headline table.
- `results-merged.json`: one record per answer.

Fields of a record that the summaries are worked out from:

| Field | Meaning |
|---|---|
| `task`, `category`, `format`, `run` | Which request (`eval/compare/tasks.ts`), `sayshape` or `html`, and which of the three runs |
| `output`, `raw` | What the model wrote, cleaned and as it arrived |
| `success` | Every check for the request passed: what's shown, and what happens when it's used (`checks` lists each one) |
| `totalMs`, `firstTokenMs` | Time to the finished answer and to its first token |
| `usage` | Prompt, completion and cached tokens as the provider reported them |
| `cost` | Dollars for the answer at the prices in `SUMMARY.md`, with the SayShape guide read from the prompt cache |
| `code.fixedColors`, `code.htmlInserts` | Hard-coded colors, and places HTML is built from strings (`innerHTML` and the like) |

"No caching" costs in the summaries are prompt and completion tokens at the full prices. Medians are over the 78 answers per format.

These are the project's own measurements of its own format. New runs go to `eval/compare/results/`, which is not tracked; copy a run here when a published figure depends on it.

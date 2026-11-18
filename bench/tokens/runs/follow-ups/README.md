# Follow-ups: edits against full rewrites

The ten follow-ups in `bench/tokens/requests.ts`, each made to `runs/compact/r7-claims-ref__1.ss` (478 tokens), answered twice by fresh Sonnet subagents: once with today's refine prompt (`prompts/full-NN.txt`, a whole new spec) and once with `edits: true` (`prompts/edit-NN.txt`, from `refineEditMessages`). Both read the compact guide first. One run each. `results.json` has the scores; `score.ts.txt` is the script that made them (it needs this branch and the benchmark harness from #227, so it's kept as text).

Each edit answer is parsed and applied with `parseEdits`/`applyEdits`, checked for new errors with the parser (the rule `generateSpec` uses to fall back), and both answers are checked for whether the change was really made. Tokens: o200k_base.

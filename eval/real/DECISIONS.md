# Decisions taken while the run was unattended

- Branch was cut from main, not develop (develop is 781 commits behind and lacks the imported files); PR targets main.
- DeepSeek V4.1 Flash is pinned to Particle AI (no first-party endpoint listed): marked third-party, cache figures not comparable.
- Luna adaptive low-subs-kpi came back empty after cleaning: treated as a real result; added the "no screen" outcome with the raw reply saved beside it.
- Answers are appended to answers.jsonl as they complete (partial.json holds the run record so far); `npm run real -- --report <dir>` rebuilds from them when results.json is missing.
- Request temperature: the runner never sets one, so src/model/stream.ts sends its default 0.2 on every call (both formats, all models). The plan said no override; kept as is, same for all.
- Scorer fault found: an "add" check types into the nth text field, and a SayShape answer using a stepper or slider has none. Added ScreenEnv.numberControls (real benchmark only; eval/compare's own behavior is unchanged): steppers are pressed up or down and sliders dragged to the typed number within min and max, in screen order with inputs; in HTML, range inputs now count and number and range values are clamped to their min and max. `npm run real -- --rescore <dir>` scores the saved answers again into <dir>-rescored; the original folder is kept. The main run keeps its first scoring.
- Run stopped by hand at 68 Luna answers (Haiku, Sol, Gemini, DeepSeek and Sonnet had finished; spent $9.36 of $20). Luna ran its first pass only (about 47 s a request overall, over 100 s at the extreme level), and its extreme level is incomplete: 12 of 24 answers. The report leaves it out of every extreme-level table and total (generic rule: a model that did not finish a level is left out of that level).
- Haiku ran three times (240 answers); the run-to-run spread uses Haiku only.
- Hard and extreme checks repaired by an Opus agent after the first scoring (they relied on row ids and one exact button name); all saved answers re-scored, the first scoring kept beside the second.

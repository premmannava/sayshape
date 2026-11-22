# Decisions taken while the run was unattended

- Branch was cut from main, not develop (develop is 781 commits behind and lacks the imported files); PR targets main.
- DeepSeek V4.1 Flash is pinned to Particle AI (no first-party endpoint listed): marked third-party, cache figures not comparable.
- Luna adaptive low-subs-kpi came back empty after cleaning: treated as a real result; added the "no screen" outcome with the raw reply saved beside it.
- Answers are appended to answers.jsonl as they complete (partial.json holds the run record so far); `npm run real -- --report <dir>` rebuilds from them when results.json is missing.

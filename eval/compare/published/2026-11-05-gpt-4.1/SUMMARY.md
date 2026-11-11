# SayShape vs HTML on GPT-4.1 (2026-11-05)

26 business requests (KPIs, charts, tables, forms, calculators, dashboards, security) × 3 runs × 2 formats = 156 answers.
Model: openai/gpt-4.1 via OpenRouter ($2 in / $8 out per million tokens, $0.50 per million cached input). First try, no repair. SayShape guide marked for prompt caching.

| | SayShape | HTML |
|---|---|---|
| Median time to finished screen | **1.55 s** | 7.25 s |
| p90 time | 2.99 s | 12.51 s |
| Median output tokens | **149** | 1,205 |
| Median input tokens | 11,123 (language guide) | 168 |
| Avg cost per answer, guide cached | **$0.0081** | $0.0108 |
| Avg cost per answer, no caching | $0.0239 | **$0.0108** |
| Works on first try | 87% (68/78) | **96% (75/78)** |
| Cost per working answer, cached | **$0.0093** | $0.0113 |
| Answers with hard-coded colors | 0 | 78 of 78 |
| Answers inserting HTML strings (innerHTML etc.) | 0 | 26 of 78 |
| Hostile-input security tasks passed | 6/6 | 6/6 |

SayShape misses: t3 (3/3, `derive` indented inside an `if` block was silently ignored, no diagnostic), x3 (2/3), d1 (2/3), k4 (2/3), d4 (1/3).
Raw data: results-merged.json; per-batch reports in batches/.

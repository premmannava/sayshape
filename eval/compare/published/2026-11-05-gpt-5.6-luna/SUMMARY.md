# SayShape vs HTML on GPT-5.6 Luna (2026-11-05)

26 business requests × 3 runs × 2 formats = 156 answers, first try, no repair. openai/gpt-5.6-luna via OpenRouter ($0.20 in / $1.20 out per million tokens). SayShape guide marked for prompt caching. Batches ran in parallel.

| | SayShape | HTML |
|---|---|---|
| Median time to finished screen | **3.6 s** | 11.8 s |
| p90 time | 8.0 s | 21.1 s |
| Median output tokens | **280** | 1,696 |
| Works on first try | 97% (76/78) | 99% (77/78) |
| Avg cost per answer, cached | **$0.00069** | $0.00218 |
| Avg cost per answer, no caching | $0.00265 | $0.00218 |
| Hard-coded colors | 0 | 76 of 78 |
| Unsafe HTML insertion | 0 | 20 of 78 |
| Security tasks | 6/6 | 6/6 |

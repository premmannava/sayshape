# Report preset runs

Answers written with the report guide (`guide.txt`, `mode: "report"`, 491 tokens) by fresh Sonnet subagents: three per request for 1, 2, 4 and 7 (both ways), and one each for 3, 5 and 6 to check that requests a report can't show come back as `FULL`. Scored with presets on (the harness from #227 with `presets: true` in `draw`; scoring them on main without this branch reports `report` as an unknown element).

`r4-analytics__3.ss`: that writer replied with its answer instead of writing the file; its reply is recorded verbatim. It declares no data, so its charts are empty and it fails "every chart and table shows data".

`screens/`: run 1 of each request drawn in Chrome at 600 px, the compact-guide answer on the left and the report on the right.

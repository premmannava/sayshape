# Visual upgrade: validation

The design defaults were judged on two ordinary specs in `visual/cases.ts`: `review-dashboard` (a title with filters, four KPIs, a three-series line chart with a target and a note, a ranking, a bar chart, a sortable table and buttons) and `review-dense` (45-point lines and bars, long series and category names, a donut). `npx tsx scripts/review-shots.ts <dir>` captures both at 360, 600 and 1200 px in light and dark, at 2× pixel density.

## What the baseline showed

- Series 2 to 6 (steel, sage, stone, blue, moss) were hard to tell apart: in a three-line chart, Retail and Partner read as the same line. The closest pair was 10 apart in RGB.
- `chart-rule` drew in full ink at 1.5 px, heavier than the data, and its label plate could sit on the chart's own line (it only avoided `chart-line` layers).
- Two-series line charts filled down to an axis that doesn't start at 0, which exaggerates the gaps between values.
- Curves through dense points (45 days at 600 px) read as wiggles.
- A row of stats was centered, so a stat with a sparkline pushed its neighbours' labels down.
- Money columns and chart tooltips always showed cents ($48,200.00), and the donut legend mixed $151K with $87,000.
- On a phone, text columns shrank to 72 px, leaving "Ac…" and "Ow…" instead of scrolling.

## What changed

- New series palette (accent, amber, blue, rose, violet, slate) in light and dark; every pair is at least 40 apart in RGB (`test/theme.test.ts`), and all still meet the AA checks in `test/a11y/beyond.test.ts`. Pie slices soften the same colors.
- `chart-rule` and `chart-note`: muted, 1.25 px, labels in muted on the card's color, and labels avoid the chart's own lines.
- Line washes only for a single series on a scale that includes 0, filled to 0.
- Points closer than 14 px (`DENSE_POINT_GAP`) are joined straight; the shape-preserving curve is kept otherwise.
- A row of only stats is top-aligned.
- Money: cents only when an amount in the column (or the tooltip value) has them; the donut legend uses one style for all slices.
- Text columns shrink to 96 px before the table scrolls sideways.
- The model guides and the MCP quick start ask for a title with filters under it, 3–4 KPIs, one main chart and supporting detail, and no cards inside cards.

## Checked

- Screenshots before and after: `docs/plans/visual-upgrade/` (pairs), plus hover, sorting, row selection, the period switch and the open filter in a real browser.
- `npm run typecheck`, `npm test` (116 files), `npm run build`, `npm run docs:check`, `npm --prefix mcp test`.
- `vitest bench bench/engine.bench.ts` before and after: within run-to-run noise.

## Not done

- A `select` in a row takes its full share of the width, so a filter next to a segmented control can be wide on desktop.
- Visual regression baselines need regenerating on Linux (`update-visual-baselines` label).

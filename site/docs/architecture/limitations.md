---
title: Status and limits
description: What SayShape can and can't do today, its built-in limits, and what's planned.
---

# Status and limits

SayShape is an **early prototype, version 0.1**. This page separates what's built from what's planned. If something isn't listed as built, assume it isn't.

## Built

- The engine: parser, expressions, actions, layout, painting, hit testing, keyboard focus (including parts of elements), popups and the inspector.
- 56 elements ([reference](../components/)): layout, content (including callout and tiles for cards, seats and keys), data (stat with a change and sparkline, rating, details for one record, charts: multi-series bar, horizontal bar and line, stacked bars, area, pie, donut, funnel, waterfall, bullet and heatmap, meters as a ring or a gauge, tables with sorting and selection, schedules of shifts, bookings and Gantt-style plans, boards of cards by stage, trees (lists that open and close, and org charts), flows laid out automatically, the world map), input (buttons, checks, switches, radios, select, date picker, stepper, slider, text input), navigation (screens, tabs, breadcrumb, pagination) and feedback (progress, skeleton, empty).
- State with lists and records, host data, `each` with keys and nesting, `bind=` and actions on paths, `add`, `remove` and `clear`, `if` blocks, `derive` lines, list and formatting functions, screens with `go:` and `back`, `notify:` messages, and images from allowed hosts.
- The model guide (full and compact, with profiles), `sayshape/model` (streaming, cleaning, checking, one repair, bounded refinement), an evaluation script, and `sayshape/testing`.
- Accessibility: a hidden mirror of the canvas for screen readers, keyboard focus that follows it, chart and map text alternatives, contrast, high-contrast mode and reduced motion ([Accessibility](./accessibility)).
- Unit, contract, streaming, fuzz and visual tests, benchmarks, a component scaffold and CI.

## Not built yet

- **Data sources and host commands.** Your app fetches data and sets state; a spec can't declare where data comes from.
- **Multi-line text and form validation** (required fields, email format). A spec can show a hint with `if=` for now.
- **Scrolling regions and overlays.** No scrolling areas inside a screen, and no dialogs, menus or tooltips. The popup layer only serves a component's own popup.
- **Typing to search** in a select, and option groups. (A select picks several with `multiple=true`.)
- **Larger tables**: more than 200 rows, vertical scrolling, sticky headers, editable cells, multi-row selection. (Wide tables already scroll sideways.)
- **More charts**: series from different lists, time or numeric axes.
- **Dates and times beyond the basics**: time zones, recurring events, blocks past midnight, other locales. (A date picker picks a range with `range=true`; `schedule` lays out times and dates.)
- **Packaging**: an npm release and a production model server.

## Built-in limits

| Limit | Value |
|---|---|
| Nesting depth | 100 levels; deeper lines are an error and skipped |
| Derived values per spec | 200 |
| Items per `each` | 500 |
| Repeated elements per screen | 10,000 |
| Data literals | 20 levels deep, 10,000 values |
| Data from the app (`state.set`) | 20 levels deep, 1,000,000 values (each row and field counts) |
| `select` options | 200, eight shown at once |
| `table` | 200 rows and 64 columns; a message instead of more. Columns that don't fit scroll sideways |
| `chart` | 200 items, 6 series, 6 pie or donut slices (the rest summed into Other) |

Numbers, money and dates are formatted in US English. Weeks start on Sunday.

## Claims this site doesn't make

SayShape hasn't been benchmarked against other UI approaches, so nothing here says it's faster or uses fewer tokens. The engine's own timings are shown in the playground for the spec you're looking at. Model quality varies by model; measure yours with `npm run eval`.

## Roadmap

The phase plan is in [`docs/PLAN.md`](https://github.com/premmannava/sayshape/blob/main/docs/PLAN.md) in the repository: scrolling and dialogs next, then the model server and an app built on top.

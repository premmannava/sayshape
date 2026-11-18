# Adaptive guides (opt-in)

The default guide tells a model about every element: about 20,000 tokens. Most answers use a few of them. Adaptive guides give the model a small map of the language first, and then a guide for just the building blocks a screen needs, asked for together in one step. A common report is written from the map alone.

People still ask in their own words. Nobody names a capability, a profile or a difficulty: the model that answers the request does the choosing, from the map. There is no classifier, router or extra service. With adaptive guides off (the default), every guide, tool and result is exactly what it was.

The code is in `src/capabilities.ts` (the map and the assembler), `src/model/adaptive.ts` (`generateAdaptive`) and `mcp/src/server.ts` (`--adaptive-guides`).

## The pieces

**The map** (`languageMap`): how the language fits together (state holds values, `derive` works values out, controls write state with `bind=`, `on=` actions change it or tell the app with `emit`, `each` repeats, a scene draws from state and the time `t`, `every` rules change state on a timer), the capabilities this app offers with one line on when to use each, every element's name by category, and the report syntax where reports are drawn. About 1,000 tokens.

**Capabilities** are building blocks that combine: `report`, `lists`, `calculations`, `forms`, `actions`, `layout`, `content`, `data`, `navigation`, `feedback`, and, where the app turns them on, `scenes`, `behavior`, `look`, `motion` and `pictures`. `full` is the whole compatible guide. They aren't app types: a budget screen is `lists`, `calculations` and `forms` together. The list, with when to use each, is `CAPABILITIES` in `src/capabilities.ts`.

**The assembler** (`assembleGuide`) takes capabilities and element names together and returns one guide: the shared rules once (format, expressions, actions, rules), the syntax of every element involved, full docs with an example for elements named on their own, and one worked example per capability where it teaches how the parts interact. Everything comes from the registry and `src/prompt.ts`: capabilities hold only which categories, elements, sections and examples they bring. An element registered tomorrow joins its category's capability with no change (`test/capabilities.test.ts` checks that no element can be missed).

- It follows the app: `scenes` only with the scene elements registered, `behavior` only with `behavior: true` (otherwise `drag=` is left out of every guide), `report` only with `presets: true`.
- An example is shown only if the guide's own elements can build it, so no control is added just to keep an example.
- Names are matched case-blind and in any order, and a singular or plural of a capability is that capability (`form` is `forms`) unless it's an element's own name (`list` is the element, `lists` the capability). The same set always gives the same text, so prompts and token counts are stable.
- A name that can't be used comes back in `problems`, with a message saying why and what to ask for instead (`"scenes" isn't available here: this app doesn't draw scenes. Ask for data or content instead.`).
- A capability brings what its guide relies on: `behavior` brings `button` (its guide says to add a Pause button), `scenes` brings `each` (a scene repeats shapes with `each items={range(n)}`).

## Old and new paths

| | Today | Adaptive guides |
|---|---|---|
| SDK, default | Full guide (~20,750 tokens), one call | Unchanged |
| SDK, the app knows what it builds | Full or compact guide, or a profile | `capabilities: [...]`: one call with their guide (~450 to ~4,000 tokens) |
| SDK, open-ended request | `generateReport`: report guide first, then the compact guide if the answer is `FULL` (two calls for anything but a report) | `generateAdaptive`: the map first. A report is answered there (one call). Otherwise the model answers `USE: forms, calculations`, then writes with that guide (two calls, the first answer one line) |
| MCP, first turn | Quick start in `show_interface` (syntax, element names, picks); a report isn't available | The map in `show_interface`, with the report syntax: a report needs no docs call |
| MCP, anything else | `sayshape_docs` with element names (one call, or more as the model finds it needs more) | `sayshape_docs` once with capabilities and elements together |

## In sayshape/model

The app knows what the screen needs: one call.

```ts
import { coreComponents, Registry } from "sayshape";
import { generateAdaptive } from "sayshape/model";

const r = await generateAdaptive({
  config: { url: "https://api.example.com/v1", model: "my-model", apiKey },
  registry: new Registry(coreComponents),
  request: "A sign-up form that checks the email before it can be sent",
  capabilities: ["forms"],
  guide: { actions: [{ name: "signup", value: "the email", description: "Create the account" }] },
});
// r.route: { kind: "known", chosenBy: "app", capabilities: ["forms"], calls: 1, ... }
```

An open-ended request: leave out `capabilities`. With `presets: true` (and the engine drawing with `presets: true`) a report comes back from the first call; anything else takes two calls, and `r.route` says what the model chose (`chosenBy: "model"`), what it asked for that couldn't be used, and how many calls it took. `r.usage` adds up every call.

The guide on its own, for apps that call their model themselves: `assembleGuide(registry, ["lists", "calculations", "forms"], options).text`, `languageMap(registry, options)`, or `languageGuide(registry, { capabilities: [...] })` (also what `generateSpec({ guide: { capabilities: [...] } })` sends). When a narrow guide isn't enough, `["full"]` or `fullGuide()` is the default guide, byte for byte.

## In the MCP server

```bash
npx sayshape-mcp --adaptive-guides
```

```json
{ "mcpServers": { "sayshape": { "command": "npx", "args": ["-y", "sayshape-mcp", "--adaptive-guides"] } } }
```

`show_interface`'s description then carries the map in place of the quick start, and `sayshape_docs` takes capabilities in `topics` and element names in `elements`, in one call: `{ "topics": ["forms", "calculations"], "elements": ["slider"] }`. Names it can't use come back under NOT INCLUDED with what to ask for instead, and nothing usable returns the map, never the whole guide by accident; `"full"` still gives it. The other topics (`expressions`, `rules`, `examples`, `chat`, `database`, `datasets`) work as before.

Reports are read with presets and drawn by the view (the flag also sets the view's `presets`) and by `--widget-dir` files, both with this server's own engine. The CDN page for text-only clients loads a pinned older engine (`PAGE_ENGINE_VERSION`, 0.1.1) that can't expand reports, so those clients aren't offered reports and a report sent there is a problem to fix rather than a page that can't draw it. `mcp/scripts/e2e-report.mjs` checks all three in Chromium.

## A chart line that draws nothing

A report part that makes nothing is now an error on its own line (`This line chart isn't shown: siteVisits has no field "visitors". Its fields: week, sessions`), so a screen missing what was asked for is never reported as complete: `generateSpec` repairs it, and `show_interface` says part of the interface is missing.

The case seen with Haiku, `line siteVisits week sessions` on `report … data=siteVisits`, named the report's own list first, the way the guide's example names another list (`line targets month goal actual`). It was read as the chart's x field, which the rows don't have, so the chart was dropped with a warning and the rest of the report looked complete. The report's own list named first now means its rows, and that chart draws (`test/presets.test.ts`). Valid reports are unchanged.

## Not in the language yet: sharing a report's filter

A report's filters are state of its own (`reportRegion`, built by the expansion) that nothing outside the report is told about, so an input or a total elsewhere on the screen can't follow them. Guides that offer `report` with other capabilities say so, and a screen like "a budget that follows a category filter" is written from `lists`, `calculations` and `forms` instead (`test/capabilities.test.ts`, "a mixed screen"). Letting a report name its filter state (`filter=region as=picked`), so other elements can read it, would be a change to the preset, left for its own pull request.

## What's measured, and how

Three kinds of evidence, kept apart:

- **Deterministic tests** establish assembly, routing mechanics, diagnostics and rendered behavior: `test/capabilities.test.ts` (the map, coverage, assembly, what each host offers, and four screens used through `render()`: a sales report whose filter and host data change, a form that can't be sent while invalid, a budget whose total reads the filtered rows, and a draggable scene that pauses), `test/model-adaptive.test.ts` (calls and routes against a scripted model), `mcp/test/adaptive-guides.test.ts`, and `mcp/scripts/e2e-report.mjs` in a browser.
- **Token counts** of the real guides and of everything the MCP server advertises: `npm run adaptive:size` (o200k_base from gpt-tokenizer, not Claude's tokenizer: compare ratios). Its routes are chosen by hand, one plausible docs call per request on each path: they measure sizes, not what a model would do.
- **Live model runs** are the only evidence of what a model chooses on its own, how many calls it makes and how long it takes: `npm run adaptive:smoke` (below).

Sizes at the time of writing (`npm run adaptive:size`, o200k_base, hand-chosen routes):

| Request | SDK: full guide | SDK: capabilities known | MCP today: read before writing / summed over calls | MCP adaptive: read before writing / summed |
|---|---:|---:|---:|---:|
| Sales report (filter, chart, total) | 20,754 | 453 | 4,766 / 6,568 (2 calls) | 1,647 / 1,647 (1 call) |
| Sign-up form (validation, emit) | 20,754 | 1,796 | 2,440 / 4,242 | 3,414 / 5,061 |
| Budget with a filtered total | 20,754 | 3,945 | 4,502 / 6,304 | 5,563 / 7,210 |
| Draggable, pausable scene | 25,620 (with behavior) | 3,962 | 6,929 / 8,897 | 5,659 / 7,385 |

The whole advertised tool surface is smaller with the flag (1,647 against 1,802 tokens). Reports gain the most: one call instead of two, a quarter of the input. For a small form or a mixed screen the MCP server's current path reads less, because today's docs call returns only the named elements and leans on the quick start, while the adaptive guide brings every form control, the rules and a worked example in one go. For sayshape/model, every case is far below the full default guide.

### The live smoke test

With your own Claude Code login (no API key), after building the MCP server:

```bash
npm ci && npm ci --prefix mcp && npm --prefix mcp run build
npm run adaptive:smoke -- --model haiku
```

Each of two requests in plain words (a sales report with a filter and a total; a ball that moves by itself, can be dragged and paused) runs through `claude -p` with only this server's two tools, once as the server is and once with `--adaptive-guides`, same model and flags otherwise. It prints model calls, tool calls with what `sayshape_docs` was asked for, input, cache and output tokens as Claude Code reports them (its own system prompt is in both), wall-clock time and whether the result works when used (`checkOutcome` in `eval/adaptive/smoke.ts`), and keeps the raw streams in a temporary folder. The runs have no Task tool, so no subagent usage can be mixed in. `--runs 3` repeats each pair; `--only report` runs one request.

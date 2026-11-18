# SayShape: brief for AI assistants

Read this before changing anything in this repository. It explains what SayShape is, the rules that keep it working, and how to make changes safely. The phase plan is in [`docs/PLAN.md`](docs/PLAN.md); [`README.md`](README.md) is a one-page introduction, and the reference it used to hold is in `docs/`: [`language.md`](docs/language.md), [`components.md`](docs/components.md) (generated), [`engine.md`](docs/engine.md), [`model.md`](docs/model.md), [`development.md`](docs/development.md) and [`limitations.md`](docs/limitations.md). The long detail on what's built is in [`docs/internals.md`](docs/internals.md): the full scenes, behavior, accessibility and MCP rows of the table below, the status of every component, and the limits. Read the part for the area you're changing, and keep it up to date there. Keep the README short: new reference material goes in those files.

## What SayShape is

SayShape is two things that are designed together:

1. **A UI language for AI models to write.** It is line-based (one element per line, indentation for nesting), so a model's streamed output renders line by line. It can't run code, and it never contains colors, fonts or pixel sizes.
2. **An engine that renders that language entirely on its own.** It has its own parser, layout, painter and input handling, and draws onto a single `<canvas>`. It does not use HTML elements, CSS layout, React or any UI framework.

The goal is **generative UI**: a model produces an interface at runtime, in response to a user, and the engine renders it safely, consistently and fast. SayShape is not trying to replace React for human-built apps. It is trying to be the layer the model speaks.

```
state days=2 hikers=3
card
  text "Yosemite weekend" style=title
  row
    stat label="Days" value={days}
    stat label="Water (L)" value={days * hikers * 3}
  button "Add day" on=inc:days
```

## How it works

```
spec text → parse → tree → layout → boxes → paint → canvas pixels
                               ↑                       │
             state ←── actions ←── pointer / keyboard ─┘
```

| Stage | File | Notes |
|---|---|---|
| Parse | `src/parser.ts` | Text → `SayShapeNode` tree plus line-numbered `Diagnostic`s. Validates against component definitions. |
| Derived values | `src/state.ts`, `src/parser.ts` | `derive total={…}` lines: parsed and checked (duplicates, state collisions, cycles, writes) into `ParseResult.derived`; `Store` works them out lazily through `evaluate`, caches each until something it reads changes, and refuses writes (`DerivedWriteError`). |
| Expressions | `src/expr.ts` | Own tokenizer, parser and evaluator for `{…}`. Whitelisted functions only. |
| Actions | `src/actions.ts` | `on=` strings: `inc`, `dec`, `toggle`, `set`, `emit`, `go`, `back`, `notify`, `add`, `remove`, `clear`, chained with `;`. |
| Data | `src/data.ts` | Lists and records: frozen, null-prototype values; host data copied in (`toData`); `readField` is the only way expressions reach inside them. |
| Lists | `src/each.ts` | `each` copies: per-copy scope (`scopeOf`) and where each item lives in state, for writing (`locateOf`). |
| Paths | `src/paths.ts` | Writing to `t.done` or `settings.theme`: `placeOf`, and `setIn`, which never changes data in place. |
| Layout | `src/layout.ts` | Headless: needs only a `TextMeasurer`. Produces `Box` trees. `shownChildren` drops hidden children and replaces `each` and `if` blocks with what they stand for. |
| Engine | `src/engine.ts` | `SayShape` class: dirty-stage pipeline, canvas sizing, paint, hit testing, pointer and keyboard. |
| Components | `src/components/` | One `ComponentDef` per component. `map/` is a separate entry point. |
| Scenes (experimental) | `src/components/scene/` | Opt-in entry point `sayshape/scene` (`sceneComponents`): off unless a host registers them. A scene lays out as one box and draws its shape lines itself each frame, in the spec's own colors; shapes with `on=` are pressable, and `reviewScenes` checks a drawing. Before changing it, read its full row in [`docs/internals.md`](docs/internals.md). |
| Devices (experimental) | `src/components/device/` | Opt-in entry point `sayshape/device` (`deviceComponents`), not in `coreComponents`: off unless a host registers it. `device kind=iphone\|android\|laptop scale= status=` lays its children out at the device's fixed logical screen size (`DEVICE_SIZES`, engine constants) and draws them scaled through `childTransform`, like a slide, inside a plain frame in theme colors. Before changing it, read its full row in [`docs/internals.md`](docs/internals.md). |
| Slides | `src/components/slides/` | `deck` and `slide`, ordinary components in `coreComponents` (`index.ts` also exports `slideComponents` for the `sayshape/slides` entry point). `slide.ts` lays its title and children out at `DESIGN_W` × `DESIGN_H` with `slideTheme`/`slideTokens` (`theme.ts`: the theme's `slide` tokens, or its own scaled by 1.6) and returns the scale as `childTransform`, so the engine paints, hit-tests and reads children through it; the contract tests leave slides out of the text-fit check, which can't follow a transform. `deck.ts` shows one slide with arrows, dots, keys and a swipe. Tests `test/slides.test.ts`, `mcp/test/slides.test.ts`; the MCP view saves a deck as PDF or PowerPoint (`mcp/src/ui/deck-file.ts`) and `--logo` puts a logo on every slide. |
| Behavior (experimental) | `src/behavior.ts`, `src/drag-axis.ts`, `src/math.ts`, `src/components/scene/drag.ts` | Off unless a host passes `behavior: true`: `every` rules that write state on a timer (`RuleRunner`), and scene `drag=true`. Before changing it, read its full row in [`docs/internals.md`](docs/internals.md). |
| Look | `src/look.ts` | The `look mood= type= shape= density=` line, first in a spec: named options that `applyLook` turns into tokens scaled from the host's own theme (never colors, fonts or sizes of the spec's own; fonts from a fixed list with system fallbacks). Hosts turn it off with `look: false`; the guide explains it only with `GuideOptions.look`. Before changing it, read its full row in [`docs/internals.md`](docs/internals.md). |
| Motion | `src/motion.ts` | `enter=fade\|rise\|scale` on any element with a box (`ComponentDef.noBox` marks those without), `stagger=true` on containers; the engine sets every timing and paints only (positions, hits and the accessibility tree stay final). Plays once, on first sight. `motionOn()` is the one switch: `animate: false` or reduced motion (which wins over `animate: true`) stills it, and fades and tweens with it. `ctx.progress()` for a component's own eased motion; `ui.entrance(query)` in tests. Guide section only with `GuideOptions.motion`. Before changing it, read its full row in [`docs/internals.md`](docs/internals.md). |
| Pictures | `src/scrim.ts`, `src/components/media.ts` | Elements indented under `image` are laid over the photo, on a scrim the engine works out so text holds AA (4.5:1, checked at 4.55) over any photo, full strength behind the content and fading lighter above and below it (`overImageTheme`, `scrimAlpha`, `scrimProfile`, through `ComponentDef.theme`); `shape=rounded\|square\|circle`, `zoom=slow`. Kept out of the default guide (`ComponentDef.quiet`) until `GuideOptions.pictures`. Read the image entry in [`docs/internals.md`](docs/internals.md) before changing it. |
| Contract | `src/component.ts` | `ComponentDef`, `PropDef`, contexts, and `PropReader` for typed prop access. |
| Loading | `src/loading.ts`, `src/ghost.ts` | `setLoading(names)` / `setAwaiting(on)`: elements reading data on its way (directly or through derive) draw `paintLoading` placeholders (`paintGhost`: theme `line` tint with a sweep), or a generic one for leaves; `ctx.reveal(node)` drives the draw-in once it arrives. |
| Icons | `src/icons.ts` | SayShape's own outline icons, designed from scratch (never copied or traced from another set): a few drawing commands each on a 24×24 grid; `drawIcon` paints one in a theme color with a ~2px stroke at any size; `ICON_ALIASES` names (e.g. `plant-2`) are accepted and drawn as their icon, while the guide lists only `ICON_NAMES`. Add new ones the same way, as simple universal symbols. |
| Popups | `src/popup.ts` | One popup at a time (a select's list, a date picker's calendar): `ComponentDef.popup` measures and paints it; the engine places it in the visible area, paints it last, hit-tests it first, swallows outside presses, routes keys to it and closes it when its owner goes. Its highlight and scroll live in engine-held `PopupState`, never app state. |
| Accessibility | `src/a11y/` | What the screen is to a screen reader: `ComponentDef.semantics` gives an element's role, name and state, `buildAccessibilityTree` gathers them after paint, and in browsers an invisible DOM mirror presents them. The same tree gives `SayShape.copyText()`. Before changing it, read its full row in [`docs/internals.md`](docs/internals.md). |
| Debugging | `src/inspector.ts` | Layout/hit overlays, inspect mode, frame capture. |
| Model guide | `src/prompt.ts` | `languageGuide(registry, opts)` builds the system prompt from component definitions: `mode: "full"` (default) or `"compact"`, and a `profile`. Both list the exposed elements' `picks` (`pickList`: which element for which kind of answer), as does the MCP quick start. Full mode with no profile must stay byte-identical to `test/fixtures/guide-full.txt` unless a change is meant (then update the fixture). |
| Presets (opt-in) | `src/presets/report.ts` | `report`: one high-level element for data answers (title, `data=`, `filter=`, then figure, chart and table lines). `expandPresets` turns it into ordinary SayShape text before the parser reads the spec (parse `presets`/`presetValue`, engine and `render()` `presets`), so nothing new is drawn; node ids, state, derived and diagnostic lines are mapped back to the spec's lines, `ParseResult.presets`/`SayShape.expandedSpec` show the expansion, and host data a report reads re-reads the spec. Labels, titles, headers and formats come from field names and known values. The guide's report mode (`mode: "report"`, ~490 tokens) is built from `reportGuide()` and `REPORT_EXAMPLE` there, the one place the preset is described, and tells the model to answer `REPORT_FALLBACK` alone for anything else; `generateReport` (`src/model/report.ts`) then asks again with the compact guide. A part line that makes nothing is an error on its line; the report's own list named first means its rows. Tests `test/presets.test.ts`. |
| Capabilities (opt-in) | `src/capabilities.ts`, `src/model/adaptive.ts` | Adaptive guides: `languageMap` (how the pieces connect, the capabilities this host offers, every element's name, the report syntax where `presets` is on) and `assembleGuide` (one guide for several capabilities and elements, built from the registry and prompt.ts's sections and worked examples; problems for names it can't use). `GuideOptions.capabilities`/`presets` route `languageGuide` to it; `generateAdaptive` in sayshape/model; `--adaptive-guides` in the MCP server. Capabilities hold only categories, elements, sections and examples, never syntax: `test/capabilities.test.ts` fails if a registered element belongs to none. See [`docs/capabilities.md`](docs/capabilities.md). |
| Profiles | `src/profiles.ts` | Which elements the model is told about. Separate from the renderer's registry and from validation (`enforceProfile`). |
| Theme | `src/theme.ts` | Design tokens; light and dark; `--sayshape-*` CSS overrides. In a forced-colors mode (Windows Contrast Themes) the engine draws with `forcedColorsTheme`, the person's system colors, whatever theme was chosen; `test/a11y/beyond.test.ts` checks text, focus and series tokens meet WCAG AA contrast. |
| Testing | `src/testing/` | `sayshape/testing`: `render()` runs the real engine in Node against a recording canvas. |
| Model | `src/model/` | `sayshape/model`: streams a spec from an OpenAI-compatible endpoint, removes thinking and fences, checks it and repairs it once. `context.ts`: bounded refinement (`refine`) and usage totals (unknown stays `undefined`, never 0). `edits.ts` (opt-in `GenerateOptions.edits`): follow-ups as line edits (`@replace`, `@insert`, `@delete`) with a whole-rewrite fallback, see `docs/model.md`. `ModelConfig.cache` marks the guide for prompt caching (`cache_control`); usage records `cachedTokens` and `cacheWriteTokens`. |
| Evaluation | `eval/`, `scripts/eval.ts`, `scripts/pick-eval.ts` | 60 requests scored against a real model (`npm run eval`); `--guide full,compact`, `--profile`, `--repair-guide` compare prompting variants. `npm run guide:size` measures the guide. `npm run pick-eval`: 67 requests (`eval/picks.ts`) graded on whether the model picks the representation that shows the data best (best, ok, poor, never; parts for multi-part requests; traps), plus whether each answer parses and draws cleanly; `--prompts` writes a kit for running models by hand and `--answers` scores what comes back. `npm run colors-eval` (`eval/colors/`, `scripts/colors-eval.ts`): do models keep the colors a person named? Multi-turn conversations with tool calls where the model has the real `show_interface` and `sayshape_docs` tools and gets the real results (the MCP server in memory, as a client that draws views; needs `npm install --prefix mcp`); scores each call's `colors` argument (conversation A: named once, then three interfaces without them, then back to normal; B: none asked for, none should be sent); `--note-variant`/`--description-variant` swap the wording the model sees for an A/B run (the server's text is never changed); `--stub` runs a scripted model; tests `test/colors-eval.test.ts` and `mcp/test/colors-eval.test.ts`. |
| Comparison | `eval/compare/`, `scripts/compare.ts` | `npm run compare`: 30 requests answered in SayShape and as HTML by each model, scored the same way (SayShape through `render()`, HTML in jsdom) on what's shown and what happens when used; `reference.ts` has a working answer to each in both formats, and `test/compare.test.ts` checks every one passes. `scripts/record.ts` records one request answered three ways at once (SayShape, HTML, and A2UI v0.9 from A2UI's own schemas in `eval/compare/a2ui.ts`) with each piece's arrival time, for the site's `/compare` page (`Compare.vue`), which replays them with the engine, a sandboxed iframe and A2UI's Lit renderer. |
| MCP server | `mcp/` | Its own package (`sayshape-mcp`, with its own dependencies): an MCP Apps server with `show_interface` and `sayshape_docs` (its topics include `look`, `motion` and `pictures`, from the guide's own generators, for clients drawing with this server's engine; the quick start only names them), and a one-file view (`mcp/src/ui`) that runs the engine inside chat apps; text-only clients get an HTML page or a widget file instead. Bundles `../src`. `npm --prefix mcp test`, `npm --prefix mcp run test:e2e`. Before changing it, read its full row in [`docs/internals.md`](docs/internals.md). |

Each stage reruns only when its inputs change: `invalidate("parse" | "layout" | "paint")`. A spec edit re-parses, a state change re-lays out, and hover only repaints.

## Rules that must not be broken

These are the project's core guarantees. A change that breaks one is wrong even if the tests pass.

1. **Specs can never run code.** Expressions go through `src/expr.ts` only. Never use `eval`, `new Function`, `with`, dynamic `import`, or property access on host objects. New expression features must keep the "no route to JavaScript" property, and `test/expr.test.ts` must keep testing escape attempts.
2. **The parser never throws.** Every problem becomes a `Diagnostic` with a line number. Errors skip the line and its children; warnings keep the element and ignore the bad part.
3. **Streaming must keep working.** Any prefix of a valid spec, cut at a line boundary, must parse into a valid, smaller tree. Never add syntax that needs a closing line (no `end` blocks or multi-line values). Blocks that work by indentation, like `each` and `if`, are fine: they need nothing to close.
4. **Components never hard-code design.** Colors, fonts, radii, spacing and type sizes come from `ctx.theme`. Specs choose roles (`tone=`, `variant=`, `style=`, the look line, `enter=`), never values: a look line only scales the host's tokens, and motion timings are the engine's. The one deliberate exception is the experimental, opt-in `scene` (`src/components/scene/`): there the model paints, so a scene's shapes take the spec's colors. Keep that exception inside the scene folder.
5. **The model guide is generated, never hand-written.** Describe a component's props, text, children and example in its `ComponentDef`; `languageGuide()` and the docs read from there. Don't duplicate component documentation by hand anywhere else.
6. **Layout stays headless.** `layout()` must not touch the canvas or the DOM; it only uses `ctx.measure`. That is what makes it testable in Node.
7. **Rendering stays on the canvas.** The only DOM uses are a temporary native `<input>` over a field while someone types in it (`src/dom-editor.ts`), the hidden accessibility mirror (`src/a11y/dom.ts`), and the transparent text layer (`src/text-layer/dom.ts`), which are invisible and never draw. Do not render visible UI with HTML.
8. **Models generate specs, never components.** Components are reviewed TypeScript code. Nothing a model outputs at runtime may register a component or run code.
9. **No new runtime dependencies** without a strong reason. The library currently has none. Dev dependencies are fine.

## Commands

```bash
npm install
npm run dev                # playground at /playground/index.html
npm test                   # unit, contract, streaming, fuzz and interaction tests
npm run test:visual        # visual regression (Playwright); baselines come from Linux:
npm run test:visual:docker #   VISUAL_ARGS=--update-snapshots npm run test:visual:docker
npm run bench              # benchmarks
npm run eval               # score a real model (settings in .env.local, see .env.example)
npm run compare            # SayShape against HTML, same requests, same checks, per model
npm run pick-eval          # does the model pick the representation that shows the data best
npm run guide:size         # model guide size by section, per mode and profile
npm run typecheck          # tsc --noEmit
npm run build              # library → dist/
npm run build:playground   # static playground → dist-playground/
npm run docs:components    # regenerate the component reference (docs/components.md)
npm run readme:hero        # redraw the README's animated picture from a recorded run (after npm run build)
npm run docs:check         # fail if it's out of date
npm run new:component -- <name>   # scaffold and register a component
npm run build:world        # regenerate map outlines (rarely needed)
npm run site:dev           # the website (needs npm ci --prefix site); site:build, site:check
```

The website has its own dependencies in `site/package.json`; never add them to the library. Its demos import the engine from `src/`. Its component reference and model guide pages are generated (`npm run site:docs`), and `test/site.test.ts` checks every gallery example and every SayShape block in its Markdown.

## Before you say a change is done

Check what the change could have broken, not everything every time. Find the change in this table and run that row while you work. Rows add up: a change that fits two rows runs both. If you can't tell which row a change belongs to, treat it as code.

| The change | Run |
|---|---|
| Comments, or Markdown that holds no SayShape block | `npm run docs:check` |
| Markdown, README or website text with a SayShape block | `npx vitest run test/site.test.ts test/prompt.test.ts` |
| Any code in `src/`, `test/`, `eval/` or `scripts/` | `npm run typecheck` and the whole of `npm test`, with new tests for new behavior. The whole suite takes about 15 seconds, so never run only part of it |
| A component's definition (props, description, example, picks) | The code row, plus `npm run docs:components` |
| Anything that changes what is drawn | The code row, plus a look in the playground in light and dark mode. Use the inspector's layout boxes to check sizes |
| `mcp/` | `npm --prefix mcp run typecheck` and `npm --prefix mcp test` |
| `site/` | `npm run site:build` and `npm run site:check` |

Then, once per pull request (not once per task, when several tasks share one):

1. `npm run build` passes, if anything under `src/`, `scripts/` or the build settings changed.
2. If it changes how something looks, update the visual baselines in the same pull request (Linux only: `VISUAL_ARGS=--update-snapshots npm run test:visual:docker`, or add the `update-visual-baselines` label to the pull request and CI commits them).
3. Spec examples you add anywhere (component `example`, README, docs) parse with no diagnostics. `test/prompt.test.ts` checks component examples automatically.

CI runs everything on every pull request whatever the change: four Node versions, the installed packages, the MCP server, benchmarks, the visual tests and the website in a browser. Don't repeat those locally (the visual tests, `verify:pack`, the MCP end-to-end tests, the website's browser check) unless you're chasing a failure there, and never merge before CI is green.

## How to add a component

1. Run `npm run new:component -- <name>`, which creates the `ComponentDef` in `src/components/` and a test file, and registers it. (For large components, use a subfolder with its own entry point if it carries heavy data, like `map/`.) The contract tests in `test/contract.test.ts` now run on it and fail until it meets the rules below.
2. Fill in everything a model needs: `description` (one or two plain sentences on when to use it), `text` if it takes quoted text, every prop with `type`, `description` and `default` or `required`, `children`/`parents` if relevant, and a short `example`. If a model could build the same answer from simpler parts (stats, progress bars, text, a plain bar chart), add `picks`: what kind of answer it's for and how to start writing it (`{ for: "several KPIs against their targets", write: "chart kind=bullet target=goal" }`). Every guide and the MCP quick start list them before a model reads any docs, which is how it learns the element is the one to use; a new chart kind needs one too (the contract tests check).
3. Implement `layout(box, ctx)` (set `box.h`; containers lay out `box.children` through `ctx.layout`). Text must fit its box at every width: wrap it (`wrapText`, `fitLines`) or cut it with `ellipsize`/`fitText`, never fillText's maxWidth, which squeezes letters. Give the element a `minWidth` if it stops working below some width (controls, charts), so rows move it onto its own line instead of squeezing it. Implement `paint` and/or `paintOver` using theme tokens. Interactive components call `ctx.addHit(box)` while painting and define `press` if pressing does more than run `on=`. For several pressable parts in one element (stepper buttons, stars, tabs, page numbers), call `ctx.addHit(partBox(...), { detail })` once per part: each part becomes its own Tab stop and `press` reads `ctx.target.detail`. Read a `bind=` value with `p.bound()` and write it with `ctx.set(p.raw("bind"), value)`, never through `ctx.scope(name)`: `bind=` can be a path like `t.done` inside `each`, and these resolve it from the element's own item. Components that write a `bind=` state should then call `runOn(ctx)`, so `on=` runs with the new value. Define `drag` to follow the pointer while it's held (an element with `drag` is never pressed) and `key` to handle keys like the arrows while focused; see `slider` in `src/components/input.ts`. For an element people type into, define `editor()` (where its text sits and how it looks) and check `ctx.isEditing(node)` in paint, so the real `<input>` draws the text while it's open; see `input`. Keep view-only state that has to last between frames, like a scroll offset, in `ctx.view(node)` (engine-held, by element id), never in app state; see the sideways scrolling in `table`. Describe it to screen readers with `semantics(box, ctx)`: a role, a name and its state (`src/a11y/semantics.ts`); `null` when it's only layout, `false` when it's decoration; pressable parts as `parts` with the same `detail` passed to `addHit`. See `slider`, `stepper` and `select` for controls, `chart-a11y.ts` for data.
4. Make sure it's exported and in `coreComponents` in `src/components/index.ts` (the scaffold does this). A separate entry point exports its own list instead, like `mapComponents`; add that list to `ALL` in `test/contract.test.ts` so the contract tests cover it.
5. Add tests: parsing with good and bad props, layout at narrow and wide widths, and interaction (state after a press). If it binds, add it to the table in `test/write-data.test.ts`, which checks `bind=` on an item inside `each` for every binding component (and fails until you do). Use `render()` from `src/testing` for interaction. The contract tests already cover documentation, layout bounds, text that fits at 240, 360 and 600 px, theme-only colors, keyboard reach and accessibility (a `semantics` hook, a tree node wherever Tab can land, a name on every focusable node).
6. Add or update a playground sample if it helps show the component.
7. Run `npm run docs:components`.

Read `src/components/input.ts` (button, check, stepper), `src/components/navigation.ts` (tabs, pagination: pressable parts) and `src/components/map/index.ts` (custom hit testing) as references. Shared helpers are in `src/components/util.ts`. A new chart kind is a module in `src/components/chart-kinds/` built from `src/components/chart-kit.ts`, not a new component; see `funnel.ts` and `waterfall.ts`.

## How to change the language

Language changes touch several places. Do them together, in this order:

1. `src/parser.ts` (and `tokenizeLine` if the line syntax changes), `src/expr.ts` or `src/actions.ts`.
2. Validation and diagnostics for the new syntax, with clear messages that say how to fix the problem.
3. `src/prompt.ts` so the model guide explains it.
4. Tests, including streaming (every prefix parses) and, for expressions, sandbox escape attempts.
5. The language reference, [`docs/language.md`](docs/language.md).
6. Keep old specs working, or document the breaking change in `docs/language.md`.

## Code style

- TypeScript strict mode, including `noUncheckedIndexedAccess`. No `any`; prefer narrow types.
- Small, plain functions. Comments explain why, not what.
- User-facing messages (diagnostics, docs) use plain words and say how to fix the problem: `"button" has no prop "colour". Known props: on, variant, disabled, if`.
- Commit messages: a short summary line, then a body listing what changed.

## Current status

Version 0.1, the foundation, plus the Phase 1 testing and tooling and lists and data. Working: the engine, parser, expressions, actions, keyboard focus (including parts of elements), inspector, and 66 components (layout: `column`, `row`, `grid`, `card`, `list`, `list-item`, `accordion`, `overlap`, `divider`, `spacer`, `each`, `timeline`, `step`, `carousel`, `deck`, `slide`, `scroll`, `dialog`; content: `text`, `image`, `code`, `badge`, `avatar`, `callout`, `icon`, `tile`; data: `stat`, `rating`, `chart` with its layers `chart-line`, `chart-rule` and `chart-note`, `meter`, `board`, `tree`, `flow`, `schedule`, `table`, `table-column`, `details`, `detail`, `compare`, `compare-row`, `map`, `pin`; input: `button`, `link`, `check`, `switch`, `radio`, `select`, `date-picker`, `stepper`, `slider`, `input`, `segmented`, `menu`, `menu-item`; navigation: `screen`, `tabs`, `tab`, `breadcrumb`, `pagination`; feedback: `progress`, `skeleton`, `empty`), `tip=` on every element, the look line, entrance motion (`enter=`, `stagger=`), screens, `notify:` messages, images (with content laid over them, `shape=` and `zoom=`), lists and records in state and from the host, `each`, `if` blocks, `derive` lines, the model guide, `sayshape/model`, `sayshape/testing`, the evals, the playground, the MCP Apps server in `mcp/` and the website in `site/`.

How each of these works inside (what a component keeps as view state, how it scrolls, its keyboard and screen reader behavior, its plan document, every chart kind) is in [`docs/internals.md`](docs/internals.md), under "Current status". Read a component's entry there before changing it, and update the entry in the same change.

Known gaps: the map can't be reached by keyboard (recorded in `test/contract.test.ts`).

Limits: most elements cap what they parse or draw (derived values, options, rows, columns, chart items, nesting depth, data sizes, `each` copies) and show a message instead of more. Every limit and its constant is listed in [`docs/internals.md`](docs/internals.md), under "Limits": check there before adding or changing one.

Not built yet (see `docs/PLAN.md`): data sources and host commands, `required=` on selects, radios and date pickers, virtualized scrolling for very long lists, the overlays still to come (toasts, sheets; the popup layer only serves a component's own popup, like select's list, and `dialog` is the one overlay), tables beyond 200 rows or with vertical scrolling or editing, series from different lists, time zones and recurring events, a production model server package and the reference store app. Don't describe these as existing.

## Where to look next

- [`docs/PLAN.md`](docs/PLAN.md): phases, the component pipeline, the testing strategy and the on-the-fly generation architecture.
- [`docs/examples/ecommerce.md`](docs/examples/ecommerce.md): the target the plan builds toward, written in the proposed syntax.

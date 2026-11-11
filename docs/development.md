# Working on SayShape

Commands, tests, how to write a component and where things live. The rules that keep the project's guarantees are in [`CLAUDE.md`](../CLAUDE.md).

You need Node.js 18 or newer:

```bash
git clone https://github.com/premmannava/sayshape.git
cd sayshape
npm install
npm run dev        # opens the playground
```

| Command | What it does |
|---|---|
| `npm run dev` | Starts the playground with live reload |
| `npm test` | Runs the unit, contract, streaming, fuzz and interaction tests |
| `npm run test:visual` | Runs the visual regression tests (Playwright) |
| `npm run test:visual:docker` | Same, in the Linux image the baselines come from; add `VISUAL_ARGS=--update-snapshots` to update them |
| `npm run bench` | Benchmarks parse, layout and paint on 1,000- and 5,000-element specs |
| `npm run eval` | Scores a real model on 60 requests ([Measure it](model.md#measure-it)) |
| `npm run pick-eval` | Scores whether a model picks the representation that shows the data best ([Check the picks](model.md#check-the-picks)) |
| `npm run guide:size` | Measures the model guide by section, per mode and profile |
| `npm run typecheck` | Type-checks everything |
| `npm run build` | Builds the library into `dist/`: ES modules, and `sayshape.global.js` and `sayshape-map.global.js` for a plain `<script src>` (they define the globals `sayshape` and `sayshapeMap`) |
| `npm run build:playground` | Builds the playground as a static site into `dist-playground/` |
| `npm run docs:components` | Regenerates the component reference in [`components.md`](components.md) |
| `npm run docs:check` | Fails if the component reference is out of date |
| `npm run readme:hero` | Redraws the README's animated picture from a recorded model run (after `npm run build`; needs the network for fonts) |
| `npm run new:component -- <name>` | Scaffolds a component and its test file, and registers it |
| `npm run build:world` | Regenerates the map's country outlines |
| `npm run site:dev` / `site:build` / `site:check` | The website in `site/` (VitePress): develop, build, and check the build ([publishing it](https://premmannava.github.io/sayshape/docs/contributing/website.html)) |

The playground streams sample specs as a model would. Once a sample finishes you can edit the spec, toggle the debugging overlays, and watch state and emitted actions in the panels. **Appearance**, at the top, previews the screen in other styles ([Theming](engine.md#theming)).

## Testing

`sayshape/testing` runs the real engine (parsing, layout, painting, hit testing, pointer and keyboard handling) in Node against a stand-in canvas that records what is drawn. It works with any test runner.

```ts
import { render } from "sayshape/testing";

const ui = render(`state n=0
button "Add" on=inc:n
text "Clicked {n} times"`);

ui.press({ type: "button", text: "Add" });
expect(ui.state.n).toBe(1);
expect(ui.text()).toContain("Clicked 1 times");
```

| Helper | What it does |
|---|---|
| `find`, `findAll`, `isShown` | Look elements up by `type`, `text` (as written or as shown) and `line` |
| `press`, `drag`, `click`, `key`, `tab` | Interact through the same pointer and keyboard path as a real user |
| `type(query, text, { replace? })`, `editor` | Type into a field one character at a time, as a person would; `editor` is the text box over the field being typed in. While typing, `key` goes to the field (Enter, Tab, Escape) |
| `set`, `setSpec`, `stream` | Change state, replace the spec, or stream one in chunks |
| `state`, `emitted`, `focused`, `diagnostics`, `warnings` | Read the results |
| `text`, `drawOps`, `hits` | What the last frame drew, and what is clickable |

Map clicks need a real canvas to tell countries apart, so they're covered by the visual tests rather than in Node.

In this repository, the test suites are:

| Suite | Where | What it checks |
|---|---|---|
| Unit | `test/*.test.ts` | Parser, expressions, actions, layout, the model guide |
| Contract | `test/contract.test.ts` | Every registered component against the project rules: docs, layout bounds at three widths, theme-only colors and fonts, hit regions and keyboard reach |
| Streaming | `test/streaming.test.ts` | Every prefix of every sample renders a valid, smaller screen, however the stream is chunked |
| Fuzz | `test/fuzz.test.ts` | Random and damaged specs, expressions and actions never make anything throw (`FUZZ_RUNS=5000 npm test` for a longer run) |
| Visual | `visual/` | Component examples and samples in light and dark at 375 and 1024 px, against baselines in `visual/__screenshots__` |
| Benchmarks | `bench/` | Timings per commit; pull requests are compared with their base |

CI (`.github/workflows/ci.yml`) runs all of them. Visual baselines are made on Linux in the Playwright image, because fonts render differently on each platform: update them with `VISUAL_ARGS=--update-snapshots npm run test:visual:docker`, or let CI do it: add the `update-visual-baselines` label to a pull request (or run the CI workflow by hand with **update-baselines**), and it commits the regenerated images to the branch for review.

## Writing a component

A component is one `ComponentDef` object. Registering it is all it takes: the parser validates its props, the model guide describes it, and the engine lays it out and paints it.

In this repository, `npm run new:component -- ribbon` creates the file and its test from a template and registers it. The contract tests then fail until every placeholder is filled in, so `npm test` tells you what's left.

```ts
import type { ComponentDef } from "sayshape";

export const ribbon: ComponentDef = {
  type: "ribbon",
  category: "content",
  description: "A full-width colored strip with a short notice.",
  text: { description: "The notice.", required: true },
  props: {
    tone: {
      type: "enum",
      values: ["accent", "good", "warn", "bad"],
      default: "accent",
      description: "Color role.",
    },
  },
  example: `ribbon "Free shipping this week" tone=good`,

  layout(box) {
    box.h = 32;
  },

  paint(box, ctx) {
    const p = ctx.props(box.node);
    const color = ctx.theme.colors[p.oneOf("tone", ["accent", "good", "warn", "bad"] as const, "accent")];
    const { g } = ctx;
    ctx.roundRect(box.x, box.y, box.w, box.h, ctx.theme.radius.sm);
    g.fillStyle = color;
    g.fill();
    g.font = ctx.font(600, 13);
    g.fillStyle = ctx.theme.colors.onAccent;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(p.text(), box.x + box.w / 2, box.y + box.h / 2 + 1, box.w - 16);
  },
};

const ui = new SayShape(canvas, { components: [...coreComponents, ribbon] });
```

What a `ComponentDef` can define:

| Field | Purpose |
|---|---|
| `type`, `category`, `description`, `example` | Identity and documentation; also used in the model guide |
| `text` | Whether it takes quoted text |
| `props` | Prop names, types and descriptions, used for validation and docs |
| `children` | `"any"` or a list of allowed child types; omit for leaf components |
| `parents` | Restrict where it can appear |
| `layout(box, ctx)` | Required. Set `box.h`; containers also lay out `box.children` |
| `paint(box, ctx)` / `paintOver(box, ctx)` | Draw before or after children |
| `hitTest(box, x, y)` | Refine clicks inside the box (the map uses this per country) |
| `drag(ctx)` | Follow the pointer while it's held down (`start`, `move`, `end`); the slider uses this |
| `key(ctx, key)` | Handle a key while focused; return true if handled |
| `visible(node, scope)` | Hide the element beyond `if=` (only the active `screen` shows) |
| `press(ctx)` | What happens on activation; by default it runs the `on` prop |
| `cursor(target)` | Mouse cursor over it |

Use `ctx.props(node)` to read props. It evaluates `{expressions}` and fills templates for you: `num`, `str`, `bool`, `cond`, `oneOf` and `text`.

## Project structure

```
src/
  engine.ts         The SayShape class: pipeline, canvas, pointer and keyboard input
  parser.ts         Spec text → node tree, with diagnostics
  expr.ts           The safe expression language
  actions.ts        on= actions
  layout.ts         Headless layout
  component.ts      The ComponentDef contract and PropReader
  registry.ts       The set of components an instance knows
  inspector.ts      Debugging overlays, inspect mode, frame capture
  prompt.ts         Generates the model guide (full and compact)
  profiles.ts       Component profiles: which elements the model is told about
  theme.ts          Design tokens
  text.ts           Text measuring and wrapping
  state.ts          The state store
  components/       Built-in components; map/ is a separate entry point
  testing/          sayshape/testing: render() and the recording canvas
  model/            sayshape/model: stream, clean, check and repair a model's spec; refinement context
playground/         The development playground
test/               Unit, contract, streaming, fuzz and interaction tests (Vitest)
visual/             Visual regression page, cases and baselines (Playwright)
bench/              Benchmarks
eval/               The evaluation set and its scoring (npm run eval)
scripts/            Map outlines, component docs, component scaffold, benchmark comparison
.github/workflows/  CI
docs/               The reference (language, components, engine, model), plan, examples and images
CLAUDE.md           Brief for AI assistants working on this repo
docs/images/        README images
```

## Roadmap

The full phase-by-phase plan, including the component pipeline, testing strategy and how a model generates UI on the fly, is in [`docs/PLAN.md`](PLAN.md). [`docs/examples/ecommerce.md`](examples/ecommerce.md) shows the complete store the plan builds toward.

1. **Foundation** (0.1, done): engine, parser, expressions, actions, keyboard focus, inspector, first components, tests, playground.
2. **Components and data**: done so far: grid, list, accordion, badge, avatar, code, rating, link, switch, radio, stepper, tabs, breadcrumb, pagination, skeleton, empty, pressable cards and struck-through text, plus images, a slider (with dragging), screens with `go:` and `back`, `notify:` messages, lists and records with `each`, `if` blocks, list functions and formatting, text input (a real input placed over the field while typing), charts (multi-series bar, horizontal bar and line, pie, donut, funnel and waterfall), meters (ring and gauge), a stat's change and sparkline, callouts, tables with sorting and selection, a select and a date picker that open in a popup layer on the canvas, and `derive` lines for values worked out from state. Next: scrolling and dialog. The accessibility mirror is built: every element describes itself to screen readers (see [Accessibility](engine.md#accessibility)).
3. **Docs site**: started. `site/` is a VitePress site with a playground, an example gallery and documentation whose examples render live with SayShape, deployed to GitHub Pages by `.github/workflows/pages.yml`.
4. **Model connection**: started. The playground's Ask a model box, `sayshape/model` (streaming, cleanup and one repair) and `npm run eval` work with any OpenAI-compatible server. Still to do: a production server package, and comparing the results with other generative UI formats.
5. **An app** built on top.

# SayShape

**A UI language made for AI models to write, and the engine that draws it.**

A model streams a few lines of SayShape and a working interface appears on screen, line by line, while the model is still writing. Nothing the model writes is ever run as code.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.gif">
  <img src="docs/images/hero-light.gif" width="880" alt="One request answered by Claude Sonnet 5.5 in two formats, replayed in real time. The SayShape answer is a finished, working chart after 2.2 seconds and 616 characters. The HTML answer is still being written, and finishes after 11.8 seconds and 5,196 characters. Then the Month toggle is pressed on the SayShape chart and it redraws.">
</picture>

<sub>A real recording, replayed at the speed it arrived: the same request, the same model, at the same moment. Not staged: [`npm run readme:hero`](scripts/readme-hero.mjs) draws this picture from [the recording](site/public/compare/anthropic_claude-sonnet-5.5/c5.json) with the engine itself. Across the seven recorded requests the median time to a finished screen was 2.4 s for SayShape, 13.2 s for HTML and 17.2 s for A2UI.</sub>

**[Playground](https://premmannava.github.io/sayshape/playground)** · **[Examples](https://premmannava.github.io/sayshape/examples/)** · **[Watch the formats race](https://premmannava.github.io/sayshape/compare)** · **[Docs](https://premmannava.github.io/sayshape/docs/)** · **[Use it in Claude or ChatGPT](https://premmannava.github.io/sayshape/docs/integration/mcp)**

> **Status: 0.1, an early foundation** by one maintainer. It works and is tested (60 components, more than 4,000 tests), but read [what it doesn't do](#what-it-doesnt-do) before using it for anything real.

## What a model writes

This is the whole SayShape answer from the picture above, exactly as the model wrote it:

```
state view="Week" week=[{label: "Mon", signups: 30}, {label: "Tue", signups: 42}, {label: "Wed", signups: 38}, {label: "Thu", signups: 51}, {label: "Fri", signups: 47}, {label: "Sat", signups: 22}, {label: "Sun", signups: 18}] month=[{label: "Week 1", signups: 210}, {label: "Week 2", signups: 245}, {label: "Week 3", signups: 230}, {label: "Week 4", signups: 268}]
derive shown={view == 'Week' ? week : month}
card
  text "Signups" style=title
  segmented bind=view options="Week,Month"
  stat label="Total signups" value={number(sum(shown, 'signups'))}
  chart kind=bar items=shown x=label y=signups format=number
```

- **One element per line, indentation for nesting.** Every finished line can be drawn at once, and a half-finished answer is still a valid, smaller screen.
- **State and values worked out from it.** `state` holds the data, `derive` keeps a value up to date, `bind=` connects a control to state, and `{…}` reads it. Pressing Month changes `view`; the total and the chart follow.
- **No colors, fonts or pixel sizes.** The model picks roles such as `style=title`. The engine and your theme decide how they look, so every screen matches.
- **No code.** `{…}` can read state, do arithmetic and call a fixed list of functions. There is no route from a spec to JavaScript, so there is nothing to sandbox.

## How it compares with a model writing HTML

26 business requests (KPIs, charts, tables, forms, calculators, dashboards), 3 runs each, GPT-4.1, first try with no repair:

| | SayShape | HTML |
|---|---|---|
| Time to a finished screen (median) | **1.6 s** | 7.3 s |
| Output tokens (median) | **149** | 1,205 |
| Input tokens (median) | 11,123 (the language guide) | **168** |
| Cost per answer, guide cached | **$0.0081** | $0.0108 |
| Cost per answer, no caching | $0.0239 | **$0.0108** |
| Works when used, first try | 87% (68 of 78) | **96% (75 of 78)** |
| Answers with hard-coded colors | **0 of 78** | 78 of 78 |
| Answers that insert HTML from strings | **0 of 78** | 26 of 78 |

HTML wins two rows, and they matter. Models already know HTML, so it works first try a little more often (on GPT-5.6 Luna the gap was 97% against 99%). `sayshape/model` checks each answer with the parser and asks once for a fix; these figures are without that. And the guide that teaches a model the language is about 11,000 input tokens, so turn on prompt caching or use the compact guide.

These are our own measurements, from 2026-11-05, made with the harness in this repository: `npm run compare` scores both formats the same way on what is shown and on what happens when it's used. Run it against your own model before trusting ours.

## Try it

**In the browser, nothing to install.** Open the [playground](https://premmannava.github.io/sayshape/playground), edit a spec and watch the screen change, or browse the [examples](https://premmannava.github.io/sayshape/examples/).

**In Claude, ChatGPT, VS Code or another chat app.** SayShape is an [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) server: ask for a chart, a table or a calculator and the assistant answers with a working one inside the conversation. The setup for each app is in [`mcp/README.md`](mcp/README.md).

```bash
npx -y sayshape-mcp
```

**In your own app.**

```bash
npm install sayshape
```

```ts
import { SayShape, coreComponents } from "sayshape";

const ui = new SayShape(document.querySelector("canvas")!, { components: coreComponents });

ui.setSpec(`
state count=0
card
  text "Pressed {count} times"
  button "Press me" on=inc:count
  button "Save" variant=secondary on=emit:save:{count}
`);

// The only thing that leaves a screen: an action your app chose to listen for.
ui.on("action", ({ name, value }) => console.log(name, value));
```

To have a model write the spec, `sayshape/model` streams it from any OpenAI-compatible endpoint into `ui.push()`, checks it with the parser and asks once for a fix. See [Connecting a model](docs/model.md).

## What's in it

- **60 components**, each drawn by the engine: layout, text and icons, forms (inputs, selects, a date picker, sliders, menus, dialogs), tables, and data views that would otherwise need a library each: 14 kinds of chart including sankey, treemap, heatmap and scatter, plus boards, org charts, flow diagrams, schedules, Gantt timelines and maps. [Browse them all](https://premmannava.github.io/sayshape/docs/components/).
- **An engine with no dependencies.** Its own parser, layout, painter and input handling on one `<canvas>`, about 170 KB gzipped. No React, no CSS layout, no build step for specs.
- **Errors that don't break the screen.** A bad line is skipped and reported with its line number and how to fix it; the rest still draws.
- **A model guide that can't go stale.** Each component is defined once, and that definition drives validation, the docs and the prompt that teaches a model the language.
- **Accessibility.** A hidden mirror gives screen readers, keyboards and phones a role, a name and a state for everything drawn.
- **Themes.** Light and dark, your own tokens in code or CSS variables, or one brand color (`--accent` on the MCP server).
- **Testing tools.** `sayshape/testing` runs the real engine in Node, so a generated screen can be pressed and checked without a browser.

## What it doesn't do

- **Use your own components.** It draws its own, styled by theme tokens (colors, spacing, radii, fonts). It can match a brand; it can't render your design system's React button.
- **Text selection, find in page or browser translation.** It's a canvas. `copyText()` gives the whole screen as plain text instead.
- **Large or editable tables.** 200 rows at most, with no editing and no vertical scrolling.
- **Everything a mature form library does.** Fields say what's wrong with them, but nothing checks a whole form on submit.
- **Run on native mobile.** Browsers only.

The full list is in [Limitations](docs/limitations.md). Accessibility is built and tested here, but has not been audited by anyone outside the project.

## Documentation

The [website](https://premmannava.github.io/sayshape/docs/) is the best place to read, because every example on it runs live. The same reference is in this repository:

| | |
|---|---|
| [The language](docs/language.md) | Elements, state, derived values, expressions, actions, lists, screens and conditions |
| [Components](docs/components.md) | Every component's props and an example, generated from the code |
| [Using the engine](docs/engine.md) | Options, methods, events, theming, accessibility and debugging |
| [Connecting a model](docs/model.md) | `sayshape/model`, the guide and its sizes, and scoring a model yourself |
| [The MCP server](mcp/README.md) | SayShape inside chat apps, and hosting it for a team |
| [Working on SayShape](docs/development.md) | Commands, tests, writing a component and the project's layout |
| [Limitations](docs/limitations.md) and [the plan](docs/PLAN.md) | What's missing today and what comes next |

## Contributing

```bash
git clone https://github.com/premmannava/sayshape.git
cd sayshape
npm install
npm run dev     # the playground, with live reload
npm test
```

[Working on SayShape](docs/development.md) has the rest. The rules that keep the project's guarantees are in [`CLAUDE.md`](CLAUDE.md), written for AI assistants and just as useful to people.

## License

[MIT](LICENSE).

Country outlines in `src/components/map/world.json` come from [Natural Earth](https://www.naturalearthdata.com/) (public domain) via [world-atlas](https://github.com/topojson/world-atlas). US state borders in `src/components/map/states.json` come from the US Census (public domain) via [us-atlas](https://github.com/topojson/us-atlas). Lakes, rivers and city names in `src/components/map/water.json` and `places.json` come from Natural Earth 1:50m (public domain). All are drawn with the Web Mercator projection.

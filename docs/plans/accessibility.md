# Plan: accessibility

**Status:** done (2026-11-06), steps 1 to 9, except the control-outline contrast in step 7, which is a separate pull request waiting for review, and keyboard access to the map. Before claiming WCAG 2.1 AA, run the manual pass in [`docs/accessibility-testing.md`](../accessibility-testing.md). Part of [Phase 3](../PLAN.md#phase-3-components-and-engine) (the accessibility mirror).
**Rough size:** 6 to 9 weeks for one person, in nine pull requests that each leave `main` working.

## The problem

SayShape draws everything on one `<canvas>`. To a screen reader the whole interface is a single element labelled "Generated interface": no buttons, no headings, no table, nothing announced. Keyboard support is mostly there already (Tab order from hit regions, Enter and Space, arrows in the richer elements, a painted focus ring), but nothing outside the canvas can see where focus is or what it's on.

Enterprises buying SayShape will ask for WCAG 2.1 AA. This plan gets there without giving up the canvas.

## The design

A hidden **accessibility mirror**: a DOM tree beside the canvas that gives each shown element a role, a name and a state, kept in step with focus, state and the screen. Flutter's semantics tree works the same way. CLAUDE.md rule 7 already allows it.

```
spec → layout → boxes → paint (hits) → canvas
                          │
                          └→ semantics() per element → accessibility tree → host
                                                                            │
                     engine focus / press / key ←── screen reader, keyboard ┘
```

### The component hook

`ComponentDef.semantics?(box, ctx)` returns what the element is (`src/a11y/semantics.ts`):

- `ElementSemantics`: a `role`, a `name`, and state (`checked`, `selected`, `expanded`, `disabled`, `value` with `min`, `max`, `now` and `text`, heading `level`, and so on). Its children go inside it.
- `null`: it's only layout or decoration; its children stand in its place.
- `false`: it and everything inside it are hidden (a loading placeholder).

Elements with pressable parts (stepper buttons, stars, tabs, page numbers) list them in `parts`, each matched to the hit region painted with the same `detail`, so each part keeps its own Tab stop.

Without the hook, an element is a button for each region it paints, text for its quoted text, or nothing. Step 6 makes the contract tests require the hook on every component.

### The tree

`buildAccessibilityTree` (`src/a11y/tree.ts`) walks the laid-out boxes after a frame is painted. It is headless (boxes and hits in, plain objects out), so it's tested in Node: `render(spec).accessibility()` in `sayshape/testing`. Each node has a `key` that stays the same across frames (the element's id, plus the part's detail), which the browser host diffs by so screen readers keep their place.

Roles whose content is their name (button, checkbox, heading, img and so on) don't get children; a focusable element inside one (a button in a pressable card) is kept just after it.

### The host

The engine talks only to an `AccessibilityHost` (`src/a11y/host.ts`), like the `EditorHost` for typing:

- In browsers, `domAccessibilityHost` (`src/a11y/dom.ts`) puts a container right after the canvas: a polite and an assertive live region (step 1), then the mirror itself (step 2).
- `sayshape/testing` records what it's given (`ui.announcements`).
- `accessibility: "off"` turns it off.

### How the mirror behaves (step 2)

1. Each node is absolutely positioned over its box, transparent, with `pointer-events: none`, so the mouse still reaches the canvas while touch exploration on phones finds the right place.
2. Native elements where they help: `<button>`, `<input type="checkbox">` with `role="switch"`, `<input type="range">` for sliders, `<a>` for links. Phones get increment, decrement and activation for free.
3. Focus goes both ways: when the engine moves focus, the matching node gets DOM focus; when a screen reader or Tab moves DOM focus, the engine follows and paints its ring.
4. A click on a node runs the engine's existing `activate`; keys go to the existing `key` handlers. No second behavior path.
5. Focusing a field's node opens the existing editor, whose `<input>` carries the field's label.
6. The root carries `aria-busy` while a spec streams or data loads, then "Ready" is announced once.
7. Shift+Tab before the first element leaves the interface: the canvas drops out of the Tab order for that one move, or the browser would land on it and send focus straight back in.
8. Focus that arrives on the canvas from the keyboard (not a press) turns on keyboard mode, so the focus ring shows and DOM focus moves on to the mirror.

Controls that have no label of their own (a slider, an input or a segmented without quoted text) take the text element just before them in the same container (`ctx.textBefore()`). Radios sharing a `bind=` ask to be wrapped together (`group`), so the tree gets one radiogroup around neighbours, named by the text above the first. A stepper is a group of a Decrease button, its value as a `status` (so each new value is read out) and an Increase button; a part that can't be pressed (at the limit) stays in the tree as disabled, so focus doesn't fall out of it.

Some elements draw their own rows instead of laying out children (details): they describe each row as a part with no region. A pressable list-item is a listitem holding a button part (the part's detail is undefined, so it matches the row's region), so a list still reads as a list.

Open popups follow the ARIA combobox pattern: focus stays on the combobox while the arrows move a highlight, the combobox `controls` a listbox of the options (or of the open month's days) and points at the highlighted one (`aria-activedescendant`). Parts can sit inside other parts (`within`) and name the parts they control or that are active (`controls`, `active`), which the mirror turns into element ids. The options use the same details their rows are painted with, so a screen reader can also choose one directly. A tablist holds only its tabs; the selected tab's panel follows it (`contentAfter`).

Charts are figures: named by their title (or the text above, or the kind), described by a one-sentence summary worked out from the data for each kind (`src/components/chart-a11y.ts`: highest and lowest, where a line starts and ends, a pie's total and largest share, a funnel's first and last stage, a heatmap's size and highest cell), with the numbers they draw as a table inside. Tables and compares draw their own rows, so header, rows and cells are parts placed where they're drawn (`rect`); sortable headers and choosable rows are focusable and act through the mirror. A map is a figure listing its places (pins, or the data rows largest first). The contract tests now require `semantics` on every component, a tree node wherever Tab can land, and a name on every focusable node.

An element whose one region is painted with a detail (a slider's `"track"`) names that `detail` in its semantics, so its own node is the one focus and presses go to.

## Steps

Each is one pull request into `main`, merged only when CI is green.

1. **Foundations** (done). `src/a11y/` types, the `semantics` hook, the tree builder, the host interface with live regions, the `accessibility` option, `notify:` messages and new screens announced, `ui.accessibility()` and `ui.announcements` in `sayshape/testing`.
2. **Mirror sync** (done). The DOM mirror from the tree each frame, keyed diffing, placement, focus both ways, clicks and keys routed to the engine, `aria-busy`. axe on one sample.
3. **Controls** (done). button, link, check, switch, radio, segmented, stepper, slider, rating, input, pressable card and list-item.
4. **Content and structure** (done). text and headings, image, icon, code, badge, avatar, callout, stat, list, timeline, details, accordion, carousel, progress, meter, skeleton, empty, layout containers.
5. **Navigation and popups** (done). screen, tabs, breadcrumb, pagination, select (single and multiple), date-picker.
6. **Data** (done). table, compare, chart summaries and data tables for every kind, map. The contract tests start requiring `semantics` on every component.
7. **Beyond screen readers** (done). Reduced motion was already honored everywhere (every animation checks `ctx.motion`). A contrast test of the theme's text, focus and series tokens in light and dark: all pass AA as they are. A forced-colors theme (`forcedColorsTheme`): in Windows Contrast Themes the canvas draws in the person's system colors, whatever theme the host chose. Focusable regions at least 24 px tall (WCAG 2.2, 2.5.8: links and breadcrumb steps were 19 and 22). `notify:` messages stay longer when they're longer (3 to 10 seconds). Not done: control outlines (a field's border, an unchecked box, a switch that's off) are below 3:1 against the page (WCAG 1.4.11); fixing them changes how every control looks, so it's a separate pull request for review rather than merged unseen.
8. **Language and guide** (done). `label=` on segmented, rating and icon (the elements with no quoted text that a model might leave unnamed; an icon with a label is an image, without one decoration). One guide line in each mode asks for a label on every control and a title on every chart (about 40 tokens). No new warnings: a control's name already falls back to the text just above it, and warning on every unlabelled one would add diagnostics to many specs that read well.
9. **Verification and docs** (done). axe runs in CI over every visual case and every site gallery example; a README section; [`docs/accessibility-testing.md`](../accessibility-testing.md), a 15-minute pass with VoiceOver and NVDA.

## Testing

| Level | What | Where |
|---|---|---|
| Unit and contract | The tree for each component through `render().accessibility()`; every component describes itself (from step 6) | `test/a11y/`, `test/contract.test.ts` |
| DOM host | Live regions and the mirror in jsdom | `test/a11y/dom-host.test.ts` |
| Browser | Roles, names, focus both ways, clicks reaching `activate` | Playwright |
| Audit | axe-core on every visual case and sample | Playwright with `@axe-core/playwright` (a dev dependency) |
| Screen readers | VoiceOver and NVDA on the store and a dashboard | By hand, before any AA claim |

## Risks

- Screen readers may not activate transparent nodes with `pointer-events: none`. Step 2 checks; if needed, nodes take pointer events only while focus is inside the mirror.
- Rebuilding the mirror while a spec streams could lose a screen reader's place. Keyed diffing keeps node identity, and `aria-busy` holds announcements until it's done.
- Large tables and maps add hundreds of nodes. Measured in `bench/`; if slow, only rows on screen get nodes.
- Automated tests can't prove AA. A manual pass comes before any customer claim.

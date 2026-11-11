# Using the engine

```bash
npm install sayshape
```

```ts
import { SayShape, coreComponents } from "sayshape";
import { mapComponents } from "sayshape/map";

const canvas = document.querySelector("canvas")!;
const ui = new SayShape(canvas, {
  components: [...coreComponents, ...mapComponents],
});

ui.setSpec(`
state count=0
card
  text "Clicked {count} times"
  button "Click me" on=inc:count
`);
```

The canvas fills its parent's width and grows to fit its content.

## Options

| Option | Default | Description |
|---|---|---|
| `components` | required | The components this instance understands |
| `theme` | `"auto"` | A `Theme`, or `"auto"` to follow light/dark mode and `--sayshape-*` CSS variables |
| `width` | parent width | A fixed width in CSS pixels |
| `minHeight` | `0` | Minimum canvas height |
| `padding` | `20` | Space around the whole screen |
| `animate` | `true` | Fade new elements in (off when the user prefers reduced motion) |
| `imageHosts` | `[]` | Hosts images may load from besides your own site ([Images](#images)) |
| `loadImage` | an `<img>` with CORS | Custom image loading, for tests, server rendering or signed URLs |
| `onWarning` | `console.warn` | Receives problems found while running, like a blocked image |
| `editor` | an `<input>` over the field | How text fields are typed into ([Typing](#typing)); `sayshape/testing` passes a fake one |
| `today` | the device's local day | Today's date as `() => "YYYY-MM-DD"`, for date pickers; fix it in tests and screenshots |
| `viewport` | from the window | The part of the canvas people can see, `() => ({ top, bottom })` in canvas pixels, for placing a select's list ([Popups](#popups)) |
| `pixelRatio` | the window's `devicePixelRatio` | Device pixels per CSS pixel in the canvas bitmap |

## Methods

| Method | Description |
|---|---|
| `setSpec(text, { resetState? })` | Replace the whole spec |
| `beginStream({ keepState? })` | Start a streamed spec; clears state unless `keepState` |
| `push(chunk)` | Append streamed text. Only complete lines render |
| `endStream()` | Finish the stream and render the last line |
| `on(event, handler)` | Subscribe to an event; returns an unsubscribe function |
| `state.get(key)` / `state.set(key, value)` | Read or change state from your app |
| `setLoading(names)` / `setAwaiting(on)` | Show placeholders for data still on its way, then draw it in when it arrives |
| `go(screen)` / `back()` | Show another screen, or the previous one |
| `screens` / `currentScreen` / `canGoBack` | The spec's screen names, the visible one, and whether `back()` can move |
| `notify(text)` | Show a short message, as `notify:` does |
| `imagesLoaded()` | A promise that resolves once every requested image has loaded or failed |
| `picture({ pixelRatio?, background?, widen? })` | A promise of a new canvas with the screen as it is now (current state and screen), at 2× by default, on the theme's surface, without hover, focus, popups or messages. When a table scrolls sideways, the picture is drawn wider (up to 2,400 px) so every column shows; `widen: false` keeps the screen's width. Save it with `toBlob()` for a "Save image" button |
| `copyText()` | The screen as plain text, for a "Copy text" button, since nothing on a canvas can be selected: headings and text as lines, fields as `Label: value`, checkboxes as `[x]`, and tables and chart data as tab-separated rows that paste into a spreadsheet as cells. Buttons are left out, and a password is never included |
| `hiddenWidth()` | How much wider the screen would need to be for nothing to scroll sideways; 0 when nothing does |
| `setTheme(theme)` | Switch themes |
| `find(type)` | All nodes of a type, e.g. `ui.find("button")` |
| `expose(name?)` | Put the instance on `window` for the console (default `window.sayshape`) |
| `destroy()` | Remove listeners and stop rendering |

## Events

| Event | Payload | When |
|---|---|---|
| `action` | `{ name, value, node }` | An `emit:` action ran |
| `change` | `{ key, value }` | A state value changed |
| `diagnostics` | `Diagnostic[]` | The spec's problems changed |
| `render` | `Metrics` | A frame was painted (node count and timings) |
| `inspect` | `{ node, box }` or `null` | Inspect mode selected something |
| `navigate` | `{ screen, from }` | The visible screen changed |
| `notify` | `{ text }` | A message was shown |

```ts
ui.on("action", ({ name, value }) => {
  if (name === "order") submitOrder(value);
});
```

## Scenes (experimental, off by default)

A `scene` is a picture or animation the model paints itself from shapes (`rect`, `circle`, `ellipse`, `line`, `path`, `polygon`, `label`, `group`, `define`/`use`, `gradient`), for things no other element shows: a goal celebration, a rabbit hopping, a car on a road. Any prop can be a formula of `t`, the seconds since the scene started, and lines inside a scene can call extra math (`sin`, `cos`, `ease`, `wave`, `random`, `range`, `pick`, …). It is the one place where specs choose their own colors.

Scenes are **off unless you turn them on**, by registering their components from a separate entry point:

```ts
import { sceneComponents } from "sayshape/scene";
const ui = new SayShape(canvas, { components: [...coreComponents, ...sceneComponents] });
```

Leave `sceneComponents` out and scenes are off: `scene` is an unknown element, the scene math isn't available anywhere, and the model guide doesn't mention them. The playground turns them on with `?scene=1` in its address, and the MCP server with `--scene`.

```
scene "The sun rising over hills" w=600 h=300 duration=4 bg="#0B1D3A"
  circle x=300 y={300 - 160*ease(t, 0, 3)} r=40 fill="#FFD166"
  each items={range(3)} as=i
    ellipse x={100 + i*200} y=300 rx=180 ry={70 + 20*i} fill={pick(['#2D6A4F', '#40916C', '#52B788'], i)}
```

Limits: a scene draws at most 2,000 shapes and works through at most 20,000 lines a frame (`MAX_SCENE_SHAPES`, `MAX_SCENE_STEPS`), `range()` makes at most 500 items, and `use` nests at most 8 deep. With reduced motion (or `animate: false`) a scene shows a still of its last moment.

### Pressable shapes

Any shape, `group` or `use` with `on=` can be pressed (click, tap, or Tab to it and press Enter or Space), and runs its actions like a button. Inside the scene's `each`, actions see the item (`on=set:sel:{m.id}`, `on=toggle:m.on`). `selected=` draws a selection outline, `tip=` shows a small tag while it's hovered or focused, and `name=` is what screen readers call it (by default, the words of its labels). Hover, focus and selection are drawn by the engine in theme colors, so a spec writes nothing for them. Props bound to state (`fill={sel == m.id ? 'accent' : 'line'}`) repaint when anything changes that state, inside or outside the scene, with no new spec.

```
state sel='cut' machines=[{id: 'cut', name: 'Cutter', x: 120}, {id: 'weld', name: 'Welder', x: 320}]
scene "Two machines on a line" w=440 h=200
  each items=machines as=m
    group x={m.x} y=100 on=set:sel:{m.id} selected={sel == m.id} tip="{m.name}"
      rect x=-60 y=-50 w=120 h=100 rx=12 fill=raised stroke=line width=2
      label "{m.name}" x=0 y=0 size=20 weight=bold align=center fill=ink
text "Selected: {find(machines, 'id', sel).name}"
```

Hits are exact through the scene's scaling and every move, turn and scale: rectangles, circles, ovals, polygons and filled paths by their outline (filled as the canvas fills them), lines and unfilled paths within a few pixels, labels by their box. Inside the scene's `each`, `key=` keeps focus on the same item when the list changes order. The last drawn wins, and a pressable shape inside a pressable group wins over the group. Pressable shapes are buttons inside the scene's figure for screen readers, with `selected=` read as pressed. Not built: dragging shapes, arrow keys between shapes, and tooltips outside the scene's box. The playground's "Factory monitor (scene)" sample (`?scene=1`) puts it together; [docs/plans/interactive-scenes.md](plans/interactive-scenes.md) has the design and its limits.

`reviewScenes(parsed)` (the drawing check the MCP server sends back with `--scene`) also warns about labels too small to read and pressable shapes too small to tap on a phone, labels too close in color to what's under them in light or dark mode, pressable shapes on top of each other or outside the picture, and a scene whose formulas use `t` but whose `duration` is 0, so it never moves. Small labels come back as one summary and labels with the same contrast problem as one warning, so a scene full of small text can't push the other problems out of the list.

How well scenes hold up with real models, in a real browser, with a screen reader's view and under load, and what's still missing, is in [docs/plans/interactive-scenes-validation.md](plans/interactive-scenes-validation.md). `npm run scene-eval` scores a model on eight interactive-scene requests (`eval/scenes.ts`; `--score <dir>` scores saved answers), `npx playwright test visual/scene.spec.ts` checks the factory monitor in Chrome at five widths and in four themes, and `npm run bench:scene-browser` times scenes of 4 to 500 objects in a real browser.

## Images

A spec can name any image URL, and a model writes specs, so SayShape only loads images from your own site (the page's origin) and from hosts you list. Anything else, including `data:` and `javascript:` URLs, is blocked: the `image` shows its description instead, and the console says which host to allow.

```ts
const ui = new SayShape(canvas, {
  components: coreComponents,
  imageHosts: ["cdn.example.com", "*.images.example.com"], // * allows subdomains; https only
});
```

Images load with CORS (`crossOrigin="anonymous"`), so their server must send `Access-Control-Allow-Origin` (most image CDNs do). The playground allows `images.unsplash.com`, and its "Trail gear" and "Gear finder" samples use real photos from there. The space for each image is kept from its `ratio=` while it loads, so the screen doesn't jump.

## Keyboard

The canvas is focusable. Tab and Shift+Tab move between interactive elements, Enter or Space presses the focused one, and a focus ring is drawn on the canvas. A focused `slider` also moves with the arrow keys, Page Up and Page Down, Home and End. A focused `select` or `date-picker` opens with Enter, Space or the up and down arrows; its popup then takes the keys (see [Popups](#popups)). Delete or Backspace clears a focused `date-picker` unless it has `required=true`.

On touch screens, vertical swipes still scroll the page and pinches still zoom, while horizontal drags go to the canvas, so sliders can be dragged.

## Popups

A `select` shows its options, and a `date-picker` its calendar, in a popup: a panel the engine draws on the canvas above everything else, owned by the element that opened it. One can be open at a time.

- **On top.** It's drawn last, and only its own options can be hovered or pressed while it's open. A press anywhere outside it (on the canvas or elsewhere on the page) closes it and does nothing else, so a button underneath isn't pressed by the same click.
- **Keys.** While it's open, keys go to it. In a select's list, up and down move the highlight (skipping unavailable options), Home and End jump to the ends, Page Up and Page Down move a page. In a calendar, the arrows move by a day or a week, Page Up and Page Down by a month, Home and End to the start and end of the week, staying within `min=` and `max=`. Enter or Space chooses, Escape closes, and Tab closes it and moves on. Focus goes back to the field when it closes.
- **Placement.** It opens below the field, or above it when only that fits in the visible part of the window, lining up with the field and staying inside the canvas. A canvas can't draw outside itself, so when the list needs more room than the screen has, the canvas grows while the list is open and shrinks back after.
- **Long lists** show 8 options at a time. They scroll with the wheel, the keyboard (the highlight stays in view), or the arrows at the top and bottom of the list, so every option can be reached by pointer as well as keyboard.
- **Closing.** It also closes when an option is chosen, when the select is hidden, disabled or left with no options, when the canvas loses focus, and when the spec is replaced.
- What's highlighted, how far a list is scrolled and which month a calendar shows belong to the popup, not to state: they're forgotten when it closes. Only choosing changes `bind=`.

## Typing

An `input` field is drawn on the canvas like everything else. While someone types in one, SayShape places a real `<input>` exactly over it, with the field's font and colors and a transparent background, so the browser handles typing, selection, copy and paste, undo, input methods for Chinese, Japanese and Korean, autocorrect, password managers, autofill and the phone keyboard. It's removed when they leave the field.

- Clicking or tapping a field, or reaching it with Tab, starts typing there. Tabbing onto the canvas starts typing in its first element if that's a field.
- Every keystroke writes the field's `bind=`, so filters, counts and greetings update as people type. While an input method is composing, the value is written when the text is finished.
- Enter runs the field's `on=`. Tab and Shift+Tab move to the next or previous element, typing in it if it's a field. Escape stops typing.
- `kind=` picks the input type: `email` and `password` get the right autofill, `number` a number keyboard and a number (or `null`) in state, `search` a search field.
- The `<input>` sits right after the canvas in the page, so Tab from the last element leaves the canvas as it would from any field. It follows the field through scrolling, resizing and layout changes.

A password's value is still state: it reaches your app through `change` events like any form value.

## How it works

```
spec text → parse → tree → layout → boxes → paint → canvas pixels
                               ↑                       │
             state ←── actions ←── pointer / keyboard ─┘
```

1. **Parse** (`src/parser.ts`). Each line becomes a node, and indentation decides its parent. Props are checked against the component definitions, and problems become diagnostics. While streaming, the unfinished last line is ignored.
2. **Layout** (`src/layout.ts`). Each component sets its own height given a position and width. Containers place their children: `column` and `card` stack them, `row` splits the width equally and centers them. The result is a box (`x, y, width, height`) for every element. Layout only needs a text measurer, so it runs without a canvas and is unit-tested.
3. **Paint** (`src/engine.ts`). The boxes are walked in order and each component draws itself with canvas calls, using colors from the theme. Interactive components register their boxes as hit regions while painting.
4. **Input**. A click or key press is matched against the hit regions, the component's actions run, state changes, and the pipeline runs again.

Each stage only reruns when its inputs change: editing the spec re-parses, a state change re-lays out, and hovering only repaints. A typical screen renders in well under a millisecond.

## Debugging

Browser DevTools can't see inside a canvas, so SayShape ships its own tools. All of them are available in the playground and from code.

| Tool | How to use it | What it shows |
|---|---|---|
| Layout boxes | `ui.inspector.setBoxes(true)` | Every box, with its type and size |
| Hit regions | `ui.inspector.setHits(true)` | Exactly what is clickable |
| Inspect mode | `ui.inspector.setInspecting(true)` | Hover to highlight, click to select. The playground jumps to the spec line, and putting the cursor on a spec line selects its element |
| Describe | `ui.inspector.describe(node)` | A node's type, line, props and box |
| Frame capture | `await ui.inspector.captureFrame()` | Every canvas call made in one frame |
| Console | `ui.expose()` | Puts the instance on `window.sayshape`: `sayshape.tree`, `sayshape.boxes`, `sayshape.state.snapshot()`, `sayshape.find("button")` |

To find a bug, first decide which stage it's in:

- **An element is missing or wrong:** check `ui.diagnostics` and `ui.tree` (parse).
- **Wrong position or size:** turn on layout boxes (layout).
- **The box is right but it looks wrong:** capture a frame (paint).
- **A click does nothing:** turn on hit regions (input).

## Theming

Components never use literal colors or sizes. They read design tokens from the theme: `colors`, `space`, `radius`, `font`, `text` sizes and `control` height. SayShape ships `lightTheme` and `darkTheme`, and with `theme: "auto"` it follows the page's light or dark mode.

With `theme: "auto"`, you can override colors from CSS with `--sayshape-*` variables on the canvas or any ancestor:

```css
canvas {
  --sayshape-accent: #6D28D9;
  --sayshape-on-accent: #FFFFFF;
}
```

Charts color their series and pie slices with six categorical tokens, `series1` to `series6` (`--sayshape-series-1` to `--sayshape-series-6` in CSS). `series1` is the accent: change only the accent and it follows. The defaults are checked against the card surface in both modes, and the first four stay distinguishable with protanopia and deuteranopia.

Cards and buttons sit on a soft shadow in the `shadow` color (`--sayshape-shadow`), a low-opacity color such as `rgba(16, 24, 40, 0.07)`. Set it to `transparent` for a flat look. An open dialog dims the screen behind it with `scrim` (`--sayshape-scrim`), dark in every theme.

Or build a theme in code:

```ts
import { extendTheme, lightTheme } from "sayshape";

const brand = extendTheme(lightTheme, {
  colors: { accent: "#6D28D9" },
  radius: { md: 6 },
});
ui.setTheme(brand);
```

### Trying styles in the playground

The playground's **Appearance** button opens a small panel for previewing the current screen in another style, and copying the setup into your app. It only changes the playground's theme, through `ui.setTheme`: the spec, state, selections and any open list or calendar stay as they are, and no model is asked again.

- **Style:** Teal (SayShape's default), Purple, Blue or Neutral, each with matching light and dark colors. Neutral is grey, with firmer field and divider lines so controls stand out.
- **Mode:** Light, Dark, or System, which follows the operating system as it changes. The page around the canvas follows too.
- **Accent color:** a color picker and a hex field (`#rgb` or `#rrggbb`; half-typed or invalid values aren't applied). SayShape uses the accent as text and strokes and as the fill behind button labels, so a color that's too close to the background is darkened (light mode) or lightened (dark mode) just enough to reach 4.5:1 contrast, and the panel says what it shows instead. The color you asked for is kept, so each mode adjusts it on its own. The label color on the accent is picked automatically. **Reset color** goes back to the style's accent; **Reset appearance** goes back to SayShape's default.
- **Copy theme code** copies TypeScript that recreates what you see with `extendTheme`, `lightTheme`, `darkTheme` and `ui.setTheme`, using the colors actually shown (after any adjustment). For Light or Dark it sets one theme; for System it exports both and a `followSystemAppearance(ui)` function that returns a cleanup. If the clipboard isn't available, the code appears in a box to copy by hand.
- The choice is saved in your browser (`localStorage`, key `sayshape-playground-appearance:v1`): the style, the mode and the accent you asked for, nothing else.

The styles change colors only, through the same theme tokens every component reads; they're a playground feature, not part of the SayShape language, so models still can't choose colors. Teal, Purple and Blue keep SayShape's default field and divider lines, which are lighter than the 3:1 that WCAG asks of control boundaries; Neutral meets it.

## Accessibility

A canvas is one picture to assistive technology, so SayShape keeps a hidden **accessibility mirror** beside it: an invisible DOM element over each element it draws, with a role, a name and a state, kept in step as the screen changes. Screen readers, keyboards and phones' touch exploration work through it. The plan and its design are in [`docs/plans/accessibility.md`](plans/accessibility.md).

- **Every element describes itself**: buttons, links, checkboxes, switches, radios (grouped by `bind=`), sliders and steppers with their values, text fields with what's typed, headings, images by their description, lists, tabs, breadcrumbs, pagination, tables with headers and sort order, and select and date-picker as comboboxes whose open list reads the highlighted option.
- **Charts and maps have text alternatives**: a summary worked out from the data ("3 items. Highest: Mar, $1,600. Lowest: Feb, $900.") and the numbers as a table; a map lists its places.
- **Keyboard**: Tab moves through everything you can press, Enter and Space press, arrows work inside sliders, selects, date pickers, tables and segmented controls, Escape closes popups. DOM focus follows, so screen readers announce where you are.
- **Announcements**: `notify:` messages, new screens, and "Ready" once a streamed screen has arrived (the interface is marked busy while it streams or data loads).
- **Names**: controls are named by their quoted text, or by the text just above them; `label=` names a segmented control, a rating or a meaningful icon. The model guide asks for labels and chart titles.
- **Beyond screen readers**: text, focus and control-outline colors meet WCAG AA contrast in light and dark; Windows Contrast Themes (forced colors) redraw everything in the person's own colors; reduced motion turns animation off; small targets are at least 24 px tall; longer `notify:` messages stay up longer.

```js
canvas.setAttribute("aria-label", "Trip planner");                        // what the whole interface is called
const sayshape = new SayShape(canvas, { components: coreComponents });   // the mirror is on by default
// new SayShape(canvas, { components: coreComponents, accessibility: "off" }) turns it off
```

In tests, `render(spec).accessibility()` shows the screen as a screen reader gets it, `ui.announcements` what it was told, and `ui.mirror` sends a screen reader's actions; the visual suite runs [axe](https://github.com/dequelabs/axe-core) on every sample. Automated checks can't prove WCAG conformance on their own: [`docs/accessibility-testing.md`](accessibility-testing.md) is a short manual pass with VoiceOver and NVDA to run before claiming it. Still to do: reaching the map by keyboard.

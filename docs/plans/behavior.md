# Plan: behavior (rules that tick, shapes people drag)

**Status:** plan for review (2026-11-11). Nothing is built yet.
**Scope:** experimental and opt-in. A host turns it on with one option. With it off, the language, the parser's output and the guide stay byte for byte what they are now.
**Validation:** to come, in `behavior-validation.md`, written the same way as [interactive-scenes-validation.md](interactive-scenes-validation.md).

## Why

Today a spec is a picture of state. A scene's motion is a pure formula of `t`, so nothing can build up over time. Shapes can be pressed but not dragged. That rules out timers, simulations, small games, and explainers people work with by hand. Those are the main things models use HTML and JavaScript for. This plan is a bounded answer to that, with no route to running code.

## What the code does today (read, not assumed)

| Area | What's there | What it means here |
|---|---|---|
| Top-level lines (`src/parser.ts`) | `state` and `derive` are recognized by their first word before tokenizing. An indented one is read as top level, except a `derive` inside `each`, which is skipped with a warning. Today a line starting `every` is an error: `Unknown element "every"`. | A rule line can be parsed in the same place, behind a flag, before tokenizing. With the flag off, nothing changes, including that error. |
| Actions (`src/actions.ts`) | `parseActions` → `runActions(actions, host)`. Each `host.set` writes to the `Store` immediately, and `host.scope` reads the store live. **`dec` never goes below 0** (`Math.max(0, cur - by)`). `inc` takes a negative or fractional `by`. | Chained writes already see each other's results (`inc:vy:…;inc:y:{vy}` uses the new `vy`). A rule can reuse the same runner with a host that has no `emit`, `go`, `back` or `notify`. |
| The screen lives in state (`engine.ts`, `SCREEN_KEY = "screen"`) | `go:` writes `state.screen`, and `syncScreen` reads it back. | **Any write to `screen` navigates**, so a rule doing `set:screen:pay` would change the screen on a timer. Rules must refuse that name, both when parsed and when run. |
| State changes (`state.ts`, `engine.ts`) | `Store.set` notifies listeners; the engine emits `change` and calls `invalidate("layout")`. `requestAnimationFrame` merges several writes into one frame. `declare` keeps a changed value while a spec re-parses, unless its `state` line now says something different. | One tick costs about one whole-screen re-layout and repaint. The request gives about 3.9 ms at 1,001 elements and 20 ms at 5,005 (`bench/engine.bench.ts`), which I'll re-measure in step 3. While a spec streams, re-parsing doesn't undo what a rule wrote. |
| Clock (`engine.ts`) | `now()` is `performance.now()`. Scene `t` is `ctx.now` minus when the scene first painted (`sceneTime`). A scene asks for the next frame with `ctx.requestFrame()`. No timers exist anywhere. The engine does nothing when a tab is hidden: animation frames simply stop. | There's no clock to inject. `sayshape/testing` runs with `animate: false`, so scene motion can't be tested at a chosen time either (`test/scene.test.ts` builds a fake paint context instead). |
| Reduced motion | `animate` defaults to off under `prefers-reduced-motion`. Scenes then draw a still frame, the end of their animation. | Rules aren't motion by themselves (a countdown still has to count), but what they move is. |
| Spec lifecycle | `setSpec` re-parses. `beginStream` clears state (unless `keepState`) and parses only whole lines. `endStream` re-parses. `destroy` runs its cleanup list. | There are clear points to start and stop rules: when a spec is complete, when it's replaced, and when the engine is destroyed. |
| Drag (`engine.ts`, `component.ts`) | `ComponentDef.drag` belongs to the **whole element**. On pointer down, any region of an element whose definition has `drag` starts a drag, and that element is never pressed on release. Pressing Enter on it does nothing unless it defines `press`. `board` shows how to mix the two: it defines `drag` and treats a drag that didn't move as a press (`DRAG_SLOP` 4). The engine's `TAP_SLOP` is 4. | **Blocker for a scene:** a scene is one element with many pressable parts. If `scene` defined `drag`, every pressable shape would stop pressing. Dragging has to be decided per region. |
| Writes from a part (`PressContext`) | `run(actions, own)` takes the drawn copy's scope and its `locate` (the scene's `each` item). `set(path, value)` doesn't. | **Blocker:** a drag inside a scene's `each` has to write `p.x` through its copy. `set` needs the same optional `own` that `run` has. |
| Touch (`engine.ts`) | `canvas.style.touchAction = "pan-y pinch-zoom"` (the request says `pan-y`; it's `pan-y pinch-zoom`). The browser takes vertical swipes and sends `pointercancel`; drags end with `cancelled`. A `touchmove` listener (not passive) already calls `preventDefault` to scroll a `scroll` element under the finger. | A vertical drag on a phone scrolls the page today. The fix can reuse that `touchmove` path: claim the touch when it starts on a shape that moves up or down. Only a real phone can confirm this works. |
| Scene parts (`src/components/scene/`) | `paintScene` tracks the transform matrix `m`. Each pressable line records its outlines, scope, `locate`, `on=`, `selected=`, `tip=` and `name=` per frame (`SceneRegion`), with one `addHit` per line. The region's key comes from the line id, its `each` copy (`key=` when given) and its `use`. `hitTest` is exact. `semantics` returns a `figure` whose parts are buttons. Group `x`/`y`, `use x`/`y`, and the `x`/`y` of `rect`, `circle`, `ellipse` and `label` are numbers or formulas. `line`, `path` and `polygon` have no single position. | A draggable line can record what a pressable one does, plus the inverse of its parent's matrix and which state its `x` and `y` read. Its region is the same kind. |
| Screen readers (`src/a11y/`) | The mirror is rebuilt after every frame that ran layout, compared by key. Scene regions that only move are refreshed at most every 250 ms (`REGION_REFRESH_MS`). The value in a `stepper` is a `status` part, which is a polite live region: a change to it is read out. Announcements come only from `notify:`, a new screen, and "Ready". | A rule that ticks every 50 ms would rebuild the mirror 20 times a second. If it changes a stepper's value, it gets announced on every tick. Both need throttling. |
| Hosts | The MCP view calls the host only on `action` events (`emit`). It never forwards `change` events. The website's playground and hero listen to `change` to flash or count keys. | Rule writes reach hosts as `change` events only. A rule can't reach the model, because rules can't emit. Hosts that count changes will count ticks. |
| Guide (`src/prompt.ts`) | The guide is built from component definitions. Scene shapes list their props on every shape (`PRESS_SHAPE` is the short form). `test/fixtures/guide-full.txt` is core plus map, without scenes. | A drag prop costs tokens once per shape that has it, so it must be one short prop. Scene guides have no fixture today: I'll record one from main before changing anything, so "behavior off, scenes on" is checked too. |
| Models | No model endpoint is configured in this environment (no `.env.local`, no keys). | The eval numbers will be "not measured" unless one is provided. |

## How a host turns it on

There's one flag, `behavior: true`, passed through the places that already have to agree for scenes:

- Engine: `new SayShape(canvas, { components, behavior: true })`.
- Parser: `parse(src, registry, { behavior: true })`. The engine passes this itself.
- Guide: `languageGuide(registry, { behavior: true })`.
- Testing: `render(spec, { behavior: true, components })`, which also gives `ui.clock` (see the test clock below).
- MCP: `--behavior`. As with `--scene`, the server's parser and docs and the view must agree.
- Playground: `?behavior=1`.
- The website's chat page: **not in this change**. It stays off until the validation report says yes.

Rules work without scenes: a countdown with a `stat` and a `button`, or stock running down shown in a chart. Dragging only exists inside scenes, so it needs both `--scene` and `--behavior`.

The scene's drag prop is defined once and tagged `PropDef.needs: "behavior"`. The parser's prop check, the "Known props" list, both guide modes and the docs leave tagged props out unless the flag is on. This keeps the scene definitions the same object in both modes, and puts the gating in three one-line filters. The rule runner lives in `src/behavior.ts` (core), and the engine only creates it when the spec has rules. I'll report how much it adds to the core bundle. If it's more than about 2 KB gzipped, I'll move it behind a `sayshape/behavior` entry point, the way `map` and `scene` work.

## 1. Rules that tick

### Syntax

```
state running=false left=60
every 1s if={running && left > 0} do=dec:left
```

- One line, top level: `every <interval> [if={condition}] do=<actions>`. The interval is a number with `ms` or `s`: `every 250ms`, `every 1s`, `every 0.5s`. I read it with a small pattern before tokenizing, then run `tokenizeLine` on the rest for `if=` and `do=`.
- `do=` takes the same action string as `on=`, quoted when it has spaces: `do="inc:vy:{9.8*0.05};inc:y:{vy*0.05}"`. Models will write `on=`, so it's read as `do=` with a warning.
- **Only state writes:** `inc`, `dec`, `toggle`, `set`, `add`, `remove`, `clear`. `emit`, `go`, `back` and `notify` are errors, and the rule is skipped with a message that says how to fix it ("Rules only change state. To tell the app something, put emit: on a button"). A write to `screen`, or to a derived name, is also refused. It's checked when parsed, and again when run (the host the rule runs with has no `emit`, `go`, `back` or `notify`, and drops writes to `screen`), so a rule built some other way still can't reach the app.
- Written indented, a rule is read as top level (as `state` is). Inside `each`, it's skipped with a warning, as `derive` is: a rule belongs to the screen, not to one item.
- A rule reads state and derived values with the core functions only. It gets no `t` and no scene functions.

**Streaming:** a rule is one line, so it needs nothing to close it. Any prefix of a spec, cut at a line boundary, is either missing the rule or has all of it. A half-written last line is already ignored (`partial`). A streaming test checks every prefix of every new sample, as `test/streaming` does today.

### When rules run

- **Not while a spec is streaming.** Rules are parsed and checked as lines arrive, but they start only once the spec is complete (`endStream`, or `setSpec`). The `state` line a rule needs may come after it, and a half-built screen shouldn't change by itself while it's still `aria-busy`.
- **A rule is armed when its condition turns true.** The engine re-checks each rule's `if=` after state changes (at most 8 expressions, and only when the spec has rules). When a condition goes from false to true, the first tick is one interval later: pressing Start on a 1 s timer always gives a full first second. When it goes from true to false, the rule stops. With no `if=`, it's true from the start.
- **Order and visibility:** rules due at the same moment run in the order they're written, in one batch. Writes within a tick, and across rules in the same batch, see each other's results, exactly as chained `on=` actions do. The whole batch leads to one layout and one paint.
- **They stop** on `setSpec` or `beginStream` (refining a spec stops them, and they start again at `endStream`) and on `destroy`. On a re-parse where the set of rules hasn't changed (an unrelated line was edited), they keep their timing.
- **No catch-up.** The next tick is `max(due + interval, now)`, so missed ticks are dropped, never run in a burst. Rules pause while `document.hidden` and continue one interval after the page shows again. Time in a spec is counted in ticks, not by the wall clock. A countdown pauses while its tab is hidden. That's deliberate, and the guide and docs say so.
- **While a person drags a shape**, a rule's write to the value being dragged is skipped. A tick never fights the hand. Other writes go ahead.

### Limits

| Limit | Value | When it's passed |
|---|---|---|
| Shortest interval (`MIN_RULE_INTERVAL`) | 50 ms (20 ticks a second) | Raised to 50 ms, with a warning. |
| Longest interval | 60 s | Lowered to 60 s, with a warning. |
| Rules per spec (`MAX_RULES`) | 8 | The rest are skipped, with a warning. |
| Actions per rule (`MAX_RULE_ACTIONS`) | 8 | The rule is skipped, with a warning. |
| A list grown by a rule's `add:` | 500 items (what `each` shows) | That `add` is skipped, with one warning. Lists can't grow without bound. |
| Work per tick | When a tick and the frame it causes take, on average over 20 ticks, more than a quarter of the shortest interval… | …every interval is doubled and the engine warns once ("rules slowed to every 100 ms: each tick took 30 ms"). |
| Catch-up ticks | None | (see above) |

All work is bounded by how a rule is built: no loops; a rule never starts another rule (rules run only on their timer, never in response to a write); at most 8 × 8 actions per tick, each a bounded expression. The timing guard covers the one thing that structure can't, which is one large expression run often.

### Pausing, reduced motion, screen readers

- **People must be able to stop it** (WCAG 2.2.2). A spec check warns about a rule whose `if=` reads no state that a control in the spec writes (`bind=` or `on=`): "Nothing on the screen can stop this rule. Add if={running} and a button on=toggle:running." The guide teaches that pattern. On top of that, hosts get `sayshape.pauseRules()`, `resumeRules()` and a `rules` event (`{ count, running, paused }`). The MCP view and the playground show Pause and Resume in their toolbars when a spec has rules. That's host UI, not drawn by the engine.
- **Reduced motion:** nothing starts by itself. Rules wait until the person first presses or types something in the interface, then run as written. A countdown with a Start button works exactly as usual. A ball that bounces as soon as it loads waits. Scene `t` motion stays a still, as today. The engine never smooths a value between ticks in any mode: positions jump from tick to tick.
- **Screen readers:** a tick never announces anything (rules can't `notify`). A mirror rebuild caused only by rules happens at most once a second. It happens at once when the person acts, or when a rule stops. In a rebuild caused only by rules, `status` parts (a stepper's value) are updated with `aria-live="off"`, so they're current when someone reads them but aren't read out on every tick. `sayshape/testing` records whether an update was quiet. A rule ending isn't announced: a spec that needs "Time's up" read out shows it in an element, which is read when reached. That's a known limit.

## 2. Dragging in scenes

### Syntax

One boolean prop, `drag=true`, on `rect`, `circle`, `ellipse`, `label`, `group` and `use`, the elements with an `x` and `y`. A line's `x` and `y` say what it moves:

```
state px=300 py=150 u=120
scene w=600 h=300
  circle x={px} y={py} r=12 fill=accent drag=true name="Point"
  circle x={clamp(u, 40, 560)} y={160 - 80*sin(u/60)} r=10 fill=bad drag=true name="Point on the curve"
  each items=pins as=p key={p.id}
    group x={p.x} y={clamp(p.y, 20, 280)} drag=true
      circle x=0 y=0 r=8 fill=ink
```

- An axis moves when its prop is exactly `{name}` or `{path}` (`{p.x}`), or `{clamp(name, lo, hi)}` with bounds that may be formulas. Any other formula holds that axis still. This gives a point on a curve (`x={u}`, `y={f(u)}`) and a vertical handle (`x=100 y={level}`) with nothing new to learn. The drawing can never disagree with the state: the line is drawn from the value the drag writes. `clamp` is already a scene function.
- With no `clamp`, an axis is kept inside the picture (`0…w`, `0…h`, mapped into the line's parent coordinates). The value written is the pointer's place in the parent's coordinates (through the inverse of the parent matrix, so turned and scaled groups work), less where it was grabbed, clamped, and rounded to a power of ten no larger than 1/500 of its range (whole units on a 600-wide scene).
- `drag=true` with neither axis able to move is a warning that shows the two forms. Writing to a `use` argument, or to an item from a list that isn't in state, gets the same warning as `on=` gets today.
- A pressed draggable shape that didn't move (`TAP_SLOP`) runs its `on=`, so an item can be both selected and dragged. `selected=`, `tip=` and `name=` work as they do now.
- Draggable items in `each` find their item again on every move by the region's key. An `each` over a list worked out from state (sorted or filtered) needs `key=`, and the check warns when it's missing.

### Engine changes (optional, backward compatible)

1. `addHit(box, { detail, drags })` and `HitRegion.drags`. An element drags when `def.drag && region.drags !== false`. The scene defines `drag` and passes `drags: false` for its press-only parts, so they press exactly as they do now. Every other component passes nothing and behaves as before.
2. `PressContext.set(path, value, own?)`, taking the same `own` as `run`, so a drag writes through a scene's `each` copy.
3. Touch: when a touch starts on a region that drags up or down, the existing non-passive `touchmove` listener calls `preventDefault` from the first move, so the page doesn't take it. Shapes that only move sideways leave vertical swipes to the page, the same as sliders today. A cancelled drag (the browser took the gesture) puts the starting values back, as `board` does.

### Keyboard and screen readers

- Each draggable shape is a Tab stop (they're already regions with a `detail`). Arrow keys move it by 1/50 of each axis's range, Page Up and Page Down by 1/10. For a one-axis shape, Home and End go to the ends. Enter and Space run its `on=`. Keys a shape doesn't use fall through, as they do now.
- To a screen reader, a one-axis shape is a `slider` with its value, minimum and maximum, so the mirror can use a native range input on phones. A two-axis shape is a part with the role description "movable", its name, and the description "x 120, y 80; arrow keys move it". Both are parts of the scene's `figure`. Values update at the same throttled rate as above.
- A drawing check is added (a warning, like the others): draggable shapes that move up or down and cover more than a third of the picture at phone width, because they'd trap page scrolling on a phone.
- At most 50 draggable regions per scene (`MAX_DRAGGABLE`). Past that, shapes aren't draggable, with a warning, so Tab order stays usable.

## 3. Test clock

`SayShapeOptions.clock?: { now(): number; setTimeout; clearTimeout }`, which defaults to the real ones. The engine's `now()` for scene `t`, the fade-ins and the rule timers all go through it. `render(spec, { behavior: true })` installs a manual clock: `ui.clock.advance(ms)` runs every tick due in that time, in order, then `flush()`. `render(spec, { animate: true })` lets a test draw a scene at a chosen `t` the same way. No test waits on real time.

## The gate

| Improvement | Feasible today? | Existing capabilities to reuse | Required changes | Risks | Recommendation |
|---|---|---|---|---|---|
| Rules that tick | **Yes** | `parseActions`/`runActions`, live store writes, `derive`, the dirty-stage pipeline, diagnostics | A rule line behind `behavior` in the parser; `ParseResult.rules` (present only when on); `src/behavior.ts` runner; engine option and lifecycle hooks; a guide section; quiet mirror updates; MCP flag | CPU (a whole re-layout per tick); motion that can't be stopped; screen reader flooding; writing `screen` | **Go**, with the limits, the stoppable check, reduced motion waiting, and refusing `screen` |
| Dragging in scenes | **Yes, after two small engine hooks** | Scene regions, exact `hitTest`, `drag` phases, `own` writes, `clamp`, the slider's semantics, `board`'s tap or drag | `HitRegion.drags`; `set(path, value, own?)`; claiming vertical touches; draggable lines recording their inverse matrix and targets | Trapping page scroll on phones; a fast drag re-laying out the screen on every move | **Go**, scoped to `drag=true` driven by `x`/`y`, in scenes only |
| Test clock | **Yes** | `now()` already in one place | `clock` option; `ui.clock` | None found | **Go** |
| Rules that change items one by one (a particle per item) | **No** without a map or loop | Formulas of a tick counter in a scene `each` | Would need `map` over lists | It's a loop by another name | **No-go.** Simulations of many items use a counter: `every 50ms do=inc:step`, with positions as formulas of `step` |

### The questions

1. **Without rewriting the engine?** Yes. There's one new top-level line, one prop, two optional parameters on existing hooks, a clock option, and the runner.
2. **Reuse state and actions?** Yes. `do=` is an `on=` string with fewer operations allowed, and a drag writes through the same path writer as `bind=`.
3. **Backward compatible?** Yes. With the flag off: the same parse (a test deep-compares the corpus parsed with and without the flag off), the same guide (`guide-full.txt`, plus a new scene guide fixture recorded from main first), and `every` is still an unknown element.
4. **Optional?** Yes. It's one host flag, off by default everywhere. The website's chat page stays off.
5. **Model tokens?** Per spec, about 15–25 per rule and 3 per draggable shape. In the guide, my estimate: full mode about +220 for the rules section and about +70 for `drag` on six shapes, so under 300; compact about +60 and about +20, so under 100. I'll measure with `npm run guide:size`.
6. **Performance or memory?** With no rules, the cost is one array-length check per state change, and no timers. With rules, each tick costs about one state change (a whole re-layout). I'll measure in step 3 with new `bench/engine.bench.ts` cases: one rule every 50 ms on screens of 1,001 and 5,005 elements, a scene with 200 shapes driven by a counter, and a drag move on the factory monitor. Plus heap over 4,000 ticks.
7. **Accessibility?** Rules are stoppable (a spec check, the guide, host Pause), wait under reduced motion, and are quiet to screen readers. Draggable shapes are Tab stops, sliders or "movable" parts with arrow keys, and have a tap-to-press fallback.
8. **Simpler solution?** For rules, a host could push state with `sayshape.state.set` on its own timer, but a model can't ask for that, which is the point. For motion that repeats, scene `t` remains the simpler and cheaper answer, and the guide says to prefer it when nothing has to build up. For dragging, a `slider` outside the scene bound to `u` already moves a point and stays the right answer for one value. Dragging is for when the drawing itself is the control.
9. **Explicitly not built:** loops, `map` or functions of a spec's own; rules inside `each` or one per item; rules that emit, navigate, notify or change `screen`; catch-up ticks; smoothing between ticks; any physics or collision library; network access; drag and drop between ordinary elements, drop targets or "dropped" events; multi-touch and pinch; rotating or resizing handles; dragging `line`, `path` or `polygon` directly (put them in a `group`); anything in HTML; turning it on for the website's chat page.

## What step 2 touches

In the order "How to change the language" in `CLAUDE.md` gives:

1. `src/parser.ts`: the rule line, `ParseOptions.behavior`, `ParseResult.rules`, and filtering props tagged `needs`.
2. Checks: interval, the operations allowed, writes to `screen` and derived names, the limits, the stoppable check, `on=` read as `do=`, and `drag=true` with no axis that can move.
3. `src/prompt.ts`: a rules section and the `drag` prop description, only when `behavior` is on.
4. Tests: rules, streaming of rule lines, sandboxing (a rule can't emit, navigate, write `screen` or run unbounded work, even one built by hand), the clock, dragging (pointer, keys, touch claim, cancel, in `each` with `key=`), quiet mirror updates, and that nothing changes with the flag off.
5. `docs/language.md`, then `docs/engine.md` and `docs/limitations.md`.
6. Old specs: unchanged.

Then `src/behavior.ts`, the engine hooks, scene drag (`src/components/scene/`), `sayshape/testing`, the MCP `--behavior` flag, the playground `?behavior=1` flag, four playground samples (a countdown, a falling ball, a draggable point on a curve, stock running down with Play and Pause), bench cases, and the eval cases (`eval/picks.ts` traps with scenes and behavior on; `eval/scenes.ts` cases that need a timer, a simulation and a drag).

## What I need from review

1. **The rule syntax:** `every 1s if={…} do=…`, with `on=` accepted with a warning.
2. **Rules under reduced motion** wait for the first press or key. The alternative is running them as written and relying on Pause.
3. **Countdowns pause in a hidden tab** (ticks, not wall time). That follows from "no catch-up burst".
4. **The 50 ms floor** and the timing guard. A falling ball at 20 ticks a second looks stepped, not smooth, on purpose.
5. **`drag=true` driven by `x`/`y`**, rather than props that name targets and bounds.

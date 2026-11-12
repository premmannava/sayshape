# Behavior: validation report

**Date:** 2026-11-11. **Scope:** the experimental, opt-in behavior layer ([plan](behavior.md)): `every` rules that change state on an interval, and dragging shapes in scenes. **Question:** does it do what the plan says, safely, without costing anything when it's off, and fast enough to keep a 16 ms floor?

**Short answer:** yes, for what could be checked here. Off, nothing changes: the corpus parses identically, and the core and scene guides are byte for byte the same. On, rules only write state, never fight the person, pause out of sight, never run a burst, and a slow-down guard holds the main thread back on heavy screens. All four samples work in Chrome at desktop and phone width, in light and dark, with a real mouse drag. On an ordinary screen a rule ticking every 16 ms takes about 3% of the time, so the 16 ms floor stays. **Not measured:** model evals (skipped for this change, and no endpoint was available), real phones (the vertical-drag fix), and real screen readers.

Everything below was measured, in the environments listed. Anything worked out from measurements says how; nothing is estimated unless it says so.

## Environments

| What | Where |
|---|---|
| Node tests and benches | Node 22.23.4, Vitest 2.1.4, the recording canvas from `sayshape/testing` |
| Browser | Chrome 153.0.8010.12, headless, through Playwright 1.56.1 |
| Machine | Linux VM, Intel Xeon @ 2.10 GHz × 2. It's slower than the machine behind the request's figures: a state change at 1,001 elements measured 10–13 ms here, against the 3.9 ms the request gives. Compare rows within this report, not with figures from elsewhere |
| Models | none available: model evals are not measured |
| Phones, screen readers | none available: not measured |

## Checklist ("Before you say a change is done")

| Check | Result |
|---|---|
| `npm run typecheck` | passes |
| `npm test` | 110 files, 4,374 tests pass. 50 are new in `test/behavior.test.ts` and 2 in `test/expr.test.ts` |
| `npm --prefix mcp test` | 13 files, 149 tests pass. MCP Apps results are unchanged without `--behavior` |
| `npm run build` | passes |
| `npm run docs:check` | `docs/components.md` up to date (`drag=` is hidden while behavior is off) |
| Looked at in light and dark | the four samples, in Chrome, at 1280 and 360 px wide (below) |
| Spec examples parse cleanly | the four samples have no diagnostics and pass the drawing check (a test) |
| Visual baselines | not updated: nothing changes with behavior off |

## What the tests cover

- **Off is unchanged.** `every` is still `Unknown element "every"`. `drag=` is an unknown prop, missing from the "Known props" list. Every corpus spec parses to an identical result with the flag off, and has no `rules` key. `guide-full.txt` is unchanged, and new fixtures `guide-scene-full.txt` and `guide-scene-compact.txt` (recorded from main before any change) match. No draggable regions, no timers.
- **Rule lines.** Intervals in `s` and `ms` are kept within 16 ms to 60 s silently, and `on=` is read as `do=` silently. A rule with no interval, no `do=`, or a condition that doesn't parse is skipped. Each of these is refused: `emit`, `go`, `back`, `notify`, and writes to `screen`. Limits: at most 8 rules and 8 actions each. Warnings: a rule nothing can stop, a write to a dialog's `bind=`, a write to a derived value, a name nothing defines. A rule is read at the top level from anywhere except inside `each`. Rules get the scene math and nothing more. Every prefix of every sample parses with no errors.
- **Running.**
  - It starts one interval after its condition turns true, pauses with it, and stops by itself.
  - Chained actions see each other, and rules due together run in written order.
  - Missed ticks never come as a burst.
  - It doesn't run while a spec streams, stops when the spec is replaced, keeps its timing across unrelated edits, and stops on `destroy`.
  - With reduced motion, it waits for a first key.
  - It never writes a field being typed in, a dialog's `bind=`, or a value being dragged.
  - It can't grow a list past 500 items.
  - Screen readers hear nothing per tick: the mirror is rebuilt at most about once a second while ticking, quietly, and normally once the rule stops.
- **Sandbox.**
  - A rule built by hand with `emit`, `go`, `notify` and `set:screen` emits nothing, stays on the same screen, and announces nothing.
  - Escape attempts (`constructor.constructor(…)`, `__proto__`, `this`, `globalThis`, `sin.constructor`) produce no function and no event.
  - A rule doesn't run another rule in the same tick, so work per tick is bounded.
  - `test/expr.test.ts` tests the rule functions against the same escape attempts as the core ones.
- **Slow-down guard.** With an expensive 16 ms rule beside a 1 s rule, the floor goes up and the 1 s rule stays within 20 ms of 1 s. Cheap ticks keep 16 ms.
- **Test clock.** A scene is drawn at a chosen `t` (`render(…, { clock: true, animate: true })`).
- **Dragging.**
  - The shape moves the state its `x=` and `y=` read, keeps the point where it was grabbed, and stays inside the picture.
  - Only axes written as a name move, within `clamp()`'s bounds.
  - It follows the pointer through a group's move, turn and scale.
  - An item in a scene's `each` is written back into its list.
  - A tap without movement presses `on=`, and a cancelled drag puts values back.
  - Shapes that only press keep pressing (`drags: false`).
  - Arrow, Page, Home and End keys work.
  - To screen readers it's a slider moving one way and a "movable" part moving both ways.
  - Only shapes that move up and down take vertical swipes (`claimsSwipe`).
  - Rules don't write over a shape while it's held.
  - Parser warnings: a shape with no axis that can move, and an axis that silently stays still (`y={py + 0}`).
  - The drawing check warns about shapes that would trap page scrolling.
- **Samples.** The countdown runs to 0 and shows its callout. Stock runs down to 0, and Restock resets the list. The ball speeds up, lands and bounces. The point goes to its end with End.

## Findings and fixes during validation

| # | Found | How | Fixed |
|---|---|---|---|
| F1 | The slow-down guard doubled the floor once per 20 ticks, so on the 5,005-element screen it took about 3 s of a saturated main thread to reach a floor that fit | Browser bench | It now raises the floor in one step, to the fastest interval doubled until a tick fits a quarter of it |
| F2 | The guard counted only the frame right after a tick. A change that animates (progress bars easing to a new value) costs several frames | Browser bench: the engine was busy about 90% of the time while ticks looked cheap | Every frame between one tick and the next counts toward that tick |
| F3 | The point-on-a-curve sample's point was too small to tap on a phone | The drawing check, in a test | Radius 22 (24 px across on a phone) |
| F4 | The stock sample's Restock wrote `set:history:[…]`, which stores text, not a list | A test | `set:history:{[…]}` |
| F5 | The drawing check called a draggable shape "pressable" | Reading its messages | "this draggable circle is only … px across" |
| F6 | `bench/behavior.bench.ts` imported `bigSpec` from `engine.bench.ts`, which ran the engine benches a second time | Bench output | `bigSpec` moved to `bench/specs.ts` |
| F7 | The browser bench summed `layoutMs` on paint-only frames, where it's the previous layout's | Totals above 100% | The page times `renderNow` itself |
| F8 | The guide added about 340 tokens in full mode with scenes, and about 136 in compact (estimates, characters / 4), over the 300 and 100 aimed for | Measured | Rule text and drag descriptions shortened (below) |
| F9 | While anything was dragged (a slider, a board card), every rule stopped after one tick: a rule's own write during a drag was recorded as held by the person | Review after the report: a rule every 100 ms beside a slider held for 1 s ticked once, not 10 times | Only writes made by the drag itself are held (a test) |
| F10 | The slow-down guard judged ticks against the fastest rule in the spec even when that rule was off, so a 1 s rule at 0.5% busy raised the floor to 32 ms; and the floor never came back down | Review after the report | Ticks are judged against the rules running when they ran, and the floor halves again once ticks take a sixteenth of the interval or less (three tests) |

## Browser verification

The four samples were loaded in the playground (`?scene=1&behavior=1`) in Chrome at 1280 and 360 px, in light and dark (the color scheme emulated, playground set to follow the system). Each was then used through the real pointer path:

- The countdown, stock and ball samples were started with a mouse click on their first button.
- The point was dragged with the mouse from x = 1 to x = −1.5.

After that, state was read back and the canvas captured.

| Sample | State after use | Screenshots (`docs/images/behavior/`) |
|---|---|---|
| Countdown | running, `left` 90 → 88 after 2.6 s | `countdown-{light,dark}-{1280,360}.png` |
| Stock | running, stock 240 → 213 by day 2, 3 points on the line | `stock-…` |
| Falling ball | running, falling (y 40 → 140–229, speed growing) | `fallingBall-…` |
| Point on a curve | `px` 380 → 180 (x = −1.50, slope −3.00), with the tangent following | `pointOnCurve-…` |

Seen while doing it:

- **The out-of-sight pause works.** At 360 px, the sample's canvas sits below the editor. Before it was scrolled into view, `ruleStatus` was `paused: true`; it resumed on scrolling.
- **One press was missed, but not by the engine.** In the first 360 px run, the ball's Drop press didn't land. My script clicked before the canvas had scrolled into place. Run again with the button scrolled into view, it worked in both modes, and a separate probe confirmed the press runs.
- **A stat read mid-animation shows a value in between.** A stat eases to its new value over about 220 ms, so a screenshot taken 200 ms after a drag shows "2.20" or "2.23" for y = x² = 2.25. That's existing easing, not a bug.
- **Layout and colors looked right.** All four render in theme colors in both modes, with no clipped text, and the scenes scale down at 360 px.

## Performance

### Node (`bench/behavior.bench.ts`, means, recording canvas)

| Case | Mean per tick | Share of one core at 16 / 33 / 50 ms |
|---|---|---|
| Countdown sample, a rule tick (rule, layout and paint) | 0.059–0.067 ms | 0.4% / 0.2% / 0.1% |
| 1,001 elements, a rule tick | 7.9–9.2 ms | 50% / 25–28% / 16–18% |
| 5,005 elements, a rule tick | 44.9–52.1 ms | over 100% / about 150% / about 100% |
| 200 scene shapes moved by a counter, a 16 ms tick | 1.09 ms | 6.8% |
| A drag move on the point-on-a-curve sample (write, layout and paint) | 1.84 ms per pointer move | – |

The share is worked out as mean tick time ÷ interval. A tick costs the same at every interval (16, 33 and 50 ms all measured within their noise of ±6–14%), and it costs about what a state change from a button costs on the same screen. In the same run, a state change measured 10.3 ms at 1,001 elements and 64.4 ms at 5,005.

**No cost when unused:** a state change at 1,001 elements measured 12.0 ms (±17%) with behavior off and 12.5 ms (±6%) with behavior on and no rules: the same within noise. With no rules, no runner exists and no timer is set; a test checks that no timers are pending.

### Chrome (`npm run bench:behavior-browser`, 3 s per row, after F1 and F2)

"Host timer" is the control: no rule, with the page writing the same state on its own `setInterval`, as a host can already do. Engine work is everything inside `renderNow` (layout, paint and the screen reader mirror), not the browser's own raster of the canvas.

| Screen (canvas height) | Writes | Every | Ticks/s (wanted) | Frame median / p95 | Engine work per frame median / p95 | Time in the engine | Floor after |
|---|---|---|---|---|---|---|---|
| countdown (252 px) | rule | 16 ms | 63 (62.5) | 16.7 / 16.8 ms | 0.6 / 1.2 ms | 4% | 16 ms |
| countdown (252 px) | rule | 33 ms | 30 (30.3) | 16.7 / 16.8 ms | 0.4 / 1.2 ms | 3% | 16 ms |
| countdown (252 px) | rule | 50 ms | 20 (20) | 16.7 / 16.7 ms | 0.3 / 0.6 ms | 2% | 16 ms |
| countdown (252 px) | host timer | 16 ms | 62.3 (62.5) | 16.7 / 16.7 ms | 0.6 / 0.8 ms | 4% | – |
| ~1,000 elements (29,227 px) | rule | 16 ms | 1.3 (62.5) | 583 / 1000 ms | 19.9 / 32 ms | 4% | 16 ms |
| ~1,000 elements (29,227 px) | rule | 50 ms | 1.7 (20) | 417 / 783 ms | 15.3 / 21.8 ms | 4% | 16 ms |
| ~1,000 elements (29,227 px) | host timer | 16 ms | 1.3 (62.5) | 417 / 750 ms | 16.7 / 20.8 ms | 4% | – |
| ~5,000 elements (145,817 px) | rule | 16 ms | 9.3 (62.5) | 16.7 / 50.1 ms | 20.9 / 46.6 ms | 93% | 256 ms |
| ~5,000 elements (145,817 px) | rule | 50 ms | 8.3 (20) | 16.7 / 33.4 ms | 17.7 / 38.5 ms | 92% | 400 ms |
| ~5,000 elements (145,817 px) | host timer | 16 ms | 10.3 (62.5) | 83.3 / 116.7 ms | 65.8 / 102 ms | 84% | – |

What the numbers say:

- **On an ordinary screen, one frame is cheap.** A rule every 16 ms runs at the full 62.5 ticks a second, with frames on time and about 3% of the time in the engine, on a slow 2-core VM. **The 16 ms floor stays.**
- **At about 1,000 elements, the browser's raster is the limit, for any change.** The canvas is 1,000 × 29,227 px. Every change, rule or host timer, gets about 1–2 frames a second, with the engine itself only about 4% busy. Rules can't make this better or worse, and the guard can't see raster time (it's outside `renderNow`). Chat answers are rarely this tall.
- **At about 5,000 elements, the guard does its job, but 3 s isn't enough to see where it settles.** The canvas is over the browser's size limit, so little is drawn. The guard raised the floor to 256–400 ms within the window, but the engine was still busy about 90% of the time over the 3 s, because the window includes the 20 ticks the guard needs before it acts. The host-timer control was busy 84–88% with slower frames. A longer run, to see the steady state after the guard settles, was stopped at your request.

## Guide size (characters measured; tokens estimated as characters / 4)

| Guide | Added with behavior on | Aim |
|---|---|---|
| Full, core and map | +580 characters (~145 tokens, estimated) | under 300 tokens |
| Compact, core and map | +307 characters (~77 tokens, estimated) | under 100 tokens |
| Full, core and scene | +986 characters (~247 tokens, estimated) | under 300 tokens |
| Compact, core and scene | +389 characters (~97 tokens, estimated) | under 100 tokens |

With behavior off, every guide is unchanged (fixtures).

## Model evaluation

**Not measured.** The eval cases weren't built for this change (asked to skip them), and no model endpoint was available. Two things are still open as a result:

- **Picking:** whether models still pick charts for data with rules and scenes on. Traps in `eval/picks.ts` are still to write.
- **Writing:** whether models write working timers, simulations (including a pendulum) and drags. Cases in `eval/scenes.ts` are still to write.

## Accessibility

**Checked by tests, not by hand:**
- Rule ticks announce nothing, and the mirror is rebuilt at most about once a second, quietly (a status's `aria-live` is off for those updates).
- A one-axis draggable is a slider with its value and range; a two-axis one is a "movable" part that says where it is.
- Arrow keys move both kinds.
- Rules wait under reduced motion.
- A rule nothing can stop gets a warning.
- The MCP view and the playground show Pause motion while a spec has rules.

**Not checked by hand:** VoiceOver and NVDA on the slider and movable parts, and on quiet status updates.

**Known gaps:**
- The end of a rule isn't announced.
- On a shape that moves only up and down, Up moves it up the screen, so its value gets smaller, the opposite of a usual slider.

## Limitations

- **Vertical dragging on phones is not measured.** It uses the same `touchmove` claim the `scroll` element relies on, but only a real phone can confirm it.
- **Rules count ticks, not clock time.** A countdown pauses while hidden or out of sight (in `docs/limitations.md`). Wall-clock time is the first thing to revisit.
- **The slow-down guard can't see browser raster time.** A very tall screen is slow for any change, rules or not.
- **Not wired up everywhere.** Text-only MCP clients don't get behavior (their page uses a pinned engine from before it existed). The website's chat page doesn't turn it on.
- **Model evals and real screen readers: not measured.**

## Go / no-go

**Experimental and opt-in: go.**
- The guarantees held: no route from a rule to the app or the model, no parser throws, and nothing changes with the flag off.
- The samples work in a real browser at both widths and in both modes.
- 16 ms is affordable on ordinary screens.

**On by default: no-go**, until:
- the model evals are run (picks and scenes, with the pendulum);
- vertical drag is tried on a real phone;
- VoiceOver and NVDA pass on draggables and quiet updates;
- the 5,005-element guard has run long enough to see where it settles.

## Reproduce

```bash
npx vitest run test/behavior.test.ts test/expr.test.ts
npx vitest bench --run bench/behavior.bench.ts
CHROME=/usr/bin/google-chrome npm run bench:behavior-browser      # or Playwright's Chromium
# playground: npm run dev, then /playground/index.html?scene=1&behavior=1
```

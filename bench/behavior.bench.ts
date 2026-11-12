/**
 * Behavior benchmarks (docs/plans/behavior.md): what one rule tick costs on
 * a small screen and on the 1,001- and 5,005-element screens of
 * engine.bench.ts, at intervals of 16, 33 and 50 ms; what a drag move costs;
 * and whether turning behavior on costs anything when a spec has no rules.
 *
 *   npx vitest bench --run bench/behavior.bench.ts
 *
 * Each "tick" bench advances the test clock by one interval, which runs the
 * rule (one state write the whole screen reads) and the frame it causes
 * (layout and paint against the recording canvas). The interval doesn't
 * change a tick's work; the share of a second it takes is the tick's mean
 * time × ticks per second (1000 / interval).
 */
import { bench, describe } from "vitest";
import { coreComponents } from "../src/components";
import { sceneComponents } from "../src/components/scene";
import { render } from "../src/testing";
import { bigSpec } from "./specs";
import { COUNTDOWN, POINT_ON_CURVE } from "../playground/behavior-samples";

const ALL = [...coreComponents, ...sceneComponents];
const RULE = (every: number) => `every ${every}ms if={running} do="set:qty:{(qty + 1) % 10}"\nbutton "Stop" on=toggle:running\n`;

/** A rule ticking on a screen: the countdown sample, or engine.bench's order cards. */
function ticking(size: "small" | 1000 | 5000, every: number) {
  const base = size === "small"
    ? COUNTDOWN.replace("every 1s if={running && left > 0} do=dec:left", `every ${every}ms if={running} do="set:left:{left > 0 ? left - 1 : 90}"`).replace("state running=false", "state running=true")
    : bigSpec(size).replace("state qty=2 price=24 gift=false", "state qty=2 price=24 gift=false running=true") + "\n" + RULE(every);
  const ui = render(base, { behavior: true, width: 1024 });
  return ui;
}

for (const size of ["small", 1000, 5000] as const) {
  describe(`rule ticks, ${size === "small" ? "countdown sample" : `${size === 1000 ? "1,001" : "5,005"} elements`}`, () => {
    for (const every of [16, 33, 50]) {
      const ui = ticking(size, every);
      bench(`one tick every ${every} ms (rule, layout and paint)`, () => {
        ui.clock.advance(every);
      });
    }
  });
}

describe("unused: behavior on, no rules", () => {
  const spec = bigSpec(1000);
  const off = render(spec, { width: 1024 });
  const onNoRules = render(spec, { width: 1024, behavior: true });
  bench("state change, behavior off (1,001 elements)", () => {
    off.sayshape.state.set("qty", (Number(off.state.qty) + 1) % 10);
    off.sayshape.renderNow();
  });
  bench("state change, behavior on, no rules (1,001 elements)", () => {
    onNoRules.sayshape.state.set("qty", (Number(onNoRules.state.qty) + 1) % 10);
    onNoRules.sayshape.renderNow();
  });
});

describe("dragging", () => {
  const ui = render(POINT_ON_CURVE, { behavior: true, components: ALL, width: 640 });
  const box = ui.find({ type: "scene" }).box!;
  const at = (x: number, y: number) => ({ clientX: box.x + (x * box.w) / 600, clientY: box.y + (y * box.h) / 320, pointerId: 1 });
  let x = 380;
  ui.canvas.dispatch("pointermove", at(380, 260 - 25));
  ui.canvas.dispatch("pointerdown", at(380, 260 - 25));
  ui.sayshape.renderNow();
  bench("one pointer move on the point-on-a-curve sample (write, layout and paint)", () => {
    x = x >= 520 ? 80 : x + 7;
    ui.canvas.dispatch("pointermove", at(x, 200));
    ui.sayshape.renderNow();
  });
});

describe("a scene of 200 shapes driven by a counter", () => {
  const spec = `state running=true step=0
every 16ms if={running} do=inc:step
button "Stop" on=toggle:running
scene "200 dots" w=600 h=400
  each items={range(200)} as=i
    circle x={30 + (i % 20) * 28 + 6 * sin(step / 10 + i)} y={30 + floor(i / 20) * 36 + 6 * cos(step / 10 + i)} r=8 fill={pick(['accent', 'good', 'warn'], i)}
`;
  const ui = render(spec, { behavior: true, components: ALL, width: 640 });
  bench("one tick every 16 ms (rule, layout and paint)", () => {
    ui.clock.advance(16);
  });
});

/**
 * Scene benchmarks: one frame of the factory monitor, the same scene with
 * nothing pressable, and finding what's under the pointer.
 *
 *   npm run bench -- bench/scene.bench.ts
 *
 * Paint runs against the recording canvas from sayshape/testing, so it
 * measures the engine's and the scene's own work, not the browser's raster.
 */
import { bench, describe } from "vitest";
import { coreComponents } from "../src/components";
import { sceneComponents } from "../src/components/scene";
import { render } from "../src/testing";
import { FACTORY_MONITOR } from "../playground/scene-samples";

const components = [...coreComponents, ...sceneComponents];
/** The same picture with nothing pressable: what scenes cost before interaction. */
const PLAIN = FACTORY_MONITOR.replace(/ on=set:sel:\{mc\.id\} selected=\{sel == mc\.id\} name="[^"]*" tip="[^"]*"/, "");

/** A scene with many pressable shapes, near what a model might draw for a network map. */
const MANY = `state sel=0
scene "200 nodes" w=1000 h=600
  each items={range(200)} as=i
    circle x={30 + (i % 20) * 48} y={30 + floor(i / 20) * 58} r=16 fill={sel == i ? 'accent' : 'line'} on=set:sel:{i} tip="Node {i}"`;

describe("scene frame", () => {
  const pressable = render(FACTORY_MONITOR, { components, width: 1000 });
  const plain = render(PLAIN, { components, width: 1000 });
  const many = render(MANY, { components, width: 1000 });
  const manyPlain = render(MANY.replace(/ on=set:sel:\{i\} tip="Node \{i\}"/, ""), { components, width: 1000 });

  bench("factory monitor, 4 pressable machines", () => {
    pressable.sayshape.invalidate("paint");
    pressable.sayshape.renderNow();
  });
  bench("factory monitor, nothing pressable", () => {
    plain.sayshape.invalidate("paint");
    plain.sayshape.renderNow();
  });
  bench("200 pressable circles", () => {
    many.sayshape.invalidate("paint");
    many.sayshape.renderNow();
  });
  bench("200 plain circles", () => {
    manyPlain.sayshape.invalidate("paint");
    manyPlain.sayshape.renderNow();
  });
});

describe("hit testing", () => {
  const ui = render(MANY, { components, width: 1000 });
  const box = ui.find({ type: "scene" }).box!;
  let k = 0;
  bench("what's under the pointer, 200 pressable circles", () => {
    k = (k + 37) % 1000;
    ui.sayshape.targetAt(box.x + (k / 1000) * box.w, box.y + ((k * 7) % 1000 / 1000) * box.h);
  });
});

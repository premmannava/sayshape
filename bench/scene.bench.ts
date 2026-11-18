/**
 * Scene benchmarks: one frame of the factory monitor, the same scene with
 * nothing pressable, 150 shapes with and without z, and finding what's under the pointer.
 *
 *   npm run bench -- bench/scene.bench.ts
 *
 * Paint runs against the recording canvas from sayshape/testing, so it
 * measures the engine's and the scene's own work, not the browser's raster.
 */
import { bench, describe } from "vitest";
import { coreComponents } from "../src/components";
import { sceneComponents } from "../src/components/scene";
import { createRecordingContext, render } from "../src/testing";
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

/** 150 moving shapes, as in a snowstorm, drawn in written order or sorted by z each frame. */
const FLAKES = `scene "150 flakes" w=600 h=340 duration=10
  each items={range(150)} as=i
    circle x={(random(i)*600 + t*20) % 600} y={(random(i + 1)*340 + t*30) % 340} r={1 + 3*random(i + 2)} fill="#FFFFFF"`;

describe("scene depth", () => {
  const flat = render(FLAKES, { components, width: 1000 });
  const deep = render(FLAKES.replace('fill="#FFFFFF"', 'fill="#FFFFFF" z={random(i + 2)}'), { components, width: 1000 });

  bench("150 shapes, no z", () => {
    flat.sayshape.invalidate("paint");
    flat.sayshape.renderNow();
  });
  bench("150 shapes sorted by z", () => {
    deep.sayshape.invalidate("paint");
    deep.sayshape.renderNow();
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

/**
 * A skyline reflected in a river (reflect=, reflect.ts), with OffscreenCanvas
 * stubbed by the recording canvas: the cached buffer with a moving ripple,
 * contents that read t (drawn into the buffer every frame), and no reflection.
 */
const SKYLINE = `scene "Harbor at night" w=600 h=340 duration=8 bg="#0B1026"
  circle x=480 y=70 r=22 fill="#FFF3B0" glow=true
  rect x=0 y=220 w=600 h=120 fill="#13204A"
  group reflect=220 ripple=0.35 fade=0.7
    each items={range(30)} as=i
      rect x={i*20} y={220 - 40 - 110*random(i)} w=18 h={40 + 110*random(i)} fill="#1C2550"
    each items={range(30)} as=i
      rect x={i*20 + 6} y={220 - 20 - 90*random(i + 40)} w=5 h=6 fill="#FFD166" opacity={0.5 + 0.5*random(i + 80)}
  label "Harbor at night" x=24 y=36 size=22 weight=bold fill="#FFFFFF"`;

describe("scene reflect", () => {
  class Offscreen {
    private rec = createRecordingContext();
    constructor(public width: number, public height: number) {}
    getContext() { return this.rec.context; }
  }
  const g = globalThis as { OffscreenCanvas?: unknown };
  g.OffscreenCanvas ??= Offscreen;
  const frame = (spec: string) => {
    const ui = render(spec, { components, width: 1000, animate: true, clock: true });
    return () => { ui.clock.advance(16); };
  };
  const cached = frame(SKYLINE);
  const moving = frame(SKYLINE.replace("w=18 h=", "w={18 + 2*sin(t)} h="));
  const none = frame(SKYLINE.replace(" reflect=220 ripple=0.35 fade=0.7", ""));

  bench("skyline reflect, cached buffer + ripple", cached);
  bench("skyline reflect, contents read t", moving);
  bench("skyline, no reflect", none);
});

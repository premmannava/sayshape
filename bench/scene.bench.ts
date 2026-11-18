/**
 * Scene benchmarks: one frame of the factory monitor, the same scene with
 * nothing pressable, 150 shapes with and without z, finding what's under the pointer,
 * particles (emit) and a reflected skyline.
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
import { computeParticles, STRIDE, type EmitParams } from "../src/components/scene/emit";

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

/** The snowstorm-sized scene: ~150 animated shapes, then with particles on top (S13). */
const SNOWSTORM = `scene "A snowstorm" w=600 h=340 duration=12 bg="#0B1D3A"
  let wind={40*sin(t*PI/3) + 15*sin(t*PI*2/3)}
  each items={range(150)} as=i
    circle x={(i*37 + t*(20 + i % 7)*3) % 640 - 20} y={(i*53 + t*(30 + i % 5)*6) % 380 - 20} r={1 + i % 3} fill="#FFFFFF" opacity={0.4 + 0.1*(i % 5)}`;
const SNOW_PARTICLES = `${SNOWSTORM}
  emit count=450 x=-80 y=-10 w=760 angle=90 spread=20 speed=40 gravity=60 drag=1 wind={wind} life=7 size=4 fill="#FFFFFF, #DDE7F5"`;
const CONFETTI_600 = `scene "Confetti" w=600 h=340 duration=2.5
  emit count=300 from=0.5 x=0 y=300 angle=-60 spread=30 speed=700 gravity=500 drag=1.5 life=3.5 size=9 shape=rect flutter=1 fill="accent, warn, good, bad, #FFD166"
  emit count=300 from=0.5 x=600 y=300 angle=-120 spread=30 speed=700 gravity=500 drag=1.5 life=3.5 size=9 shape=rect flutter=1 fill="accent, warn, good, bad, #FFD166"`;
const FIREWORK_300 = `scene "Firework" w=600 h=340 duration=2 bg="#0B1D3A"
  emit count=300 from=0.9 x=300 y=120 spread=360 speed=260 gravity=120 drag=2 life=1.6 size=6 shape=line fill="warn, #FFD166, bad"`;

describe("particles", () => {
  const frame = (spec: string) => {
    const ui = render(spec, { components, width: 1000 });
    return () => { ui.sayshape.invalidate("paint"); ui.sayshape.renderNow(); };
  };
  bench("snowstorm, 150 shapes only", frame(SNOWSTORM));
  bench("snowstorm + 450 particles, gusting let wind", frame(SNOW_PARTICLES));
  bench("600 confetti, flutter", frame(CONFETTI_600));
  bench("300 firework streaks", frame(FIREWORK_300));
  const p: EmitParams = { count: 600, from: null, x: -80, y: -10, w: 760, h: 0, angle: 90, spread: 20, speed: 40, gravity: 60, drag: 1, wind: 20, life: 7, size: 4, seed: 1, flutter: 1, colors: 2, shape: "rect" };
  const out = new Float64Array(600 * STRIDE);
  let t = 0;
  bench("computeParticles alone, 600 fluttering", () => {
    t = (t + 1 / 60) % 12;
    computeParticles(p, t, { duration: 12, loop: true }, out);
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

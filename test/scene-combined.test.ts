/** Scene effects used together: trails over blur, particles and reflections, and the reflection's sharpness. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { coreComponents } from "../src/components";
import { sceneComponents } from "../src/components/scene";
import { deviceScale } from "../src/components/scene/reflect";
import { createRecordingContext, render } from "../src/testing";

const ON = [...coreComponents, ...sceneComponents];
const MOVING = { components: ON, animate: true, clock: true } as const;

describe("trails with particles, blur and reflections", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the particle budget for the line itself, not its trail's copies", () => {
    const spec = `scene "S" w=600 h=340 duration=10
  group x={20*t} y=0 trail=0.5
    emit count=500 x=300 y=100 spread=360 speed=80 life=3 size=4 fill="#FF0000"`;
    const ui = render(spec, MOVING);
    ui.clock.advance(1500);
    const red = ui.drawOps.filter((o) => o.op === "fill" && o.fillStyle === "#FF0000");
    expect(red.length).toBeGreaterThan(0);
    // The line's own particles are drawn at full strength (copies would be at most 0.55).
    expect(Math.max(...red.map((o) => o.globalAlpha))).toBeGreaterThan(0.6);
    ui.destroy();
  });

  it("makes no buffers for trail copies of a blurred or reflected group", () => {
    let made = 0;
    class Offscreen {
      private rec = createRecordingContext();
      constructor(public width: number, public height: number) { made++; }
      getContext() { return this.rec.context; }
    }
    vi.stubGlobal("OffscreenCanvas", Offscreen);
    const still = (extra: string) => `scene "S" w=600 h=340 duration=10
  group x=100 y=100 blur=6${extra}
    rect x=0 y=0 w=80 h=40 fill="#336699"
  group x=300 y=100 reflect=200${extra}
    rect x=0 y=0 w=80 h=40 fill="#996633"`;
    const count = (spec: string) => {
      made = 0;
      const ui = render(spec, MOVING);
      for (let i = 0; i < 10; i++) ui.clock.advance(16);
      ui.destroy();
      return made;
    };
    const plain = count(still(""));
    expect(count(still(" trail=0.5"))).toBe(plain);
  });
});

describe("reflection sharpness", () => {
  it("caps only the screen's pixel ratio at 2, not the drawing's own scale", () => {
    // A scene drawn 3x its w on a DPR 2 screen: 6 buffer pixels per unit, as sharp as the shapes above it.
    expect(deviceScale({ a: 6, b: 0, c: 0, d: 6 }, [3, 0, 0, 3, 0, 0])).toBeCloseTo(6);
    // The same on a DPR 3 phone: the ratio is capped at 2.
    expect(deviceScale({ a: 9, b: 0, c: 0, d: 9 }, [3, 0, 0, 3, 0, 0])).toBeCloseTo(6);
    // A scene shown smaller than its w at DPR 1.
    expect(deviceScale({ a: 0.5, b: 0, c: 0, d: 0.5 }, [0.5, 0, 0, 0.5, 0, 0])).toBeCloseTo(0.5);
  });
});

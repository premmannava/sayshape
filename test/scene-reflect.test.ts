/**
 * reflect=, ripple= and fade= on group and use (S14, src/components/scene/reflect.ts):
 * a mirrored copy below a line, drawn from an offscreen buffer, cached while
 * nothing it reads changes, rippled in strips, still with reduced motion,
 * nothing without an offscreen canvas, and off with sceneComponentsWith({ reflect: false }).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { reviewScenes, sceneComponents, sceneComponentsWith } from "../src/components/scene";
import { bufferScale, rippleOffset, rippleSpeed } from "../src/components/scene/reflect";
import { createRecordingContext, render, type DrawOp, type Rendered } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";

const ON = [...coreComponents, ...sceneComponents];

/** The acceptance picture: a night skyline in a river with a gentle moving ripple. */
const SKYLINE = `scene "Harbor at night" w=600 h=340 duration=8 bg="#0B1026"
  gradient id=moon kind=radial from="#FFF3B0" to="#FFF3B0 0%"
  circle x=480 y=70 r=60 fill="url(moon)"
  circle x=480 y=70 r=22 fill="#FFF3B0" glow=true
  rect x=0 y=220 w=600 h=120 fill="#13204A"
  group reflect=220 ripple=0.35 fade=0.7
    each items={range(30)} as=i
      rect x={i*20} y={220 - 40 - 110*random(i)} w=18 h={40 + 110*random(i)} fill="#1C2550"
    each items={range(30)} as=i
      rect x={i*20 + 6} y={220 - 20 - 90*random(i + 40)} w=5 h=6 fill="#FFD166" opacity={0.5 + 0.5*random(i + 80)}
  label "Harbor at night" x=24 y=36 size=22 weight=bold fill="#FFFFFF"`;

/** Every offscreen buffer made, with what was drawn into it. */
let buffers: Array<{ width: number; height: number; take(): DrawOp[] }> = [];
class FakeOffscreen {
  private rec = createRecordingContext();
  constructor(public width: number, public height: number) { buffers.push(this); }
  getContext(kind: string) { return kind === "2d" ? this.rec.context : null; }
  take() { return this.rec.take(); }
}
beforeEach(() => { buffers = []; vi.stubGlobal("OffscreenCanvas", FakeOffscreen); });
afterEach(() => { vi.unstubAllGlobals(); });

const images = (ui: Rendered) => ui.drawOps.filter((o) => o.op === "drawImage");
/** Shapes drawn into the buffers since the last call (the fade's fillRect left out). */
const bufferFills = () => buffers.flatMap((b) => b.take()).filter((o) => o.op === "fill").length;
/** Draw calls, comparable across renders (images by their numbers only). */
const plain = (ops: DrawOp[]) => ops.map((o) => ({ ...o, args: o.args.map((a) => (typeof a === "object" ? "image" : a)) }));

const STATIC = `scene "Towers" w=600 h=340 duration=8
  rect x=0 y=220 w=600 h=120 fill="#13204A"
  group reflect=220
    rect x=100 y=120 w=40 h=100 fill="#aa0000"
    rect x=200 y=160 w=40 h=60 fill="#00aa00"`;

describe("reflect: drawing", () => {
  it("draws exactly as before when the props are absent", () => {
    const spec = STATIC.replace(" reflect=220", "");
    const withBuffers = render(spec, { components: ON });
    vi.unstubAllGlobals();
    const without = render(spec, { components: ON });
    expect(plain(withBuffers.drawOps)).toEqual(plain(without.drawOps));
    expect(buffers).toHaveLength(0);
    withBuffers.destroy(); without.destroy();
  });

  it("draws a still subtree with no ripple as one image, flipped and clipped below the line", () => {
    const ui = render(STATIC, { components: ON });
    const imgs = images(ui);
    expect(imgs).toHaveLength(1);
    // Depth is the shorter of the room above the line (220) and below it (120); 8 px of padding each side.
    expect(imgs[0]!.clip).toEqual({ x: -8, y: 220, w: 616, h: 120 });
    expect(imgs[0]!.args.slice(1)).toEqual([0, 0, 616, 120, -8, 100, 616, 120]);
    // The buffer holds both towers, then the reflection goes under the group's own drawing.
    expect(buffers).toHaveLength(1);
    expect(bufferFills()).toBe(2);
    const order = ui.drawOps.map((o) => o.op);
    expect(order.indexOf("drawImage")).toBeLessThan(order.lastIndexOf("fill"));
    ui.destroy();
  });

  it("bakes the fade into the buffer, from solid at the line to 1 - fade at the far edge", () => {
    const ui = render(STATIC.replace("reflect=220", "reflect=220 fade=0.8"), { components: ON });
    const fade = buffers[0]!.take().find((o) => o.op === "fillRect")!;
    expect(fade.gradientStops).toEqual([{ offset: 0, color: "rgba(0, 0, 0, 1)" }, { offset: 1, color: "rgba(0, 0, 0, 0.2)" }]);
    ui.destroy();
  });

  it("ripples in strips that shift over time", () => {
    const ui = render(STATIC.replace("reflect=220", "reflect=220 ripple=0.5"), { components: ON, animate: true, clock: true });
    ui.clock.advance(500);
    const first = images(ui);
    expect(first.length).toBeGreaterThan(30);
    expect(first.length).toBeLessThanOrEqual(300);
    ui.clock.advance(700);
    const second = images(ui);
    expect(second).toHaveLength(first.length);
    const xs = (ops: DrawOp[]) => ops.map((o) => o.args[5] as number);
    expect(xs(second)).not.toEqual(xs(first));
    // Never further than ripple × 6 from where it sits.
    for (const x of [...xs(first), ...xs(second)]) expect(Math.abs(x + 8)).toBeLessThanOrEqual(3 + 1e-9);
    ui.destroy();
  });

  it("stays still with reduced motion: one image, no strips", () => {
    const ui = render(STATIC.replace("reflect=220", "reflect=220 ripple=1"), { components: ON, animate: true, clock: true, reducedMotion: true });
    expect(images(ui)).toHaveLength(1);
    ui.destroy();
  });

  it("draws nothing, and doesn't throw, without an offscreen canvas", () => {
    vi.unstubAllGlobals();
    const ui = render(STATIC, { components: ON });
    expect(images(ui)).toHaveLength(0);
    const without = render(STATIC.replace(" reflect=220", ""), { components: ON });
    expect(plain(ui.drawOps)).toEqual(plain(without.drawOps));
    ui.destroy(); without.destroy();
  });

  it("reflects a use, and draws nothing when the line is out of sight", () => {
    const spec = `scene "Use" w=600 h=340
  define "tower"
    rect x=0 y={-h} w=30 h={h} fill="#123456"
  use "tower" x=100 y=200 reflect=200 args={{h: 80}}
  use "tower" x=300 y=200 reflect=400 args={{h: 80}}`;
    const ui = render(spec, { components: ON });
    expect(parse(spec, new Registry(ON)).diagnostics).toEqual([]);
    expect(images(ui)).toHaveLength(1);
    ui.destroy();
  });

  it("follows the group's place: reflect= is in its parent's coordinates", () => {
    const ui = render(`scene "Moved" w=600 h=340
  group x=50 y=-40 reflect=220
    rect x=100 y=200 w=40 h=60 fill="#aa0000"`, { components: ON });
    const img = images(ui)[0]!;
    // Drawn before the group's own move: the clip and image are in the scene's coordinates.
    expect(img.clip).toEqual({ x: -8, y: 220, w: 616, h: 120 });
    ui.destroy();
  });

  it("doesn't reflect inside a reflection", () => {
    const ui = render(`scene "Nested" w=600 h=340
  group reflect=220
    group reflect=180
      rect x=100 y=120 w=40 h=60 fill="#aa0000"`, { components: ON });
    // The outer reflection and the inner one, drawn in the main pass only.
    expect(images(ui)).toHaveLength(2);
    expect(buffers.map((b) => b.take().filter((o) => o.op === "drawImage").length)).toEqual([0, 0]);
    ui.destroy();
  });
});

describe("reflect: cache", () => {
  it("keeps the buffer between frames when nothing it reads changes, ripple and all", () => {
    const ui = render(STATIC.replace("reflect=220", "reflect=220 ripple=0.4"), { components: ON, animate: true, clock: true });
    expect(bufferFills()).toBe(2);
    ui.clock.advance(400);
    ui.clock.advance(400);
    expect(bufferFills()).toBe(0);
    expect(images(ui).length).toBeGreaterThan(1);
    ui.destroy();
  });

  it("redraws the contents every frame when they read t", () => {
    const ui = render(STATIC.replace('h=60 fill="#00aa00"', 'h={60 + 10*sin(t)} fill="#00aa00"'), { components: ON, animate: true, clock: true });
    bufferFills();
    ui.clock.advance(400);
    expect(bufferFills()).toBe(2);
    ui.clock.advance(400);
    expect(bufferFills()).toBe(2);
    ui.destroy();
  });

  it("redraws when a let above it that reads t changes, then stops trying to keep copies", () => {
    const ui = render(`scene "Let" w=600 h=340 duration=8
  let k={floor(t*10)}
  group reflect=220
    rect x={100 + k} y=120 w=40 h=100 fill="#aa0000"`, { components: ON, animate: true, clock: true });
    bufferFills();
    for (let i = 0; i < 5; i++) {
      ui.clock.advance(150);
      expect(bufferFills()).toBe(1);
    }
    ui.destroy();
  });

  it("redraws when state it reads changes, and not otherwise", () => {
    const ui = render(`state h=60
${STATIC.replace("h=60", "h={h}")}`, { components: ON });
    bufferFills();
    ui.sayshape.invalidate("paint"); ui.sayshape.renderNow();
    expect(bufferFills()).toBe(0);
    ui.set("h", 90);
    expect(bufferFills()).toBe(2);
    ui.sayshape.invalidate("paint"); ui.sayshape.renderNow();
    expect(bufferFills()).toBe(0);
    ui.destroy();
  });

  it("redraws when the theme changes (theme colors live in the buffer)", () => {
    const ui = render(STATIC.replace('fill="#aa0000"', "fill=accent"), { components: ON, theme: lightTheme });
    bufferFills();
    ui.sayshape.setTheme(darkTheme); ui.sayshape.renderNow();
    const fills = buffers.flatMap((b) => b.take()).filter((o) => o.op === "fill").map((o) => o.fillStyle);
    expect(fills).toContain(darkTheme.colors.accent);
    ui.destroy();
  });

  it("counts a cached reflection's shapes toward the scene's limits every frame", () => {
    const ui = render(STATIC, { components: ON, animate: true, clock: true });
    const first = ui.drawOps.length;
    ui.clock.advance(300);
    expect(ui.drawOps.length).toBe(first);
    ui.destroy();
  });
});

describe("reflect: what it leaves alone", () => {
  it("keeps the same pressable regions: a reflection is only a picture", () => {
    const spec = `state sel=0
scene "Press" w=600 h=340
  group reflect=220 on=set:sel:1 tip="Tower"
    rect x=100 y=120 w=40 h=100 fill="#aa0000"`;
    const a = render(spec, { components: ON });
    const b = render(spec.replace(" reflect=220", ""), { components: ON });
    const boxes = (ui: Rendered) => ui.hits.filter((h) => h.box.node.type === "scene").map((h) => ({ x: h.box.x, y: h.box.y, w: h.box.w, h: h.box.h, d: h.detail }));
    expect(boxes(a)).toEqual(boxes(b));
    expect(boxes(a)).toHaveLength(1);
    a.destroy(); b.destroy();
  });

  it("doesn't change the drawing check", () => {
    const reg = new Registry(ON);
    expect(reviewScenes(parse(SKYLINE, reg))).toEqual(reviewScenes(parse(SKYLINE.replace(" reflect=220 ripple=0.35 fade=0.7", ""), reg)));
  });

  it("parses the skyline with no problems, and every prefix too", () => {
    const reg = new Registry(ON);
    expect(parse(SKYLINE, reg).diagnostics).toEqual([]);
    const lines = SKYLINE.split("\n");
    for (let i = 1; i < lines.length; i++) expect(parse(lines.slice(0, i).join("\n"), reg).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("draws the skyline in light and dark", () => {
    for (const theme of [lightTheme, darkTheme]) {
      const ui = render(SKYLINE, { components: ON, theme, animate: true, clock: true });
      ui.clock.advance(1000);
      expect(images(ui).length).toBeGreaterThan(30);
      expect(ui.text()).toContain("Harbor at night");
      ui.destroy();
    }
  });
});

describe("reflect: the switch", () => {
  const OFF = [...coreComponents, ...sceneComponentsWith({ reflect: false })];

  it("off, the props are unknown: ignored with a warning, and nothing is drawn", () => {
    const d = parse(STATIC.replace("reflect=220", "reflect=220 ripple=0.5"), new Registry(OFF)).diagnostics;
    expect(d.map((x) => x.severity)).toEqual(["warning", "warning"]);
    expect(d[0]!.message).toMatch(/"group" has no prop "reflect"/);
    const ui = render(STATIC, { components: OFF });
    expect(images(ui)).toHaveLength(0);
    expect(buffers).toHaveLength(0);
    ui.destroy();
  });

  it("on, the guide says it once, on group", () => {
    const g = (sceneComponents.find((c) => c.type === "group")!).props;
    const u = (sceneComponents.find((c) => c.type === "use")!).props;
    expect(g.reflect!.unlisted).toBeFalsy();
    expect(g.ripple!.unlisted).toBe(true);
    expect(u.reflect!.unlisted).toBe(true);
  });
});

describe("reflect: the math", () => {
  it("bufferScale: the transform's scale, capped at 2", () => {
    expect(bufferScale({ a: 1, b: 0, c: 0, d: 1 })).toBe(1);
    expect(bufferScale({ a: 1.5, b: 0, c: 0, d: 1.5 })).toBe(1.5);
    expect(bufferScale({ a: 3, b: 0, c: 0, d: 3 })).toBe(2);
    const r = Math.PI / 6;
    expect(bufferScale({ a: 1.2 * Math.cos(r), b: 1.2 * Math.sin(r), c: -1.2 * Math.sin(r), d: 1.2 * Math.cos(r) })).toBeCloseTo(1.2);
    expect(bufferScale({ a: 0, b: 0, c: 0, d: 0 })).toBe(0);
  });

  it("rippleOffset: 0 at ripple 0, bounded by ripple × 6", () => {
    for (let d = 0; d <= 120; d += 7) {
      expect(rippleOffset(d, 120, 0, 3.3)).toBe(0);
      expect(Math.abs(rippleOffset(d, 120, 0.35, d / 10))).toBeLessThanOrEqual(0.35 * 6);
      expect(Math.abs(rippleOffset(d, 120, 1, d / 7))).toBeLessThanOrEqual(6);
    }
  });

  it("rippleOffset: continuous in depth, and the same at a loop's end as at its start", () => {
    for (let d = 0; d < 120; d += 0.5) expect(Math.abs(rippleOffset(d + 0.01, 120, 1, 2) - rippleOffset(d, 120, 1, 2))).toBeLessThan(0.1);
    for (const period of [8, 5, 3.3, 1]) {
      for (let d = 0; d <= 120; d += 13) expect(rippleOffset(d, 120, 0.6, period, period)).toBeCloseTo(rippleOffset(d, 120, 0.6, 0, period), 9);
    }
    expect(rippleSpeed(0)).toBeCloseTo(Math.PI);
    expect(rippleSpeed(8)).toBeCloseTo(Math.PI);
  });
});

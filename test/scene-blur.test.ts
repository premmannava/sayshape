/**
 * blur= on shapes, group and use (S10, src/components/scene/blur.ts): the
 * canvas filter on a shape, one offscreen buffer blurred once for a group,
 * each shape on its own where there's no buffer, sharp where there's no
 * filter, and still contents blurred once and kept between frames.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { reviewScenes, sceneComponents } from "../src/components/scene";
import { MAX_BLUR_DEVICE, blurRadius, bufferDensity, canFilter, withBlur } from "../src/components/scene/blur";
import { createRecordingContext, render, type DrawOp, type Rendered } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";
import { paintScene, type Frame } from "../src/components/scene/draw";

const ON = [...coreComponents, ...sceneComponents];

/** Acceptance: fog banks drifting across, three still ellipses blurred together. */
const FOG = `scene "Fog over the water" w=600 h=340 duration=10 bg="#20304A"
  rect x=0 y=210 w=600 h=130 fill="#2F4858"
  group x={-80 + 15*t} y=0 blur=24 opacity=0.85
    ellipse x=160 y=190 rx=150 ry=30 fill="#FFFFFF 45%"
    ellipse x=380 y=212 rx=190 ry=36 fill="#FFFFFF 35%"
    ellipse x=600 y=180 rx=150 ry=28 fill="#FFFFFF 40%"`;

/** Acceptance: smoke, eight puffs rising and fading, blurred as one. */
const SMOKE = `scene "Smoke from a chimney" w=600 h=340 duration=4 bg="#DDE3EA"
  rect x=270 y=220 w=60 h=120 fill="#5A3E36"
  group blur=6
    each items={range(8)} as=i
      let u={((t/4) + i/8) % 1}
      circle x={300 + 30*sin(u*6 + i)} y={220 - 200*u} r={14 + 30*u} fill="#6B7280" opacity={0.6*(1 - u)}`;

/** Every offscreen buffer made, with what was drawn into it. */
let buffers: Array<{ width: number; height: number; take(): DrawOp[] }> = [];
class FakeOffscreen {
  private rec = createRecordingContext();
  constructor(public width: number, public height: number) { buffers.push(this); }
  getContext(kind: string) { return kind === "2d" ? this.rec.context : null; }
  take() { return this.rec.take(); }
}
const stubOffscreen = () => vi.stubGlobal("OffscreenCanvas", FakeOffscreen);
beforeEach(() => { buffers = []; });
afterEach(() => { vi.unstubAllGlobals(); });

const images = (ui: Rendered) => ui.drawOps.filter((o) => o.op === "drawImage");
const shapeOps = (ops: DrawOp[]) => ops.filter((o) => o.op === "fill" || o.op === "stroke" || o.op === "fillText");
/** Shapes drawn into the buffers since the last call. */
const bufferFills = () => buffers.flatMap((b) => b.take()).filter((o) => o.op === "fill").length;
const frame = (ui: Rendered) => { ui.sayshape.invalidate("paint"); ui.sayshape.renderNow(); };
/** A moving scene, past the engine's fade-in (an invisible group draws as usual), with the buffers' records cleared. */
const playing = (spec: string, opts: Parameters<typeof render>[1] = {}): Rendered => {
  const ui = render(spec, { components: ON, animate: true, clock: true, ...opts });
  ui.clock.advance(1000);
  buffers.forEach((b) => b.take());
  return ui;
};

describe("blur: parsing", () => {
  it("is a known prop on shapes, labels, group and use, with no diagnostics", () => {
    const spec = `scene "x" w=600 h=340
  define "puff"
    circle x=0 y=0 r=20 fill="#FFFFFF"
  rect x=10 y=10 w=40 h=40 fill=accent blur=3
  label "Hi" x=100 y=100 fill=ink blur=2
  path d="M0 0 L10 10" stroke=ink blur=1
  group blur=8
    circle x=200 y=100 r=30 fill="#FFFFFF"
  use "puff" x=300 y=200 blur={2 + 2}`;
    expect(parse(spec, new Registry(ON)).diagnostics).toEqual([]);
  });

  it("documents it once, on group; shapes and use take it unlisted", () => {
    const defs = new Map(sceneComponents.map((c) => [c.type, c]));
    expect(defs.get("group")!.props.blur!.unlisted).toBeUndefined();
    for (const t of ["rect", "circle", "ellipse", "line", "path", "polygon", "label", "use"]) expect(defs.get(t)!.props.blur!.unlisted).toBe(true);
  });
});

describe("blur: pure parts", () => {
  it("scales the radius by the transform (DPR and every scale), clamps blur= and caps device pixels", () => {
    expect(blurRadius(8, { a: 1, b: 0, c: 0, d: 1 })).toBe(8);
    expect(blurRadius(8, { a: 2, b: 0, c: 0, d: 2 })).toBe(16);
    // A rotation doesn't change it.
    expect(blurRadius(8, { a: Math.cos(1) * 2, b: Math.sin(1) * 2, c: -Math.sin(1) * 2, d: Math.cos(1) * 2 })).toBeCloseTo(16);
    expect(blurRadius(500, { a: 1, b: 0, c: 0, d: 1 })).toBe(60);
    expect(blurRadius(60, { a: 4, b: 0, c: 0, d: 4 })).toBe(MAX_BLUR_DEVICE);
    expect(blurRadius(-3, { a: 1, b: 0, c: 0, d: 1 })).toBe(0);
    expect(blurRadius(Number.NaN, { a: 1, b: 0, c: 0, d: 1 })).toBe(0);
  });

  it("caps buffer density at DPR 2 and lowers it for big radii, keeping 2.5 buffer pixels of blur", () => {
    expect(bufferDensity(1, 2)).toBe(1);
    expect(bufferDensity(2, 2.5)).toBe(1);
    expect(bufferDensity(3, 2)).toBeCloseTo(2 / 3);
    expect(bufferDensity(2, 5)).toBe(0.5);
    expect(bufferDensity(3, 3)).toBeCloseTo(2 / 3);
    expect(bufferDensity(1, 10)).toBe(0.25);
    expect(bufferDensity(1, 100)).toBe(0.25);
  });

  it("adds blur to the filter already on", () => {
    expect(withBlur("none", 4)).toBe("blur(4px)");
    expect(withBlur("", 2.345)).toBe("blur(2.35px)");
    expect(withBlur("blur(4px)", 2)).toBe("blur(4px) blur(2px)");
  });

  it("checks filter support once per context, putting the filter back", () => {
    const rec = createRecordingContext().context;
    rec.filter = "blur(3px)";
    expect(canFilter(rec)).toBe(true);
    expect(rec.filter).toBe("blur(3px)");
    // A context with no filter (older Safari), or one that ignores it.
    expect(canFilter({} as CanvasRenderingContext2D)).toBe(false);
    const ignoring = { get filter() { return "none"; }, set filter(_v: string) {} } as unknown as CanvasRenderingContext2D;
    expect(canFilter(ignoring)).toBe(false);
  });
});

describe("blur: shapes", () => {
  it("draws exactly as before without blur=", () => {
    const spec = `scene "x" w=600 h=340
  circle x=100 y=100 r=30 fill="#FF0000"
  group x=10
    rect x=200 y=100 w=40 h=40 fill="#00FF00"`;
    stubOffscreen();
    const ui = render(spec, { components: ON });
    expect(ui.drawOps.every((o) => o.filter === undefined)).toBe(true);
    expect(buffers).toHaveLength(0);
    ui.destroy();
  });

  it("blurs one shape with the filter, and the next shape not", () => {
    const ui = render(`scene "x" w=600 h=340
  circle x=100 y=100 r=30 fill="#FF0000" blur=8
  circle x=200 y=100 r=30 fill="#0000FF"
  label "Soft" x=300 y=100 fill="#000000" blur=2`, { components: ON });
    const fills = shapeOps(ui.drawOps);
    expect(fills.find((o) => o.fillStyle === "#FF0000")!.filter).toBe("blur(8px)");
    expect(fills.find((o) => o.fillStyle === "#0000FF")!.filter).toBeUndefined();
    expect(fills.find((o) => o.op === "fillText")!.filter).toBe("blur(2px)");
    ui.destroy();
  });

  it("draws sharp, without throwing, on a context with no filter", () => {
    const rec = createRecordingContext();
    // A canvas without filter support (Safari before 18): reading filter gives nothing, writing it does nothing.
    const plain = new Proxy(rec.context as object, {
      get: (t, p) => (p === "filter" ? undefined : Reflect.get(t, p)),
      set: (t, p, v) => (p === "filter" ? true : Reflect.set(t, p, v)),
    }) as CanvasRenderingContext2D;
    const root = parse(`scene "x" w=600 h=340
  circle x=100 y=100 r=30 fill="#FF0000" blur=8
  group blur=10
    rect x=10 y=10 w=40 h=40 fill="#00FF00"`, new Registry(ON)).root;
    const f: Frame = { g: plain, font: (w, s) => `${w} ${s}px sans-serif`, colors: lightTheme.colors, defs: new Map(), gradients: new Map(), shapes: 0, steps: 0, useDepth: 0, ends: new Map(), time: 0, m: [1, 0, 0, 1, 0, 0], offscreen: (w, h) => new FakeOffscreen(w, h) as unknown as OffscreenCanvas, view: { m: [1, 0, 0, 1, 0, 0], w: 600, h: 340 } };
    expect(() => paintScene(f, root.children[0]!.children, () => undefined, 600, 340, undefined)).not.toThrow();
    const ops = rec.take();
    expect(ops.filter((o) => o.op === "fill")).toHaveLength(2);
    expect(ops.every((o) => o.filter === undefined && o.op !== "drawImage")).toBe(true);
    expect(buffers).toHaveLength(0);
  });
});

describe("blur: groups", () => {
  it("without an offscreen canvas, blurs each shape on its own", () => {
    const ui = render(`scene "x" w=600 h=340
  group blur=4
    circle x=100 y=100 r=30 fill="#FF0000"
    circle x=130 y=100 r=30 fill="#00FF00"
  rect x=0 y=0 w=10 h=10 fill="#000000"`, { components: ON });
    const ops = shapeOps(ui.drawOps);
    expect(ops.filter((o) => o.fillStyle !== "#000000" && o.filter === "blur(4px)")).toHaveLength(2);
    expect(ops.find((o) => o.fillStyle === "#000000")!.filter).toBeUndefined();
    ui.destroy();
  });

  it("with an offscreen canvas, draws the contents into one buffer, blurs it once there, and puts it on the canvas", () => {
    stubOffscreen();
    const ui = playing(SMOKE);
    ui.clock.advance(16);
    const imgs = images(ui);
    // One unfiltered image on the canvas: a filtered draw on a big canvas is slow in browsers.
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.filter).toBeUndefined();
    // The chimney on the canvas, the puffs in the sharp buffer, then one blur pass into the second.
    expect(shapeOps(ui.drawOps).filter((o) => o.fillStyle === "#6B7280")).toHaveLength(0);
    const inBuffers = buffers.flatMap((b) => b.take());
    const fills = inBuffers.filter((o) => o.op === "fill");
    expect(fills).toHaveLength(8);
    expect(fills.every((o) => o.filter === undefined)).toBe(true);
    // 6 device pixels, kept as 2.5 in a buffer at 2.5 / 6 density.
    expect(inBuffers.filter((o) => o.op === "drawImage").map((o) => o.filter)).toEqual(["blur(2.5px)"]);
    // Drawn again each frame (the puffs move), in the same two buffers.
    ui.clock.advance(300);
    expect(bufferFills()).toBe(8);
    expect(buffers).toHaveLength(2);
    ui.destroy();
  });

  it("with an offscreen canvas, blurs a single shape in a small buffer around it", () => {
    stubOffscreen();
    const ui = render(`scene "x" w=600 h=340
  circle x=100 y=100 r=30 fill="#FF0000" blur=8 opacity=0.5
  circle x=200 y=100 r=30 fill="#0000FF"`, { components: ON });
    expect(shapeOps(ui.drawOps).map((o) => o.fillStyle)).toEqual(["#0000FF"]);
    expect(images(ui)).toHaveLength(1);
    expect(images(ui)[0]!.filter).toBeUndefined();
    const inBuffers = buffers.flatMap((b) => b.take());
    const red = inBuffers.find((o) => o.op === "fill")!;
    expect(red.fillStyle).toBe("#FF0000");
    expect(red.globalAlpha).toBe(0.5);
    expect(inBuffers.find((o) => o.op === "drawImage")!.filter).toBe("blur(2.5px)");
    // The buffer covers the circle and three radii around it: 60 + 6 × 8 device pixels across, at 2.5 / 8 density.
    const [, , , bw] = images(ui)[0]!.args as number[];
    expect(bw).toBe(Math.ceil(108 * 2.5 / 8));
    ui.destroy();
  });

  it("applies the group's opacity once, when the buffer is drawn", () => {
    stubOffscreen();
    const ui = playing(SMOKE.replace("group blur=6", "group blur=6 opacity=0.5"));
    expect(images(ui)[0]!.globalAlpha).toBe(0.5);
    expect(buffers.flatMap((b) => b.take()).filter((o) => o.op === "fill").every((o) => o.globalAlpha <= 0.6)).toBe(true);
    ui.destroy();
  });

  it("past six buffers a frame, blurs each shape on its own", () => {
    stubOffscreen();
    const groups = Array.from({ length: 8 }, (_, i) => `  group blur=3\n    circle x={${i * 60 + 30} + t} y=100 r=20 fill="#123456"`).join("\n");
    const ui = playing(`scene "x" w=600 h=340 duration=4\n${groups}`);
    expect(images(ui)).toHaveLength(6);
    expect(shapeOps(ui.drawOps).filter((o) => o.filter === "blur(3px)")).toHaveLength(2);
    ui.destroy();
  });

  it("keeps presses working on shapes inside a blurred group", () => {
    stubOffscreen();
    const ui = render(`state n=0
scene "x" w=600 h=340
  group blur=4
    circle x=100 y=100 r=40 fill="#FF0000" on=inc:n`, { components: ON });
    const box = ui.find({ type: "scene" }).box!;
    ui.click(box.x + (100 * box.w) / 600, box.y + (100 * box.h) / 340);
    expect(ui.state.n).toBe(1);
    ui.destroy();
  });
});

describe("blur: still contents are blurred once", () => {
  it("builds the fog's blurred bitmap once while the group drifts", () => {
    stubOffscreen();
    const ui = render(FOG, { components: ON });
    expect(bufferFills()).toBe(3);
    const first = images(ui)[0]!;
    // The kept bitmap is already blurred: drawn as it is, in the group's own coordinates.
    expect(first.filter).toBeUndefined();
    const blurred = buffers.flatMap((b) => b.take());
    expect(blurred).toEqual([]);
    ui.destroy();
    const moving = playing(FOG);
    for (let i = 0; i < 3; i++) moving.clock.advance(400);
    expect(bufferFills()).toBe(0);
    expect(images(moving)).toHaveLength(1);
    moving.destroy();
  });

  it("blurs the bitmap with the radius in buffer pixels", () => {
    stubOffscreen();
    const ui = render(FOG, { components: ON });
    // The blur pass: the sharp buffer drawn into the kept one through the filter.
    const passes = buffers.map((b) => b.take()).flat().filter((o) => o.op === "drawImage");
    expect(passes).toHaveLength(1);
    expect(passes[0]!.filter).toMatch(/^blur\(\d+(\.\d+)?px\)$/);
    ui.destroy();
  });

  it("counts cached shapes toward the scene's limits every frame", () => {
    stubOffscreen();
    const ui = playing(FOG);
    const ops = ui.drawOps.length;
    ui.clock.advance(400);
    expect(ui.drawOps.length).toBe(ops);
    ui.destroy();
  });

  const rebuilds = (spec: string): number[] => {
    const ui = playing(spec);
    const out: number[] = [];
    for (let i = 0; i < 3; i++) { ui.clock.advance(400); out.push(bufferFills()); }
    ui.destroy();
    return out;
  };

  it("doesn't keep contents that move with t", () => {
    stubOffscreen();
    expect(rebuilds(FOG.replace("ellipse x=160", "ellipse x={160 + t*10}"))).toEqual([3, 3, 3]);
  });

  it("doesn't keep contents with something pressable", () => {
    stubOffscreen();
    expect(rebuilds(`state n=0\n${FOG.replace('fill="#FFFFFF 45%"', 'fill="#FFFFFF 45%" on=inc:n')}`)).toEqual([3, 3, 3]);
  });

  it("builds again after a re-parse, and when the theme changes", () => {
    stubOffscreen();
    const spec = FOG.replace('fill="#FFFFFF 45%"', "fill=accent");
    const ui = render(spec, { components: ON, theme: lightTheme });
    bufferFills();
    frame(ui);
    expect(bufferFills()).toBe(0);
    ui.sayshape.setSpec(spec);
    ui.sayshape.renderNow();
    expect(bufferFills()).toBe(3);
    ui.sayshape.setTheme(darkTheme); ui.sayshape.renderNow();
    const fills = buffers.flatMap((b) => b.take()).filter((o) => o.op === "fill").map((o) => o.fillStyle);
    expect(fills).toContain(darkTheme.colors.accent);
    ui.destroy();
  });

  it("builds again when state a bare name reads changes, and stops keeping copies when it keeps changing", () => {
    stubOffscreen();
    const ui = render(`state c="#FF0000"\n${FOG.replace('fill="#FFFFFF 45%"', "fill=c")}`, { components: ON });
    bufferFills();
    frame(ui);
    expect(bufferFills()).toBe(0);
    ui.set("c", "#00FF00");
    expect(bufferFills()).toBe(3);
    ui.set("c", "#0000FF");
    // Two rebuilds in a row: drawn each frame from now on.
    expect(bufferFills()).toBe(3);
    frame(ui);
    expect(bufferFills()).toBe(3);
    ui.destroy();
  });
});

describe("blur: the drawing check and motion", () => {
  it("reviews the same with and without blur", () => {
    const reg = new Registry(ON);
    const sharp = (s: string) => s.replace(/ blur=\d+/g, "");
    for (const spec of [FOG, SMOKE]) expect(reviewScenes(parse(spec, reg))).toEqual(reviewScenes(parse(sharp(spec), reg)));
  });

  it("draws the same still frame with reduced motion", () => {
    stubOffscreen();
    const a = playing(SMOKE, { reducedMotion: true });
    const b = render(SMOKE, { components: ON, animate: false });
    expect(images(a).map((o) => o.filter)).toEqual(images(b).map((o) => o.filter));
    a.destroy(); b.destroy();
  });

  it("every prefix of the fog parses without errors", () => {
    const reg = new Registry(ON);
    const lines = FOG.split("\n");
    for (let i = 1; i <= lines.length; i++) expect(parse(lines.slice(0, i).join("\n"), reg).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

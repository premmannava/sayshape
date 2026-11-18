/**
 * Particles in scenes (S13): the emit element. Its motion math, determinism,
 * loops and rate changes, gusting wind from a let, the particle cap, reduced
 * motion, the particles switch, and the three acceptance pictures.
 */
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { languageGuide } from "../src/prompt";
import { coreComponents } from "../src/components";
import { MAX_SCENE_PARTICLES, reviewScenes, sceneComponents, sceneComponentsWith, sceneRegions, sceneTime } from "../src/components/scene";
import { computeParticles, cycleOf, dragIntegrals, STRIDE, windDrift, windTable, type EmitClock, type EmitParams } from "../src/components/scene/emit";
import { paintScene, type Frame } from "../src/components/scene/draw";
import { IDENTITY } from "../src/components/scene/interact";
import { lightTheme } from "../src/theme";
import type { Scope } from "../src/expr";
import type { PaintContext } from "../src/component";
import type { Box, SayShapeNode, Value } from "../src/types";
import { render } from "../src/testing";

const ON = [...coreComponents, ...sceneComponents];
const OFF = [...coreComponents, ...sceneComponentsWith({ particles: false })];
const reg = new Registry(ON);

const sceneOf = (root: SayShapeNode): SayShapeNode | undefined =>
  root.type === "scene" ? root : root.children.map(sceneOf).find(Boolean);

/** Draw a spec's scene at time t onto a context that logs every call, as the scene paint would. */
function trace(spec: string, t: number, opts: { press?: boolean; motion?: boolean } = {}) {
  const parsed = parse(spec, reg);
  const scene = sceneOf(parsed.root)!;
  const calls: string[] = [];
  let style: Record<string, unknown> = { globalAlpha: 1 };
  const stack: Array<Record<string, unknown>> = [];
  const g = new Proxy({}, {
    get: (_t, k: string) => {
      if (k === "save") return () => { stack.push({ ...style }); };
      if (k === "restore") return () => { style = stack.pop() ?? style; };
      if (k === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (k in style) return style[k];
      return (...a: unknown[]) => { calls.push(`${k}(${a.map((v) => (typeof v === "number" ? v.toFixed(4) : String(v))).join(",")})`); };
    },
    set: (_t, k: string, v) => { style[k] = v; calls.push(`${k}=${typeof v === "number" ? v.toFixed(4) : String(v)}`); return true; },
  }) as unknown as CanvasRenderingContext2D;
  const state = new Map<string, Value>(parsed.state.map((s) => [s.key, s.value as Value]));
  const num = (k: string, d: number) => (scene.props[k] === undefined ? d : Number(scene.props[k]));
  const f: Frame = {
    g, font: () => "10px sans-serif", colors: lightTheme.colors, defs: new Map(), gradients: new Map(),
    shapes: 0, steps: 0, useDepth: 0, ends: new Map(), time: t, m: IDENTITY, motion: opts.motion ?? true,
    clock: { duration: num("duration", 0), loop: scene.props.loop !== "false" },
    ...(opts.press === false ? {} : { press: { regions: [], open: [], copy: [], locate: () => null } }),
  };
  const base: Scope = (n) => (n === "t" ? f.time : n === "PI" ? Math.PI : state.get(n));
  paintScene(f, scene.children, base, num("w", 600), num("h", 340), undefined);
  const arcs = calls.filter((c) => c.startsWith("arc(")).map((c) => c.slice(4, -1).split(",").slice(0, 3).map(Number) as [number, number, number]);
  return { calls, f, arcs, diagnostics: parsed.diagnostics };
}

const params = (over: Partial<EmitParams> = {}): EmitParams => ({
  count: 40, from: 0, x: 300, y: 200, w: 0, h: 0, angle: -90, spread: 60, speed: 300, gravity: 400, drag: 1, wind: 0,
  life: 2, size: 6, seed: 7, flutter: 0, colors: 1, shape: "circle", ...over,
});
const buf = () => new Float64Array(MAX_SCENE_PARTICLES * STRIDE);
const still: EmitClock = { duration: 0, loop: false };

// ---------- acceptance pictures ----------

const CONFETTI = `scene "Confetti from both sides" w=600 h=340 duration=5
  emit count=120 from=1.3 x=0 y=300 angle=-60 spread=30 speed=700 gravity=500 drag=1.5 life=3.5 size=9 shape=rect flutter=1 fill="accent, warn, good, bad, #FFD166"
  emit count=120 from=1.3 x=600 y=300 angle=-120 spread=30 speed=700 gravity=500 drag=1.5 life=3.5 size=9 shape=rect flutter=1 fill="accent, warn, good, bad, #FFD166"`;

const SNOW = `scene "Snow in a gusting wind" w=600 h=340 duration=12 bg="#0B1D3A"
  let wind={40*sin(t*PI/3) + 15*sin(t*PI*2/3)}
  emit count=300 x=-80 y=-10 w=760 angle=90 spread=20 speed=40 gravity=60 drag=1 wind={wind} life=7 size=4 fill="#FFFFFF, #DDE7F5"`;

const FIREWORK = `scene "A firework" w=600 h=340 duration=3 bg="#0B1D3A"
  line x1=300 y1={340 - 220*ease(t, 0, 0.9)} x2=300 y2={370 - 220*ease(t, 0, 0.9)} stroke=warn width=3 opacity={t < 0.9 ? 1 : 0}
  emit count=150 from=0.9 x=300 y=120 spread=360 speed=260 gravity=120 drag=2 life=1.6 size=6 shape=line fill="warn, #FFD166, bad"`;

describe("emit: the motion math", () => {
  it("uses a series near no drag that agrees with the closed form", () => {
    for (const [k, tau] of [[0.0009, 1], [1e-4, 3], [2e-3, 0.4]] as const) {
      const s = dragIntegrals(k, tau);
      const E = Math.exp(-k * tau), A = (1 - E) / k, B = (tau - A) / k;
      expect(s.E).toBeCloseTo(E, 9);
      expect(s.A).toBeCloseTo(A, 9);
      // The closed form's B loses digits here; the series is the better of the two.
      expect(s.B).toBeCloseTo(B, 5);
    }
    expect(dragIntegrals(0, 2)).toEqual({ E: 1, A: 2, B: 2 });
  });

  it("gives velocities that are the derivative of the positions", () => {
    const p = params({ count: 12, drag: 1.3, wind: 50, spread: 120, life: 10 });
    const a = buf(), b = buf(), v = buf();
    const t = 1.7, e = 1e-4;
    expect(computeParticles(p, t - e, still, a)).toBe(12);
    computeParticles(p, t + e, still, b);
    computeParticles(p, t, still, v);
    for (let i = 0; i < 12; i++) {
      const o = i * STRIDE;
      expect((b[o]! - a[o]!) / (2 * e)).toBeCloseTo(v[o + 2]!, 2);
      expect((b[o + 1]! - a[o + 1]!) / (2 * e)).toBeCloseTo(v[o + 3]!, 2);
    }
  });

  it("builds a wind table that matches the closed form for a steady wind, at every age", () => {
    for (const k of [1.2, 0, 1e-5, 15]) {
      const W = 40, step = 7 / 12;
      const table = windTable(new Array(13).fill(W), step, k);
      const out = new Float64Array(2);
      for (let tau = 0; tau <= 7; tau += 0.137) {
        const { E, B } = dragIntegrals(k, tau);
        windDrift(table, tau, out);
        expect(out[0]).toBeCloseTo(W * k * B, 6);
        expect(out[1]).toBeCloseTo(W * (1 - E), 6);
      }
    }
  });

  it("fits an endless flow's cycle to a looping scene", () => {
    expect(cycleOf(7, { duration: 12, loop: true })).toBe(6);
    expect(cycleOf(2, { duration: 12, loop: true })).toBe(2);
    expect(cycleOf(30, { duration: 12, loop: true })).toBe(12);
    expect(cycleOf(7, { duration: 12, loop: false })).toBe(7);
  });

  it("starts a burst at from= and is over after its life", () => {
    const p = params({ from: 1, life: 2 });
    expect(computeParticles(p, 0.99, still, buf())).toBe(0);
    expect(computeParticles(p, 1.5, still, buf())).toBe(40);
    expect(computeParticles(p, 3.01, still, buf())).toBe(0);
  });

  it("starts an endless flow full", () => {
    const n = computeParticles(params({ from: null, count: 100, life: 2 }), 0, { duration: 12, loop: true }, buf());
    expect(n).toBeGreaterThan(70);
  });
});

describe("emit: deterministic, loop-safe and rate-safe", () => {
  it("draws the same frame for the same moment, and another pattern with another seed", () => {
    const spec = `scene "S" w=600 h=340 duration=4\n  emit count=50 x=300 y=170 spread=360 fill="accent, warn"`;
    expect(trace(spec, 1.234).calls).toEqual(trace(spec, 1.234).calls);
    expect(trace(spec, 1.234).arcs).not.toEqual(trace(spec, 1.3).arcs);
    const seeded = (s: number) => trace(spec.replace("count=50", `count=50 seed=${s}`), 1.234).arcs;
    expect(seeded(1)).toEqual(seeded(1));
    expect(seeded(1)).not.toEqual(seeded(2));
    const a = render(spec, { components: ON }), b = render(spec, { components: ON });
    expect(a.drawOps).toEqual(b.drawOps);
  });

  it("gives copies inside each and use their own pattern", () => {
    const spec = `scene "S" w=600 h=340 duration=4
  define "puff"
    emit count=20 from=0 spread=360 life=3
  each items={range(2)} as=i
    emit count=20 from=0 x=300 y=170 spread=360 life=3
  use "puff" x=100 y=100
  use "puff" x=100 y=100`;
    const { arcs } = trace(spec, 1);
    expect(arcs).toHaveLength(80);
    const xy = (from: number) => arcs.slice(from, from + 20).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).sort().join(" ");
    expect(xy(0)).not.toEqual(xy(20));
    expect(xy(40)).not.toEqual(xy(60));
    // Without anything recording copies, each draw of a line still differs from the last.
    const plain = trace(spec, 1, { press: false }).arcs;
    expect(plain.slice(0, 20)).not.toEqual(plain.slice(20, 40));
  });

  it("loops without a seam: an endless flow at t=0 and at t=duration is the same", () => {
    const p = params({ from: null, count: 200, life: 7, angle: 90, speed: 40, gravity: 60, wind: 20 });
    const clock = { duration: 12, loop: true };
    const a = buf(), b = buf();
    const n = computeParticles(p, 0, clock, a);
    expect(computeParticles(p, 12, clock, b)).toBe(n);
    expect(Array.from(b.subarray(0, n * STRIDE))).toEqual(Array.from(a.subarray(0, n * STRIDE)));
    const spec = `scene "S" w=600 h=340 duration=12\n  emit count=200 life=7 angle=90 speed=40 gravity=60`;
    expect(trace(spec, 12).calls).toEqual(trace(spec, 0).calls);
  });

  it("follows the scene clock when rate= switches from 1 to 4: no jumps, only faster", () => {
    const box = { node: { id: "1:scene", type: "scene", props: {}, children: [], line: 1, indent: 0 } } as unknown as Box;
    const views = new Map<string, Record<string, unknown>>();
    const ctx = { now: 0, motion: true, requestFrame: () => {}, view: (n: { id: string }) => { let v = views.get(n.id); if (!v) views.set(n.id, (v = {})); return v; } } as unknown as PaintContext & { now: number };
    const p = params({ count: 30, life: 30, spread: 90, drag: 0.5 });
    const clock: EmitClock = { duration: 30, loop: false };
    let prev: Float64Array | null = null, prevT = 0, worst = 0;
    for (let frame = 0; frame < 120; frame++) {
      ctx.now = frame * 16;
      const t = sceneTime(box, ctx, 30, false, frame < 60 ? 1 : 4);
      const out = buf();
      expect(computeParticles(p, t, clock, out)).toBe(frame === 0 ? 0 : 30);
      if (prev && frame > 1) {
        const dt = t - prevT;
        expect(dt).toBeLessThanOrEqual(4 * 0.016 + 1e-9);
        for (let i = 0; i < 30; i++) {
          const o = i * STRIDE;
          const step = Math.hypot(out[o]! - prev[o]!, out[o + 1]! - prev[o + 1]!);
          const v = Math.hypot(prev[o + 2]!, prev[o + 3]!) + 400 * dt;
          worst = Math.max(worst, step / (v * dt));
        }
      }
      prev = out; prevT = t;
    }
    // Each frame's step is what the particle's speed covers in that frame's scene time.
    expect(worst).toBeLessThan(1.05);
  });

  it("drifts smoothly with a gusting let wind, as the motion it stands for", () => {
    const spec = `scene "S" w=600 h=340 duration=12
  let wind={40*sin(t*PI/3) + 15*sin(t*PI*2/3)}
  emit count=1 from=0 x=300 y=170 spread=0 speed=0 gravity=0 drag=1.5 life=8 wind={wind}`;
    const xs: number[] = [];
    for (let k = 1; k < 5.9 * 60; k++) xs.push(trace(spec, k / 60).arcs[0]![0]);
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i]! - xs[i - 1]!)).toBeLessThan(1.5);
    // The same motion worked out step by step: drag pulls the speed toward the wind.
    const W = (s: number) => 40 * Math.sin((s * Math.PI) / 3) + 15 * Math.sin((s * Math.PI * 2) / 3);
    let x = 300, v = 0;
    const dt = 1e-4;
    for (let s = 0; s < 5; s += dt) { v += -1.5 * (v - W(s)) * dt; x += v * dt; }
    // Twelve wind samples over a life take the 3 s gust as straight pieces: within a few percent of the drift.
    expect(Math.abs(x - 300)).toBeGreaterThan(40);
    expect(Math.abs(trace(spec, 5).arcs[0]![0] - x)).toBeLessThan(0.08 * Math.abs(x - 300));
    // A formula that doesn't change is a steady wind, drawn exactly the same.
    const steady = (w: string) => trace(`scene "S" w=600 h=340 duration=12\n  emit count=30 from=0 drag=1 wind=${w}`, 1.5).calls;
    expect(steady("{25}")).toEqual(steady("25"));
  });
});

describe("emit: the particle cap", () => {
  it("warns when count is more than a scene draws", () => {
    const d = parse(`scene "S" w=600 h=340\n  emit count=900\n`, reg).diagnostics;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ line: 2, severity: "warning" });
    expect(d[0]!.message).toContain("600");
    expect(parse(`scene "S" w=600 h=340\n  emit count=600\n`, reg).diagnostics).toEqual([]);
  });

  it("shares 600 between emit lines in drawing order, and the drawing check names the line that got fewer", () => {
    const spec = `scene "S" w=600 h=340 duration=4
  emit count=400 from=0 life=10 x=300 y=170 spread=360
  emit count=400 from=0 life=10 x=300 y=170 spread=360 fill=warn`;
    const { f, arcs } = trace(spec, 0.5);
    expect(arcs).toHaveLength(600);
    expect(f.particles).toBe(600);
    expect(f.particlesAsked).toBe(800);
    expect(f.particlesOver).toBe(3);
    // Each emit line is one toward the shape limit, however many particles it has.
    expect(f.shapes).toBe(2);
    const review = reviewScenes(parse(spec, reg));
    const over = review.filter((d) => d.message.includes("particles"));
    expect(over).toHaveLength(1);
    expect(over[0]!.line).toBe(3);
    expect(over[0]!.message).toContain("800");
    expect(reviewScenes(parse(spec.replace(/count=400/g, "count=300"), reg)).filter((d) => d.message.includes("particles"))).toEqual([]);
  });

  it("clamps a formula count", () => {
    const { f, arcs } = trace(`state n=900\nscene "S" w=600 h=340 duration=4\n  emit count={n} from=0 life=10`, 0.5);
    expect(f.particlesAsked).toBe(600);
    expect(arcs).toHaveLength(600);
    expect(trace(`scene "S" w=600 h=340\n  emit count={-5} from=0`, 0.5).arcs).toHaveLength(0);
  });
});

describe("emit: reduced motion", () => {
  it("asks for no frames and shows a still", () => {
    const spec = `scene "S" w=600 h=340 duration=12\n  emit count=80 life=7 angle=90 fill="#123456"`;
    const ui = render(spec, { components: ON, reducedMotion: true, animate: true, clock: true });
    expect(ui.clock.pending).toBe(0);
    const first = ui.drawOps.map((o) => [o.op, o.args, o.fillStyle, o.globalAlpha]);
    expect(ui.drawOps.some((o) => o.op === "fill" && o.fillStyle === "#123456")).toBe(true);
    ui.clock.advance(1000);
    expect(ui.drawOps.map((o) => [o.op, o.args, o.fillStyle, o.globalAlpha])).toEqual(first);
    ui.destroy();
  });

  it("shows a burst still in the air at the still, as every formula sees t = duration there", () => {
    const spec = `scene "S" w=600 h=340 duration=2.5\n  emit count=80 from=0.5 life=3 fill="#123456"`;
    const ui = render(spec, { components: ON, reducedMotion: true, animate: true, clock: true });
    expect(ui.drawOps.some((o) => o.op === "fill" && o.fillStyle === "#123456")).toBe(true);
    ui.destroy();
  });

  it("draws nothing for a burst that ended before the still", () => {
    const spec = `scene "S" w=600 h=340 duration=4\n  emit count=80 from=0.5 life=1 fill="#123456"`;
    const ui = render(spec, { components: ON, reducedMotion: true, animate: true, clock: true });
    expect(ui.drawOps.some((o) => o.fillStyle === "#123456")).toBe(false);
    expect(ui.clock.pending).toBe(0);
    ui.destroy();
  });
});

describe("emit: the particles switch", () => {
  it("is an unknown element with particles off, and the guide doesn't mention it", () => {
    const off = new Registry(OFF);
    const d = parse(`scene "S" w=600 h=340\n  emit count=10\n  circle x=1 y=1 r=5`, off).diagnostics;
    expect(d.filter((x) => x.severity === "error").map((x) => x.line)).toEqual([2]);
    expect(languageGuide(off)).not.toMatch(/\bemit\b(?!:)/);
    expect(languageGuide(reg)).toMatch(/emit count=/);
  });

  it("draws other scenes exactly the same either way", () => {
    const spec = `scene "S" w=600 h=340 duration=3\n  circle x={100 + 50*t} y=100 r=20 fill=accent\n  label "Hi" x=300 y=50 size=20 fill=ink`;
    const on = render(spec, { components: ON }), off = render(spec, { components: OFF });
    expect(off.drawOps).toEqual(on.drawOps);
    // A line the parser didn't skip (raw node) still draws nothing when the frame says particles are off.
    const parsed = parse(`scene "S" w=600 h=340\n  emit count=10 from=0`, reg);
    const node = sceneOf(parsed.root)!;
    const calls: string[] = [];
    const g = new Proxy({}, { get: (_t, k: string) => (k === "globalAlpha" ? 1 : (...a: unknown[]) => { calls.push(`${k}${a.length}`); }), set: () => true }) as unknown as CanvasRenderingContext2D;
    const f: Frame = { g, font: () => "", colors: lightTheme.colors, defs: new Map(), gradients: new Map(), shapes: 0, steps: 0, useDepth: 0, ends: new Map(), time: 0.5, m: IDENTITY, features: { particles: false, reflect: true } };
    paintScene(f, node.children, (n) => (n === "t" ? f.time : undefined), 600, 340, undefined);
    expect(calls.filter((c) => c.startsWith("arc"))).toEqual([]);
  });
});

describe("emit: never pressable", () => {
  it("warns about on= and registers no hit region", () => {
    const spec = `state n=0\nscene "S" w=600 h=340 duration=4\n  emit count=40 from=0 life=10 x=300 y=170 on=inc:n`;
    const d = parse(spec, reg).diagnostics;
    expect(d.some((x) => x.severity === "warning" && x.message.includes('"emit" has no prop "on"'))).toBe(true);
    const ui = render(spec, { components: ON });
    expect(sceneRegions(ui.find({ type: "scene" }).node)?.regions.size ?? 0).toBe(0);
    expect(ui.hits.filter((h) => h.box.node.type === "scene")).toEqual([]);
    ui.destroy();
  });
});

describe("emit: the acceptance pictures", () => {
  for (const [name, spec] of [["confetti", CONFETTI], ["snow", SNOW], ["firework", FIREWORK]] as const) {
    it(`${name} parses and passes the drawing check`, () => {
      const parsed = parse(spec, reg);
      expect(parsed.diagnostics).toEqual([]);
      expect(reviewScenes(parsed)).toEqual([]);
    });
  }

  it("bursts confetti from both sides at t=1.3, tumbling as it falls", () => {
    expect(trace(CONFETTI, 1.29).calls.some((c) => c.startsWith("fill("))).toBe(false);
    const { calls } = trace(CONFETTI, 2.2);
    const fills = calls.filter((c) => c.startsWith("fill("));
    expect(fills.length).toBeGreaterThan(2);
    expect(fills.length).toBeLessThanOrEqual(2 * 5 * 8);
    // Particles on both halves of the picture.
    const xs = calls.filter((c) => c.startsWith("moveTo(")).map((c) => Number(c.slice(7).split(",")[0]));
    expect(xs.some((x) => x < 250)).toBe(true);
    expect(xs.some((x) => x > 350)).toBe(true);
    // Five colors.
    const colors = new Set(calls.filter((c) => c.startsWith("fillStyle=")));
    expect(colors.size).toBe(5);
  });

  it("snows all the time, the same at the loop's end as its start", () => {
    for (const t of [0, 3, 6, 9]) expect(trace(SNOW, t).arcs.length).toBeGreaterThan(150);
    expect(trace(SNOW, 12).calls).toEqual(trace(SNOW, 0).calls);
  });

  it("rises, then bursts in streaks along their motion", () => {
    expect(trace(FIREWORK, 0.5).calls.filter((c) => c.startsWith("stroke(")).length).toBe(1);
    const { calls } = trace(FIREWORK, 1.2);
    expect(calls.filter((c) => c.startsWith("stroke(")).length).toBeGreaterThan(2);
    expect(calls).toContain("lineCap=round");
  });
});

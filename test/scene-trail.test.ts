/**
 * trail= in scenes (S5, src/components/scene/trail.ts): fading copies drawn at
 * earlier scene times before the line itself, never pressable, only while the
 * scene moves, within their own budget, right across loop restarts, after a
 * non-looping end and through rate= changes, inside groups and uses, with z=
 * and lets, and the parser's view of the props.
 */
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { reviewScenes, sceneComponents } from "../src/components/scene";
import { MAX_TRAIL_DRAWS, pivotOf, sampleTime } from "../src/components/scene/trail";
import { render, type Rendered } from "../src/testing";
import type { Box } from "../src/types";

const ON = [...coreComponents, ...sceneComponents];
const reg = new Registry(ON);
const MOVING = { components: ON, animate: true, clock: true } as const;

/** Each fillText of these words this frame: its x and its opacity, in drawing order. */
const texts = (ui: Rendered, words: string) =>
  ui.drawOps.filter((o) => o.op === "fillText" && o.args[0] === words).map((o) => ({ x: Number(o.args[1]), alpha: o.globalAlpha }));
const fillsOf = (ui: Rendered, color: string) => ui.drawOps.filter((o) => o.op === "fill" && o.fillStyle === color);
const sceneAt = (ui: Rendered, w: number, h: number) => {
  const box = ui.find({ type: "scene" }).box as Box;
  return (x: number, y: number): [number, number] => [box.x + (x * box.w) / w, box.y + (y * box.h) / h];
};

describe("trail: copies", () => {
  it("draws its copies first, faintest first and all fainter than 0.55 of it, then the line at its own opacity", () => {
    const ui = render(`scene "Moving" w=600 h=300 duration=10
  label "L" x={100 + 10*t} y=100 trail=1 opacity=0.8`, MOVING);
    ui.clock.advance(2000);
    const all = texts(ui, "L");
    expect(all).toHaveLength(13);
    const copies = all.slice(0, -1), line = all[all.length - 1]!;
    expect(line.x).toBeCloseTo(120);
    expect(line.alpha).toBeCloseTo(0.8);
    for (let i = 0; i < copies.length; i++) {
      expect(copies[i]!.x).toBeCloseTo(100 + 10 * (2 - (12 - i) / 12));
      expect(copies[i]!.alpha).toBeLessThan(0.55 * 0.8);
      if (i) expect(copies[i]!.alpha).toBeGreaterThan(copies[i - 1]!.alpha);
    }
    ui.destroy();
  });

  it("follows trail-count=, and clamps it", () => {
    const count = (n: string) => {
      const ui = render(`scene "M" w=600 h=300 duration=10\n  label "L" x={10*t} y=100 trail=1 trail-count=${n}`, MOVING);
      ui.clock.advance(2000);
      const c = texts(ui, "L").length - 1;
      ui.destroy();
      return c;
    };
    expect(count("4")).toBe(4);
    expect(count("100")).toBe(24);
    expect(count("0")).toBe(1);
  });

  it("works on every shape", () => {
    const ui = render(`scene "Shapes" w=600 h=300 duration=10
  rect x={10*t} y=10 w=20 h=20 fill="#000001" trail=1 trail-count=3
  circle x={10*t} y=50 r=10 fill="#000002" trail=1 trail-count=3
  ellipse x={10*t} y=80 rx=10 ry=5 fill="#000003" trail=1 trail-count=3
  polygon points="{10*t},100 {10*t+20},100 {10*t},120" fill="#000004" trail=1 trail-count=3
  path d="M{10*t} 130 L{10*t+20} 140 Z" fill="#000005" trail=1 trail-count=3
  line x1={10*t} y1=150 x2=200 y2=150 stroke="#000006" trail=1 trail-count=3`, MOVING);
    ui.clock.advance(2000);
    for (const c of ["#000001", "#000002", "#000003", "#000004", "#000005"]) expect(fillsOf(ui, c)).toHaveLength(4);
    expect(ui.drawOps.filter((o) => o.op === "stroke" && o.strokeStyle === "#000006")).toHaveLength(4);
    ui.destroy();
  });

  it("keeps copies out of presses: the same hit regions, and only the line itself is pressed", () => {
    const spec = (trail: string) => `state n=0
scene "Press" w=600 h=300 duration=10
  circle x={100 + 100*t} y=100 r=20 fill=accent on=inc:n tip="Ball"${trail}`;
    const plain = render(spec(""), MOVING), trailed = render(spec(" trail=1"), MOVING);
    plain.clock.advance(2000);
    trailed.clock.advance(2000);
    expect(trailed.hits.length).toBe(plain.hits.length);
    const at = sceneAt(trailed, 600, 300);
    // A copy half a second back sits at x=250; the ball is at 300.
    trailed.click(...at(250, 100));
    expect(trailed.state.n).toBe(0);
    trailed.click(...at(300, 100));
    expect(trailed.state.n).toBe(1);
    plain.destroy();
    trailed.destroy();
  });
});

describe("trail: only while the scene moves", () => {
  const SPEC = `scene "M" w=600 h=300 duration=10\n  label "L" x={10*t} y=100 trail=1`;
  const one = (ui: Rendered) => { const n = texts(ui, "L").length; ui.destroy(); return n; };

  it("draws no copies with reduced motion, animate off, or a still", () => {
    const reduced = render(SPEC, { ...MOVING, reducedMotion: true });
    reduced.clock.advance(2000);
    expect(one(reduced)).toBe(1);
    expect(one(render(SPEC, { components: ON }))).toBe(1);
    const still = render(SPEC.replace("duration=10", "duration=0"), MOVING);
    still.clock.advance(2000);
    expect(one(still)).toBe(1);
  });

  it("leaves copies out of the drawing check", () => {
    // Copies of a slow label would overlap it and each other; the check sees only the label.
    const spec = (trail: string) => `scene "Check" w=600 h=300 duration=4\n  label "Hello there" x={100 + 5*t} y=100 size=20${trail}`;
    const messages = (s: string) => reviewScenes(parse(s, reg)).map((d) => d.message);
    expect(messages(spec(" trail=2"))).toEqual(messages(spec("")));
  });
});

describe("trail: budget", () => {
  it("thins 150 trails evenly to the budget and still draws the lines after them", () => {
    const ui = render(`scene "Snow" w=600 h=340 duration=10
  each items={range(150)} as=i
    circle x={(random(i)*600 + t*20) % 600} y={(random(i + 1)*340 + t*30) % 340} r=2 fill="#FFFFFF" trail=1
  label "END" x=10 y=10`, MOVING);
    for (const ms of [500, 500, 1000]) {
      ui.clock.advance(ms);
      const flakes = fillsOf(ui, "#FFFFFF").length;
      expect(flakes).toBeGreaterThan(150);
      expect(flakes - 150).toBeLessThanOrEqual(MAX_TRAIL_DRAWS);
      expect(texts(ui, "END")).toHaveLength(1);
    }
    // Evenly: 1800 asked for, 300 allowed, so every flake keeps 2 of its 12.
    expect(fillsOf(ui, "#FFFFFF").length - 150).toBe(MAX_TRAIL_DRAWS);
    ui.destroy();
  });

  it("keeps a heavy trail from using up the scene's own shape limit", () => {
    const ui = render(`scene "Heavy" w=600 h=340 duration=10
  group x={10*t} y=0 trail=2 trail-count=24
    each items={range(1900)} as=i
      rect x={i % 60} y={floor(i / 60)} w=1 h=1 fill="#000007"
  label "END" x=10 y=10`, MOVING);
    ui.clock.advance(3000);
    expect(fillsOf(ui, "#000007").length - 1900).toBeLessThanOrEqual(MAX_TRAIL_DRAWS);
    expect(texts(ui, "END")).toHaveLength(1);
    ui.destroy();
  });
});

describe("trail: time", () => {
  it("has no copies on a loop's first frame, and right after a restart shows the end of the loop", () => {
    const ui = render(`scene "Loop" w=600 h=300 duration=4\n  label "L" x={100*t} y=100 trail=1 trail-count=4`, MOVING);
    expect(texts(ui, "L")).toHaveLength(1);
    ui.clock.advance(4250);
    const xs = texts(ui, "L").map((o) => o.x);
    // Back 1, 0.75, 0.5, 0.25 from t=0.25: 3.25, 3.5, 3.75 (the end of the last loop) and 0, then the label at 0.25.
    [325, 350, 375, 0, 25].forEach((x, i) => expect(xs[i]).toBeCloseTo(x));
    ui.destroy();
  });

  it("on the first play, leaves out copies from before the start", () => {
    const ui = render(`scene "Loop" w=600 h=300 duration=4\n  label "L" x={100*t} y=100 trail=1 trail-count=4`, MOVING);
    ui.clock.advance(500);
    expect(texts(ui, "L").map((o) => Math.round(o.x))).toEqual([0, 25, 50]);
    ui.destroy();
  });

  it("without loop, lets the tail fade after the end, then draws none", () => {
    const ui = render(`scene "Once" w=600 h=300 duration=2 loop=false\n  label "L" x={100*t} y=100 trail=1 trail-count=4`, MOVING);
    ui.clock.advance(1000);
    expect(texts(ui, "L")).toHaveLength(5);
    ui.clock.advance(1400);
    // Played 2.4: copies at 1.4, 1.65 and 1.9; the one at 2.15 would be past the end.
    expect(texts(ui, "L").map((o) => Math.round(o.x))).toEqual([140, 165, 190, 200]);
    ui.clock.advance(1100);
    expect(texts(ui, "L").map((o) => o.x)).toEqual([200]);
    ui.destroy();
  });

  it("follows scene time through a rate= change", () => {
    const ui = render(`state speed=1
scene "Rate" w=600 h=300 duration=10 rate={speed}
  label "L" x={100*t} y=100 trail=1 trail-count=4`, MOVING);
    ui.clock.advance(2000);
    ui.set("speed", 4);
    ui.clock.advance(500);
    // t = 2 + 0.5*4 = 4; copies 1, 0.75, 0.5 and 0.25 scene seconds back.
    [300, 325, 350, 375, 400].forEach((x, i) => expect(texts(ui, "L")[i]!.x).toBeCloseTo(x));
    ui.destroy();
  });

  it("reads lets at each copy's own time", () => {
    const ui = render(`scene "Lets" w=600 h=300 duration=10
  let a={t*10}
  label "L" x={a} y=100 trail=1 trail-count=2`, MOVING);
    ui.clock.advance(3000);
    expect(texts(ui, "L").map((o) => Math.round(o.x))).toEqual([20, 25, 30]);
    ui.destroy();
  });

  it("works out when a copy was on screen", () => {
    expect(sampleTime(1, 0.25, 4.25, 4, true)).toBeCloseTo(3.25);
    expect(sampleTime(1, 0.5, 0.5, 4, true)).toBeNull();
    expect(sampleTime(0.5, 1, 1, 4, false)).toBeCloseTo(0.5);
    expect(sampleTime(0.5, 2, 3, 2, false)).toBeNull();
    expect(sampleTime(0.5, 2, 2.2, 2, false)).toBeCloseTo(1.7);
    expect(sampleTime(0.5, 1, 1, 0, true)).toBeNull();
  });
});

describe("trail: groups, uses, z and lets", () => {
  it("copies a group's whole drawing, without multiplying a trailed line inside it", () => {
    const ui = render(`scene "Group" w=600 h=300 duration=10
  group x={100*t} y=100 trail=1 trail-count=4
    label "A" x=0 y=0
    label "B" x=0 y=20 trail=1 trail-count=4`, MOVING);
    ui.clock.advance(2000);
    expect(texts(ui, "A")).toHaveLength(5);
    // 4 plain in the group's copies, then B's own 4 copies and B.
    expect(texts(ui, "B")).toHaveLength(9);
    ui.destroy();
  });

  it("copies a use's drawing", () => {
    const ui = render(`scene "Use" w=600 h=300 duration=10
  define "dot"
    label "D" x=0 y=0
  use "dot" x={100*t} y=100 trail=1 trail-count=3`, MOVING);
    ui.clock.advance(2000);
    expect(texts(ui, "D")).toHaveLength(4);
    ui.destroy();
  });

  it("moves a trailed planet behind and in front of the Sun with its trail", () => {
    const ui = render(`scene "Orbit" w=600 h=300 duration=8
  circle x=300 y=150 r=30 fill="#ffd166" z=0
  each items={range(1)} as=i
    let a={t*0.785}
    circle x={300 + 140*cos(a)} y={150 + 90*sin(a)} r=10 fill="#2a9d8f" z={sin(a)} trail=1.2`, MOVING);
    const order = () => ui.drawOps.filter((o) => o.op === "fill").map((o) => String(o.fillStyle));
    ui.clock.advance(2000);
    expect(order()).toEqual(["#ffd166", ...Array(13).fill("#2a9d8f")]);
    ui.clock.advance(4000);
    expect(order()).toEqual([...Array(13).fill("#2a9d8f"), "#ffd166"]);
    ui.destroy();
  });
});

describe("trail: acceptance", () => {
  /** The largest jump between neighbouring copies and the line (in drawing order). */
  const largestStep = (pts: Array<{ x: number; y: number }>) =>
    Math.max(...pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y)));
  const points = (ui: Rendered, words: string) =>
    ui.drawOps.filter((o) => o.op === "fillText" && o.args[0] === words).map((o) => ({ x: Number(o.args[1]), y: Number(o.args[2]) }));

  it("keeps an orbiting planet's trail continuous across the restart at t=8", () => {
    const ui = render(`scene "Orbit" w=600 h=340 duration=8
  label "o" x={300 + 140*cos(t*0.785)} y={170 + 90*sin(t*0.785)} trail=1.2`, MOVING);
    // Orbit speed is at most 140*0.785 ≈ 110 px/s; copies are 0.1 s apart.
    for (const ms of [7900, 100, 100, 100]) {
      ui.clock.advance(ms);
      const pts = points(ui, "o");
      expect(pts).toHaveLength(13);
      expect(largestStep(pts)).toBeLessThan(13);
    }
    ui.destroy();
  });

  it("draws the orbiting group's copies on both sides of the restart", () => {
    const ui = render(`scene "Orbit" w=600 h=340 duration=8
  group x={300 + 140*cos(t*0.785)} y={170 + 90*sin(t*0.785)} trail=1.2
    circle x=0 y=0 r=12 fill="#2a9d8f"`, MOVING);
    ui.clock.advance(7950);
    expect(fillsOf(ui, "#2a9d8f")).toHaveLength(13);
    ui.clock.advance(100);
    expect(fillsOf(ui, "#2a9d8f")).toHaveLength(13);
    ui.destroy();
  });

  it("leaves a flying ball's copies at the far edge right after a restart, none across the middle", () => {
    const ui = render(`scene "Ball" w=600 h=340 duration=2.5
  label "o" x={-20 + 640*(t/2.5)} y={260 - 200*sin(PI*t/2.5)} trail=0.4 trail-count=10`, MOVING);
    ui.clock.advance(2550);
    const xs = points(ui, "o").map((p) => p.x);
    expect(xs).toHaveLength(11);
    expect(xs.every((x) => x > 500 || x < 0)).toBe(true);
    expect(xs[xs.length - 1]).toBeLessThan(0);
    ui.destroy();
  });
});

describe("trail: parsing", () => {
  const warnings = (spec: string) => parse(spec, reg).diagnostics.map((d) => d.message);

  it("accepts trail and trail-count on group, use and shapes", () => {
    expect(warnings(`scene "S" w=100 h=100 duration=2
  define "d"
    circle x=0 y=0 r=2
  group trail=0.5 trail-count=6
    circle x=0 y=0 r=2 trail=0.3 trail-count=4
  use "d" trail=1 trail-count=8
  label "L" x=0 y=0 trail={0.2 + 0.1}`)).toEqual([]);
  });

  it("warns for a trail-count that isn't a number", () => {
    expect(warnings(`scene "S" w=100 h=100 duration=2\n  circle x=0 y=0 r=2 trail=1 trail-count=3x`).join(" ")).toMatch(/trail-count should be a number/);
  });
});

describe("trail: where copies shrink", () => {
  // A group without x or y draws its shapes where they are in the scene (planets on an orbit), so
  // its copies only fade; shrinking them around 0,0 pulled every trail to the top-left corner.
  const num = (node: { props: Record<string, string | undefined> }, k: string, _s: unknown, fallback = 0) => {
    const v = node.props[k];
    return v === undefined ? fallback : Number(v);
  };
  const str = (node: { props: Record<string, string | undefined> }, k: string) => node.props[k];
  const groupNode = (props: string) => {
    const r = parse(`scene "S" w=600 h=300 duration=10\n  group ${props}\n    circle x=300 y=150 r=8`, reg);
    return r.root!.children[0]!.children[0]!;
  };

  it("fades a group or use with no x or y in place, without shrinking", () => {
    expect(pivotOf(groupNode("trail=0.5") as never, (() => undefined) as never, { num, str } as never)).toBeNull();
    const use = { ...(groupNode("trail=0.5") as object), type: "use", props: { trail: "0.5" } };
    expect(pivotOf(use as never, (() => undefined) as never, { num, str } as never)).toBeNull();
  });

  it("still shrinks a group around its own x and y when it has them", () => {
    expect(pivotOf(groupNode("x=120 y=80 trail=0.5") as never, (() => undefined) as never, { num, str } as never)?.at).toEqual([120, 80]);
    expect(pivotOf(groupNode("x=120 trail=0.5") as never, (() => undefined) as never, { num, str } as never)?.at).toEqual([120, 0]);
  });

  it("still draws an orbiting group's copies (the test canvas doesn't record transforms; the pivot tests above cover where they sit)", () => {
    const ui = render(`scene "Orbit" w=600 h=300 duration=60
  group trail=0.5
    let a={t}
    label "P" x={300 + 100*cos(a)} y={150 + 100*sin(a)}`, MOVING);
    ui.clock.advance(3000);
    const ps = ui.drawOps.filter((o) => o.op === "fillText" && o.args[0] === "P");
    expect(ps.length).toBeGreaterThan(5);
    ui.destroy();
  });
});

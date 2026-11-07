import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { sceneComponents, sceneTime, reviewScenes, MAX_SCENE_SHAPES, MAX_RANGE, SCENE_FUNCTIONS } from "../src/components/scene";
import { darkTheme, lightTheme } from "../src/theme";
import { points, tracePath, type PathSink } from "../src/components/scene/path";
import { evaluate, expressionFunctions } from "../src/expr";
import { languageGuide } from "../src/prompt";
import { render } from "../src/testing";
import type { PaintContext } from "../src/component";
import type { Box } from "../src/types";

const ON = [...coreComponents, ...sceneComponents];
const on = new Registry(ON);
const off = new Registry(coreComponents);
const problems = (spec: string, registry = on) => parse(spec, registry).diagnostics.map((d) => `${d.line}: ${d.message}`);

/** A small scene that uses most of what scenes have, the way a model writes one. */
const RABBIT = `scene "A rabbit hopping across a meadow" w=600 h=340 duration=3 bg="#BDE0FE"
  gradient id=grass from="#95D5B2" to="#2D6A4F" angle=90
  rect x=0 y=240 w=600 h=100 fill="url(grass)"
  define "cloud"
    ellipse x=0 y=0 rx={30*s} ry={14*s} fill="#FFFFFF"
    ellipse x={22*s} y={-6*s} rx={24*s} ry={12*s} fill="#FFFFFF"
  use "cloud" x={(t*20) % 640} y=60 args={{s: 1.4}}
  use "cloud" x={(300 + t*12) % 640} y=100 args={{s: 1}}
  each items={range(12)} as=i
    circle x={random(i)*600} y={260 + random(i + 3)*70} r=4 fill={pick(['#FFB4A2', '#FFE66D', '#FFFFFF'], i)}
  group x={lerp(-60, 660, (t % 3) / 3)} y={220 - 40*abs(sin(PI*t*2))}
    ellipse x=0 y=0 rx=34 ry=22 fill="#F8F9FA"
    ellipse x=24 y=-26 rx=6 ry=22 fill="#F8F9FA" rotate={10*sin(t*12)}
    path d="M-30 10 Q-40 {24 + 6*sin(t*12)} -18 22" stroke="#ADB5BD" width=3
    circle x=30 y=-6 r=3 fill="#212529"
  label "Hop {round(t, 1)}s" x=300 y=30 size=20 weight=bold align=center fill="#1D3557"
`;

describe("scene is off unless its components are registered", () => {
  it("is an unknown element without sceneComponents", () => {
    expect(problems(RABBIT, off)[0]).toMatch(/Unknown element "scene"/);
  });

  it("leaves scene math out of expressions everywhere else", () => {
    expect(problems(`state a=1\ntext "{sin(a)}"`)).toEqual([expect.stringMatching(/Unknown function "sin"/)]);
    expect(evaluate("sin(1)", () => undefined).ok).toBe(false);
  });

  it("isn't in the model guide unless registered", () => {
    expect(languageGuide(off)).not.toMatch(/\bscene\b/);
    expect(languageGuide(on)).toMatch(/scene "The sun rising over hills"/);
  });
});

describe("parsing scenes", () => {
  it("parses a model-style scene with no problems", () => {
    expect(problems(RABBIT)).toEqual([]);
  });

  it("knows t and PI inside a scene, and the names a drawing's use passes", () => {
    expect(problems(`scene "Spin" duration=2\n  rect x=10 y=10 w=20 h=20 rotate={t*PI}\n  define "dot"\n    circle x=0 y=0 r={size}`)).toEqual([]);
  });

  it("still warns about names nothing defines outside a drawing", () => {
    expect(problems(`scene "Spin"\n  circle x={nowhere} y=10 r=5`).join("\n")).toMatch(/nowhere/);
  });

  it("only allows scene shapes inside a scene, and only shapes in it", () => {
    expect(problems(`rect x=1 y=1 w=2 h=2`)[0]).toMatch(/rect.*only goes inside/);
    expect(problems(`scene "A"\n  button "Go"`)[0]).toMatch(/can't contain "button"/);
  });

  it("parses every prefix of a scene cut at a line (streaming)", () => {
    const lines = RABBIT.split("\n");
    for (let i = 1; i <= lines.length; i++) {
      const errors = parse(lines.slice(0, i).join("\n") + "\n", on).diagnostics.filter((d) => d.severity === "error");
      expect(errors, `first ${i} lines`).toEqual([]);
    }
  });
});

describe("scene math", () => {
  const run = (src: string) => evaluate(src, (n) => (n === "i" ? 3 : undefined), SCENE_FUNCTIONS);

  it("works out the functions a scene offers", () => {
    expect(run("sin(0)")).toEqual({ ok: true, value: 0 });
    expect(run("clamp(5, 0, 2)")).toEqual({ ok: true, value: 2 });
    expect(run("lerp(10, 20, 0.5)")).toEqual({ ok: true, value: 15 });
    expect(run("ease(1, 0, 1)")).toEqual({ ok: true, value: 1 });
    expect(run("ease(-1, 0, 1)")).toEqual({ ok: true, value: 0 });
    expect(run("pick(['a', 'b'], i)")).toEqual({ ok: true, value: "b" });
  });

  it("makes random repeatable and range bounded", () => {
    expect(run("random(i)")).toEqual(run("random(3)"));
    const r = run("random(i)");
    expect(r.ok && typeof r.value === "number" && r.value >= 0 && r.value < 1).toBe(true);
    const big = run("len(range(1000000))");
    expect(big).toEqual({ ok: true, value: MAX_RANGE });
  });

  it("can't reach JavaScript through an extra function set", () => {
    for (const src of ["constructor(1)", "__proto__(1)", "toString()", "hasOwnProperty('x')", "sin.constructor", "range(3).constructor"]) {
      const r = run(src);
      expect(r.ok && typeof r.value === "function", src).toBe(false);
    }
    // A set made from an object with a prototype still only offers its own names.
    const fns = expressionFunctions({ double: (x) => (typeof x === "number" ? x * 2 : null) });
    expect(evaluate("double(2)", () => undefined, fns)).toEqual({ ok: true, value: 4 });
    expect(evaluate("valueOf()", () => undefined, fns).ok).toBe(false);
  });

  it("never lets an extra set replace a built-in function", () => {
    const fns = expressionFunctions({ round: () => 999 });
    expect(evaluate("round(1.4)", () => undefined, fns)).toEqual({ ok: true, value: 1 });
  });
});

describe("drawing scenes", () => {
  it("draws its shapes, scaled to fit the width, in the spec's colors", () => {
    const ui = render(`scene "Dot" w=300 h=150\n  circle x=150 y=75 r=20 fill="#E63946"`, { components: ON, width: 600 });
    const box = ui.sayshape.boxes!.children[0]!;
    // 560 wide (600 less padding), so twice as tall as it is half as wide: 280.
    expect(box.h).toBeCloseTo((box.w * 150) / 300);
    expect(ui.drawOps.some((op) => op.op === "fill" && op.fillStyle === "#E63946")).toBe(true);
    ui.destroy();
  });

  it("draws a still at the end of the animation when motion is off", () => {
    const ui = render(`scene "Clock" w=300 h=150 duration=2\n  label "t={t}" x={t*100} y=75 fill="#000000"`, { components: ON });
    expect(ui.drawOps.find((op) => op.op === "fillText")?.args.slice(0, 2)).toEqual(["t=2", 200]);
    ui.destroy();
  });

  it("ignores colors and gradient references that aren't colors", () => {
    const ui = render(`scene "Odd" w=100 h=100\n  rect x=0 y=0 w=10 h=10 fill="url(http://example.com/x)"\n  rect x=0 y=0 w=10 h=10 fill="expression(alert(1))"`, { components: ON });
    expect(ui.drawOps.filter((op) => op.op === "fill")).toEqual([]);
    ui.destroy();
  });

  it("stops at the shape limit instead of stalling", () => {
    const spec = `scene "Lots" w=100 h=100\n  each items={range(500)} as=a\n    each items={range(500)} as=b\n      rect x=0 y=0 w=1 h=1 fill="#000000"`;
    const ui = render(spec, { components: ON });
    const fills = ui.drawOps.filter((op) => op.op === "fill").length;
    expect(fills).toBeGreaterThan(0);
    expect(fills).toBeLessThanOrEqual(MAX_SCENE_SHAPES);
    ui.destroy();
  });

  it("stops a drawing that uses itself", () => {
    const ui = render(`scene "Loop" w=100 h=100\n  define "me"\n    circle x=0 y=0 r=2 fill="#000000"\n    use "me" x=1\n  use "me"`, { components: ON });
    expect(ui.drawOps.filter((op) => op.op === "fill").length).toBeLessThanOrEqual(8);
    ui.destroy();
  });

  it("is a picture to screen readers, named by its text", () => {
    const ui = render(RABBIT, { components: ON });
    expect(JSON.stringify(ui.accessibility())).toMatch(/A rabbit hopping across a meadow/);
    ui.destroy();
  });
});

describe("the scene clock", () => {
  const box = { node: { id: "1:scene", type: "scene", props: {}, children: [], line: 1, indent: 0 } } as unknown as Box;
  const clock = (now: number, motion = true) => {
    const views = new Map<string, Record<string, number>>();
    let frames = 0;
    const ctx = {
      now, motion,
      view: (n: { id: string }) => { let v = views.get(n.id); if (!v) views.set(n.id, (v = {})); return v; },
      requestFrame: () => { frames++; },
    } as unknown as PaintContext & { now: number };
    return { ctx, frames: () => frames };
  };

  it("counts seconds from the first frame and loops", () => {
    const c = clock(1000);
    expect(sceneTime(box, c.ctx, 2, true)).toBe(0);
    c.ctx.now = 3500;
    expect(sceneTime(box, c.ctx, 2, true)).toBeCloseTo(0.5);
    expect(c.frames()).toBe(2);
  });

  it("stops at the end without loop, and stops asking for frames", () => {
    const c = clock(0);
    sceneTime(box, c.ctx, 2, false);
    c.ctx.now = 5000;
    expect(sceneTime(box, c.ctx, 2, false)).toBe(2);
    expect(c.frames()).toBe(1);
  });

  it("is a still with no motion, and still pictures never animate", () => {
    const c = clock(0, false);
    expect(sceneTime(box, c.ctx, 3, true)).toBe(3);
    expect(sceneTime(box, clock(0).ctx, 0, true)).toBe(0);
    expect(c.frames()).toBe(0);
  });
});

describe("path data", () => {
  const sink = () => {
    const calls: string[] = [];
    const s = new Proxy({} as PathSink, { get: (_t, k) => (...a: number[]) => { calls.push(`${String(k)} ${a.map((x) => (typeof x === "number" ? Math.round(x * 10) / 10 : x)).join(" ")}`); } });
    return { s, calls };
  };

  it("draws absolute and relative commands", () => {
    const { s, calls } = sink();
    const b = tracePath("M10 10 l20 0 v20 H10 Z", s);
    expect(calls).toEqual(["moveTo 10 10", "lineTo 30 10", "lineTo 30 30", "lineTo 10 30", "closePath "]);
    expect(b).toEqual({ x: 10, y: 10, w: 20, h: 20 });
  });

  it("reflects control points for S and T, and turns arcs into ellipses", () => {
    const { s, calls } = sink();
    tracePath("M0 0 C0 10 10 10 10 0 S20 -10 20 0 Q25 10 30 0 T40 0 A10 10 0 0 1 60 0", s);
    expect(calls[2]).toBe("bezierCurveTo 10 -10 20 -10 20 0");
    expect(calls[4]).toBe("quadraticCurveTo 35 -10 40 0");
    expect(calls[5]).toMatch(/^ellipse 50 0 10 10/);
  });

  it("never throws on broken paths", () => {
    for (const d of ["", "L10", "M10", "M1 2 C3", "Z Z", "M1e999 2 L3 4", "nonsense"]) {
      expect(() => tracePath(d, sink().s), d).not.toThrow();
    }
  });

  it("reads polygon points in pairs", () => {
    expect(points("0,0 10,5 20 10 7")).toEqual([[0, 0], [10, 5], [20, 10]]);
  });
});

describe("theme colors in scenes", () => {
  const fills = (spec: string, theme = lightTheme) => {
    const ui = render(spec, { components: ON, theme });
    const out = ui.drawOps.filter((op) => op.op === "fill").map((op) => op.fillStyle);
    ui.destroy();
    return out;
  };

  it("paints theme color names in the theme's colors, and follows the theme", () => {
    const spec = `scene "Roles" w=100 h=100\n  rect x=0 y=0 w=10 h=10 fill=accent\n  rect x=0 y=0 w=10 h=10 fill=bad`;
    expect(fills(spec)).toEqual([lightTheme.colors.accent, lightTheme.colors.bad]);
    expect(fills(spec, darkTheme)).toEqual([darkTheme.colors.accent, darkTheme.colors.bad]);
  });

  it("fades a theme color with a percentage, and reads text as ink", () => {
    const [faded, ink] = fills(`scene "Faded" w=100 h=100\n  rect x=0 y=0 w=10 h=10 fill="bad 15%"\n  rect x=0 y=0 w=10 h=10 fill=text`);
    expect(faded).toMatch(/^rgba\(\d+, \d+, \d+, 0\.15\)$/);
    expect(ink).toBe(lightTheme.colors.ink);
  });

  it("still takes literal colors, and ignores theme names it doesn't offer", () => {
    expect(fills(`scene "Mixed" w=100 h=100\n  rect x=0 y=0 w=10 h=10 fill="#123456"\n  rect x=0 y=0 w=10 h=10 fill=debug`)).toEqual(["#123456"]);
  });
});

describe("the drawing check", () => {
  const review = (spec: string) => reviewScenes(parse(spec, on)).map((d) => `${d.line}: ${d.message}`);

  it("finds a label cut off by the edge", () => {
    expect(review(`scene "A" w=300 h=100\n  label "OUTLET | FLOW NORMAL" x=200 y=20 size=22 weight=bold fill=ink`))
      .toEqual([expect.stringMatching(/^2: Drawing: the label "OUTLET \| FLOW NORMAL" is cut off by the right edge/)]);
  });

  it("finds labels on top of each other, but not a deliberate shadow", () => {
    expect(review(`scene "A" w=300 h=100\n  label "Delay" x=20 y=50 size=20\n  label "Delay 40 min" x=30 y=52 size=20`))
      .toEqual([expect.stringMatching(/^3: Drawing: the label "Delay 40 min" is drawn on top of "Delay" \(line 2\)/)]);
    expect(review(`scene "A" w=300 h=100\n  label "GOAL" x=22 y=52 size=40 fill="#000000"\n  label "GOAL" x=20 y=50 size=40 fill=accent`)).toEqual([]);
  });

  it("finds a label straddling a box's edge", () => {
    expect(review(`scene "A" w=300 h=200\n  rect x=50 y=50 w=120 h=60 fill=bad\n  label "BOTTLENECK" x=110 y=110 size=14 align=center fill=ink`))
      .toEqual([expect.stringMatching(/^3: Drawing: the label "BOTTLENECK" straddles the edge of the rect on line 2/)]);
  });

  it("finds a line hidden under a box drawn after it", () => {
    const spec = `scene "Outage" w=600 h=300
  line x1=230 y1=150 x2=470 y2=150 stroke=line width=3
  rect x=300 y=125 w=100 h=50 fill=surface
  rect x=470 y=125 w=100 h=50 fill=surface`;
    expect(review(spec)).toEqual([expect.stringMatching(/^2: Drawing: this line runs under the rect on line 3/)]);
  });

  it("says nothing about a tidy scene, a background, or labels inside their boxes", () => {
    expect(review(`scene "Tidy" w=600 h=300 bg=surface
  rect x=0 y=0 w=600 h=300 fill=raised
  line x1=160 y1=150 x2=300 y2=150 stroke=line width=3
  rect x=40 y=125 w=120 h=50 fill=surface stroke=line
  rect x=300 y=125 w=120 h=50 fill="bad 15%" stroke=bad
  label "Web App" x=100 y=150 size=16 align=center fill=ink
  label "Orders" x=360 y=150 size=16 align=center fill=bad`)).toEqual([]);
    expect(review(RABBIT)).toEqual([]);
  });

  it("checks the picture as it rests, at the end of its animation", () => {
    // At t=0 the label is cut off; by the end it has slid fully inside.
    expect(review(`scene "Slide" w=300 h=100 duration=2\n  label "Hello there" x={-60 + 40*t} y=50 size=20`)).toEqual([]);
  });

  it("never throws, whatever the scene", () => {
    for (const spec of [`scene "Empty"`, `scene "Odd" w=0 h=-5\n  label "{nothing}" x={1/0} y=NaN`, RABBIT.replace(/\d/g, "9")]) {
      expect(() => reviewScenes(parse(spec, on))).not.toThrow();
    }
  });
});

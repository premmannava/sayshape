/**
 * The smaller scene additions: light= (S4), richer labels (S8), see-through
 * colors and gradient stops (S9), shake= (S11), and the formula operators a
 * scene can use (S15).
 */
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { sceneComponents, SCENE_FUNCTIONS } from "../src/components/scene";
import { colorOf } from "../src/components/scene/draw";
import { fadeColor, gradientStops, rgbaOf } from "../src/components/scene/fade";
import { highlightOf, lightPoint } from "../src/components/scene/light";
import { shakeOffset, shakeSeed, MAX_SHAKE } from "../src/components/scene/shake";
import { rotate, translate, IDENTITY } from "../src/components/scene/interact";
import { evaluate } from "../src/expr";
import { lightTheme, darkTheme } from "../src/theme";
import { render } from "../src/testing";

const ON = [...coreComponents, ...sceneComponents];
const reg = new Registry(ON);
const errors = (spec: string) => parse(spec, reg).diagnostics;

describe("light= (S4)", () => {
  const ball = { x: 90, y: 90, w: 20, h: 20 };
  const sun: [number, number] = [300, 170];

  it("reads x,y and nothing else", () => {
    expect(lightPoint("300,170")).toEqual([300, 170]);
    expect(lightPoint(" 300 170 ")).toEqual([300, 170]);
    expect(lightPoint("300")).toBeNull();
    expect(lightPoint("a,b")).toBeNull();
    expect(lightPoint(undefined)).toBeNull();
  });

  it("keeps the upper-left highlight without a light", () => {
    expect(highlightOf(ball, IDENTITY, undefined)).toEqual([90 + 20 * 0.34, 90 + 20 * 0.3]);
  });

  it("puts the highlight on the side facing the light, in every quadrant", () => {
    for (const [px, py] of [[100, 100], [500, 100], [100, 300], [500, 300], [300, 40], [300, 300], [40, 170], [560, 170]] as const) {
      const b = { x: px - 10, y: py - 10, w: 20, h: 20 };
      const [hx, hy] = highlightOf(b, IDENTITY, sun);
      const toSun = [sun[0] - px, sun[1] - py], toLight = [hx - px, hy - py];
      // Same direction: the highlight points at the sun.
      const cos = (toSun[0]! * toLight[0]! + toSun[1]! * toLight[1]!) / (Math.hypot(toSun[0]!, toSun[1]!) * Math.hypot(toLight[0]!, toLight[1]!));
      expect(cos).toBeGreaterThan(0.999);
      // As far from the middle as the classic highlight.
      expect(Math.hypot(toLight[0]!, toLight[1]!)).toBeCloseTo(20 * 0.26, 5);
    }
  });

  it("follows groups that move and turn the shape", () => {
    // A ball drawn at 0,0 inside a group moved to 100,170 and turned 90°: the sun is to its right on screen,
    // which in the group's own turned coordinates is "up" (negative y).
    const m = rotate(translate(IDENTITY, 100, 170), Math.PI / 2);
    const [hx, hy] = highlightOf({ x: -10, y: -10, w: 20, h: 20 }, m, sun);
    expect(hx).toBeCloseTo(0, 5);
    expect(hy).toBeLessThan(0);
  });

  it("parses on the scene and draws one light per shine, as before", () => {
    const spec = `scene "Planets" w=600 h=340 light=300,170\n  circle x=300 y=170 r=30 fill=warn glow=true\n  circle x=100 y=100 r=12 fill=accent shine=true\n  circle x=500 y=300 r=12 fill=good shine=true\n`;
    expect(errors(spec)).toEqual([]);
    const lit = render(spec, { components: ON }).drawOps.filter((o) => o.op === "fill" && o.gradientStops);
    expect(lit).toHaveLength(2);
  });
});

describe("labels: weight, style, gradient fill and outline (S8)", () => {
  const GOAL = `scene "Goal" w=600 h=300
  gradient id=gold from="#FFE08A" to="#E0A100" angle=90
  label "GOAL!" x=300 y=150 size=96 weight=heavy style=italic align=center fill="url(gold)" stroke="#1B262A" width=10`;

  it("parses light, regular, bold, heavy and italic", () => {
    expect(errors(GOAL)).toEqual([]);
    for (const w of ["light", "regular", "bold", "heavy"]) expect(errors(`scene "S" w=100 h=100\n  label "A" x=1 y=1 weight=${w}\n`)).toEqual([]);
    expect(errors(`scene "S" w=100 h=100\n  label "A" x=1 y=1 style=oblique\n`)).toHaveLength(1);
  });

  it("draws an italic heavy GOAL! with the outline under a gold gradient fill", () => {
    const ops = render(GOAL, { components: ON }).drawOps.filter((o) => o.args[0] === "GOAL!");
    expect(ops.map((o) => o.op)).toEqual(["strokeText", "fillText"]);
    expect(ops[1]!.font).toMatch(/^italic 900 96px/);
    expect(ops[1]!.gradientStops?.map((s) => s.color)).toEqual(["#FFE08A", "#E0A100"]);
  });

  it("keeps regular at weight 500 and bold at 800, with no outline unless asked", () => {
    const ops = render(`scene "S" w=200 h=100\n  label "A" x=10 y=10\n  label "B" x=10 y=40 weight=bold\n  label "C" x=10 y=70 weight=light\n`, { components: ON }).drawOps;
    const font = (t: string) => ops.find((o) => o.op === "fillText" && o.args[0] === t)!.font;
    expect(font("A")).toMatch(/^500 /);
    expect(font("B")).toMatch(/^800 /);
    expect(font("C")).toMatch(/^300 /);
    expect(ops.some((o) => o.op === "strokeText")).toBe(false);
  });
});

describe("see-through colors and gradient stops (S9)", () => {
  const f = { colors: lightTheme.colors };

  it("fades theme names, hex, rgb and hsl by a percentage", () => {
    expect(colorOf("accent 30%", f)).toBe("rgba(23, 111, 105, 0.3)");
    expect(colorOf("#E0807A 30%", f)).toBe("rgba(224, 128, 122, 0.3)");
    expect(colorOf("#FFF3B0 0%", f)).toBe("rgba(255, 243, 176, 0)");
    expect(colorOf("rgb(10, 20, 30) 50%", f)).toBe("rgba(10, 20, 30, 0.5)");
    expect(colorOf("rgba(10, 20, 30, 0.5) 50%", f)).toBe("rgba(10, 20, 30, 0.25)");
    expect(colorOf("hsl(0, 100%, 50%) 50%", f)).toBe("rgba(255, 0, 0, 0.5)");
    expect(colorOf("#abc 100%", f)).toBe("rgba(170, 187, 204, 1)");
    // Unchanged: plain colors pass as they are, and nonsense stays out.
    expect(colorOf("#E0807A", f)).toBe("#E0807A");
    expect(colorOf("javascript:alert(1) 50%", f)).toBeNull();
    expect(colorOf("tomato 50%", f)).toBeNull();
  });

  it("reads colors as numbers", () => {
    expect(rgbaOf("#ff000080")).toEqual([255, 0, 0, 128 / 255]);
    expect(rgbaOf("rgba(1 2 3 / 50%)")).toEqual([1, 2, 3, 0.5]);
    expect(rgbaOf("red")).toBeNull();
    expect(fadeColor("#000", 2)).toBe("rgba(0, 0, 0, 1)");
  });

  it("fades a stop to nothing in the other stop's own color, so there's no dark fringe", () => {
    expect(gradientStops("#FFF3B0", "transparent")).toEqual(["#FFF3B0", "rgba(255, 243, 176, 0)"]);
    expect(gradientStops("rgba(0, 0, 0, 0)", "#E0807A")).toEqual(["rgba(224, 128, 122, 0)", "#E0807A"]);
    expect(gradientStops("#FFF3B0", "rgba(255, 243, 176, 0)")).toEqual(["#FFF3B0", "rgba(255, 243, 176, 0)"]);
    expect(gradientStops("#111111", "#EEEEEE")).toEqual(["#111111", "#EEEEEE"]);
  });

  it("draws horizon haze, moon glow and firelight fading to nothing, light and dark", () => {
    const spec = `scene "Night" w=600 h=340 bg="#0B1D3A"
  gradient id=haze from="#E0807A 0%" to="#E0807A 60%" angle=90
  gradient id=moon kind=radial from="#FFF3B0" to="#FFF3B0 0%"
  gradient id=fire kind=radial from="warn 90%" to=transparent
  rect x=0 y=200 w=600 h=140 fill="url(haze)"
  circle x=480 y=70 r=60 fill="url(moon)"
  circle x=150 y=290 r=80 fill="url(fire)"`;
    expect(errors(spec)).toEqual([]);
    for (const theme of [lightTheme, darkTheme]) {
      const stops = render(spec, { components: ON, theme }).drawOps.filter((o) => o.gradientStops).map((o) => o.gradientStops!.map((s) => s.color));
      expect(stops).toHaveLength(3);
      for (const pair of stops) {
        const [a, b] = pair.map((c) => rgbaOf(c)!);
        // Wherever a stop is see-through, it carries its partner's color: no grey on the way.
        if (a![3] === 0) expect(a!.slice(0, 3)).toEqual(b!.slice(0, 3));
        if (b![3] === 0) expect(b!.slice(0, 3)).toEqual(a!.slice(0, 3));
      }
    }
  });
});

describe("shake= (S11)", () => {
  it("is repeatable for the same seed and time, and stays within its amount", () => {
    const seed = shakeSeed("3:group");
    for (const t of [0, 0.013, 0.5, 1.21, 7]) {
      expect(shakeOffset(14, seed, t)).toEqual(shakeOffset(14, seed, t));
      const [dx, dy] = shakeOffset(14, seed, t);
      expect(Math.abs(dx)).toBeLessThanOrEqual(14);
      expect(Math.abs(dy)).toBeLessThanOrEqual(14);
    }
    expect(shakeOffset(14, seed, 0.5)).not.toEqual(shakeOffset(14, shakeSeed("4:group"), 0.5));
    expect(shakeOffset(0, seed, 0.5)).toEqual([0, 0]);
    expect(shakeOffset(-3, seed, 0.5)).toEqual([0, 0]);
    expect(Math.abs(shakeOffset(1e9, seed, 0.31)[0])).toBeLessThanOrEqual(MAX_SHAKE);
  });

  it("moves smoothly between jolts (no jumps from one frame to the next)", () => {
    const seed = shakeSeed("1:scene");
    let last = shakeOffset(10, seed, 0);
    for (let t = 1 / 60; t < 2; t += 1 / 60) {
      const now = shakeOffset(10, seed, t);
      // A jolt is quick, but each frame moves at most part of the way across the whole range (2 × 10 each way).
      expect(Math.hypot(now[0] - last[0], now[1] - last[1])).toBeLessThan(18);
      last = now;
    }
  });

  const IMPACT = `scene "Goal impact" w=600 h=300 duration=3 loop=false shake={14*(1 - ease(t, 1.2, 1.6))}
  rect x=0 y=0 w=600 h=300 fill=surface
  group x=300 y=150 shake={6*(1 - ease(t, 0, 0.5))}
    circle x=0 y=0 r=30 fill=accent
  label "GOAL!" x=300 y=60 size=48 weight=heavy align=center fill=ink`;

  it("parses with t and ease on the scene line", () => {
    expect(errors(IMPACT)).toEqual([]);
  });

  it("shakes while it plays, settles by the end, and draws the same at the same moment", () => {
    const at = (ms: number) => {
      const ui = render(IMPACT, { components: ON, animate: true, clock: true });
      if (ms) ui.clock.advance(ms);
      const ops = ui.drawOps;
      ui.destroy();
      return ops.find((o) => o.op === "fillText" && o.args[0] === "GOAL!")!.args;
    };
    const still = render(IMPACT, { components: ON }).drawOps.find((o) => o.op === "fillText" && o.args[0] === "GOAL!")!.args;
    expect(at(500)).toEqual(at(500));
    // The recording canvas keeps the label's own x,y; what shakes is the transform. Moving on to the end settles it.
    expect(at(3000)).toEqual(still);
  });

  it("doesn't shake with reduced motion: the still frame is the resting one", () => {
    const a = render(IMPACT, { components: ON, reducedMotion: true, animate: true, clock: true });
    const b = render(IMPACT, { components: ON });
    expect(a.drawOps.map((o) => [o.op, o.args])).toEqual(b.drawOps.map((o) => [o.op, o.args]));
  });

  it("moves pressable shapes' hit regions with the jolt", () => {
    const spec = `state n=0\nscene "S" w=400 h=200 duration=10 shake=40\n  circle x=200 y=100 r=30 fill=accent on=inc:n`;
    const ui = render(spec, { components: ON, animate: true, clock: true });
    const centre = () => { const h = ui.hits.find((x) => x.box.node.type === "scene")!.box; return [h.x + h.w / 2, h.y + h.h / 2]; };
    const a = centre();
    ui.clock.advance(330);
    const b = centre();
    expect(a).not.toEqual(b);
    ui.destroy();
  });
});

describe("formula operators in scenes (S15)", () => {
  const ev = (src: string, t = 2.5) => {
    const r = evaluate(src, (n) => (n === "t" ? t : undefined), SCENE_FUNCTIONS);
    return r.ok ? r.value : r;
  };

  it("has %, floor, ternary and the everyday math", () => {
    expect(ev("(t*100) % 60")).toBe(10);
    expect(ev("-7 % 3")).toBe(-1);
    expect(ev("floor(t)")).toBe(2);
    expect(ev("floor(-t)")).toBe(-3);
    expect(ev("t > 2 ? 'late' : 'early'")).toBe("late");
    expect(ev("round(t)")).toBe(3);
    expect(ev("ceil(t)")).toBe(3);
    expect(ev("abs(-t)")).toBe(2.5);
    expect(ev("min(t, 1) + max(t, 4)")).toBe(5);
    expect(ev("pow(2, 3)")).toBe(8);
  });

  it("parses them inside a scene with no warnings, and the guide lists them", () => {
    expect(errors(`scene "S" w=600 h=100 duration=4\n  rect x={(t*100) % 560} y={floor(t) * 10} w=40 h={t > 2 ? 30 : 10} fill=accent\n`)).toEqual([]);
    const example = sceneComponents.find((c) => c.type === "scene")!.example!;
    for (const name of ["floor", "%", "a ? b : c"]) expect(example).toContain(name);
  });
});

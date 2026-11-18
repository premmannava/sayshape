/**
 * Scene line style (src/components/scene/line-style.ts): cap= and join= on
 * line, path and polygon, and round= corners on path and polygon.
 */
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { sceneComponents, reviewScenes } from "../src/components/scene";
import { paintScene, type Frame } from "../src/components/scene/draw";
import { flattenPath } from "../src/components/scene/interact";
import { capOf, cornerCut, joinOf, roundPolyline, roundingSink, type PathCommand } from "../src/components/scene/line-style";
import { tracePath, type PathSink } from "../src/components/scene/path";
import { lightTheme } from "../src/theme";
import { render, type Rendered } from "../src/testing";
import type { Box } from "../src/types";

const ON = [...coreComponents, ...sceneComponents];
const reg = new Registry(ON);

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Commands as compact path text: M0,0 L78,0 Q100,0,100,22. */
function text(cmds: readonly PathCommand[]): string {
  return cmds.map((c) => (c.op === "Z" ? "Z" : c.op === "Q" ? `Q${r2(c.cx)},${r2(c.cy)},${r2(c.x)},${r2(c.y)}` : `${c.op}${r2(c.x)},${r2(c.y)}`)).join(" ");
}

/** A sink that writes what it's told as path text. */
function recorder(): PathSink & { out: string[] } {
  const out: string[] = [];
  return {
    out,
    moveTo: (x, y) => out.push(`M${r2(x)},${r2(y)}`),
    lineTo: (x, y) => out.push(`L${r2(x)},${r2(y)}`),
    quadraticCurveTo: (a, b, x, y) => out.push(`Q${r2(a)},${r2(b)},${r2(x)},${r2(y)}`),
    bezierCurveTo: (a, b, c, d, x, y) => out.push(`C${r2(a)},${r2(b)},${r2(c)},${r2(d)},${r2(x)},${r2(y)}`),
    ellipse: (cx, cy) => out.push(`E${r2(cx)},${r2(cy)}`),
    closePath: () => out.push("Z"),
  };
}
const rounded = (d: string, r: number) => {
  const rec = recorder();
  const s = roundingSink(rec, r);
  tracePath(d, s);
  s.end();
  return rec.out.join(" ");
};

describe("cornerCut", () => {
  it("is the radius, clamped to half of either leg", () => {
    expect(cornerCut(22, 100, 100)).toBe(22);
    expect(cornerCut(22, 30, 100)).toBe(15);
    expect(cornerCut(22, 100, 10)).toBe(5);
    expect(cornerCut(50, 40, 60)).toBe(20);
  });
  it("is 0 for no radius, a bad one, or a leg of no length", () => {
    expect(cornerCut(0, 100, 100)).toBe(0);
    expect(cornerCut(-5, 100, 100)).toBe(0);
    expect(cornerCut(NaN, 100, 100)).toBe(0);
    expect(cornerCut(10, 0, 100)).toBe(0);
  });
});

describe("roundPolyline", () => {
  it("rounds an L with a curve whose control point is the corner", () => {
    expect(text(roundPolyline([[0, 0], [100, 0], [100, 100]], false, 22))).toBe("M0,0 L78,0 Q100,0,100,22 L100,100");
  });
  it("clamps to half the shorter leg", () => {
    expect(text(roundPolyline([[0, 0], [100, 0], [100, 10]], false, 22))).toBe("M0,0 L95,0 Q100,0,100,5 L100,10");
    // Two corners on one short leg meet in its middle and never overlap.
    expect(text(roundPolyline([[0, 0], [100, 0], [100, 20], [200, 20]], false, 50))).toBe("M0,0 L90,0 Q100,0,100,10 L100,10 Q100,20,110,20 L200,20");
  });
  it("rounds every corner of a closed shape, where it closes too", () => {
    const d = text(roundPolyline([[0, 0], [100, 0], [100, 100], [0, 100]], true, 10));
    expect(d).toBe("M10,0 L90,0 Q100,0,100,10 L100,90 Q100,100,90,100 L10,100 Q0,100,0,90 L0,10 Q0,0,10,0 Z");
    expect(d.match(/Q/g)).toHaveLength(4);
  });
  it("drops repeated points, and leaves two points or no radius straight", () => {
    expect(text(roundPolyline([[0, 0], [0, 0], [100, 0], [100, 0], [100, 100]], false, 22))).toBe("M0,0 L78,0 Q100,0,100,22 L100,100");
    expect(text(roundPolyline([[0, 0], [100, 0], [100, 100], [0, 0]], true, 10)).match(/Q/g)).toHaveLength(3);
    expect(text(roundPolyline([[0, 0], [100, 0]], false, 22))).toBe("M0,0 L100,0");
    expect(text(roundPolyline([[0, 0], [100, 0]], true, 22))).toBe("M0,0 L100,0 Z");
    expect(text(roundPolyline([[0, 0], [100, 0], [100, 100]], false, 0))).toBe("M0,0 L100,0 L100,100");
    expect(roundPolyline([], false, 10)).toEqual([]);
  });
});

describe("roundingSink", () => {
  it("rounds relative, H and V lines the same as absolute ones", () => {
    const want = rounded("M0 0 L100 0 L100 100", 22);
    expect(want).toBe("M0,0 L78,0 Q100,0,100,22 L100,100");
    expect(rounded("M0 0 l100 0 l0 100", 22)).toBe(want);
    expect(rounded("M0 0 H100 V100", 22)).toBe(want);
    expect(rounded("m0 0 h100 v100", 22)).toBe(want);
  });
  it("rounds a closed run all round", () => {
    expect(rounded("M0 0 H100 V100 H0 Z", 10)).toBe("M10,0 L90,0 Q100,0,100,10 L100,90 Q100,100,90,100 L10,100 Q0,100,0,90 L0,10 Q0,0,10,0 Z");
  });
  it("leaves curves as written and the corners next to them sharp", () => {
    // A corner between two lines is rounded; where a line meets the curve, it isn't.
    expect(rounded("M0 0 L100 0 L100 100 Q150 150 200 100 L200 0 L300 0", 10))
      .toBe("M0,0 L90,0 Q100,0,100,10 L100,100 Q150,150,200,100 L200,10 Q200,0,210,0 L300,0");
    // The closing line is straight: its corner with the run before it rounds, the one at the curve doesn't.
    expect(rounded("M0 0 Q50 -50 100 0 L100 100 L0 100 Z", 10))
      .toBe("M0,0 Q50,-50,100,0 L100,90 Q100,100,90,100 L10,100 Q0,100,0,90 L0,0 Z");
  });
  it("keeps separate subpaths separate", () => {
    expect(rounded("M0 0 H50 V50 M100 0 H150 V50", 10)).toBe("M0,0 L40,0 Q50,0,50,10 L50,50 M100,0 L140,0 Q150,0,150,10 L150,50");
  });
});

describe("cap and join", () => {
  it("read a valid value, else round", () => {
    expect(capOf("butt")).toBe("butt");
    expect(capOf("square")).toBe("square");
    expect(capOf("flat")).toBe("round");
    expect(capOf(undefined)).toBe("round");
    expect(joinOf("miter")).toBe("miter");
    expect(joinOf("bevel")).toBe("bevel");
    expect(joinOf("sharp")).toBe("round");
  });

  it("parse on line, path and polygon, warn for a bad value, and are unknown elsewhere", () => {
    const ok = `scene "S" w=100 h=100
  line x1=0 y1=0 x2=10 y2=10 stroke=ink cap=butt join=bevel
  path d="M0 0 L50 0 L50 50" stroke=ink cap=square join=miter round=8
  polygon points="0,0 50,0 50,50" fill=accent round=6 cap=butt join=round
`;
    expect(parse(ok, reg).diagnostics).toEqual([]);
    const bad = parse(`scene "S" w=100 h=100\n  path d="M0 0 L50 0" stroke=ink cap=flat\n`, reg).diagnostics;
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("warning");
    expect(bad[0]!.message).toContain("butt");
    const rect = parse(`scene "S" w=100 h=100\n  rect x=0 y=0 w=10 h=10 cap=butt\n`, reg).diagnostics;
    expect(rect).toHaveLength(1);
    expect(rect[0]!.message).toContain('"rect" has no prop "cap"');
    expect(parse(`scene "S" w=100 h=100\n  line x1=0 y1=0 x2=10 y2=10 round=4\n`, reg).diagnostics).toHaveLength(1);
  });

  /** Paint a scene's lines on a context that records the cap and join of each stroke. */
  function strokesOf(spec: string): Array<{ cap: unknown; join: unknown }> {
    const scene = parse(spec, reg).root.children[0]!;
    const seen: Array<{ cap: unknown; join: unknown }> = [];
    const state: Record<string | symbol, unknown> = { globalAlpha: 1, lineCap: "butt", lineJoin: "miter" };
    const g = new Proxy(state, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "stroke") return () => seen.push({ cap: t.lineCap, join: t.lineJoin });
        if (k === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        if (k === "measureText") return () => ({ width: 10 });
        if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop() {} });
        return () => undefined;
      },
      set(t, k, v) { t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const f: Frame = {
      g, font: () => "16px sans-serif", colors: lightTheme.colors, defs: new Map(), gradients: new Map(),
      shapes: 0, steps: 0, useDepth: 0, ends: new Map(), time: 0, m: [1, 0, 0, 1, 0, 0],
    };
    paintScene(f, scene.children, () => undefined, 100, 100, undefined);
    return seen;
  }

  it("set the stroke's ends and corners, round by default as before", () => {
    const s = strokesOf(`scene "S" w=100 h=100
  line x1=0 y1=0 x2=10 y2=10 stroke=ink
  line x1=0 y1=0 x2=10 y2=10 stroke=ink cap=butt join=bevel
  path d="M0 0 L50 0 L50 50" stroke=ink cap=square join=miter
  polygon points="0,0 50,0 50,50" stroke=ink join=bevel
  rect x=0 y=0 w=10 h=10 stroke=ink
  path d="M0 0 L50 0" stroke=ink cap=nonsense
`);
    expect(s).toEqual([
      { cap: "round", join: "round" },
      { cap: "butt", join: "bevel" },
      { cap: "square", join: "miter" },
      { cap: "round", join: "bevel" },
      { cap: "round", join: "round" },
      { cap: "round", join: "round" },
    ]);
  });
});

function sceneAt(ui: Rendered, w: number, h: number) {
  const box = ui.find({ type: "scene" }).box as Box;
  return (x: number, y: number): [number, number] => [box.x + (x * box.w) / w, box.y + (y * box.h) / h];
}

describe("round= when pressed", () => {
  it("a path is pressed where its rounded corner is drawn; a polygon keeps its sharp outline", () => {
    const spec = (shape: string) => `state n=0
scene "A tile" w=200 h=200
  ${shape} fill=accent on=inc:n`;
    // Just inside the sharp corner, outside a corner rounded by 60.
    for (const [shape, hits] of [
      [`path d="M20 20 H180 V180 H20 Z"`, 1],
      [`path d="M20 20 H180 V180 H20 Z" round=60`, 0],
      [`polygon points="20,20 180,20 180,180 20,180" round=60`, 1],
    ] as const) {
      const ui = render(spec(shape), { components: ON, width: 400 });
      ui.click(...sceneAt(ui, 200, 200)(24, 24));
      expect(ui.state.n, shape).toBe(hits);
      // The middle is pressable either way.
      ui.click(...sceneAt(ui, 200, 200)(100, 100));
      expect(ui.state.n, shape).toBe(hits + 1);
      ui.destroy();
    }
  });

  it("a stroked metro line follows the rounded corner", () => {
    const rings = flattenPath("M40 200 L200 200 L260 140 L420 140 L420 60", 22);
    // The sharp corner at 420,140 is cut off: the outline passes ~7.8 px inside it.
    const near = Math.min(...rings.flat().map(([x, y]) => Math.hypot(x - 420, y - 140)));
    expect(near).toBeGreaterThan(7);
    expect(flattenPath("M40 200 L200 200 L260 140 L420 140 L420 60").flat()).toContainEqual([420, 140]);
  });
});

describe("acceptance: a metro line from plain L segments", () => {
  const PLAIN = "M40 200 L200 200 L260 140 L420 140 L420 60";
  // Written by hand: 22 px cut back along each leg, a curve through each corner.
  const k = 22 / Math.SQRT2;
  const HAND = `M40 200 L178 200 Q200 200 ${200 + k} ${200 - k} L${260 - k} ${140 + k} Q260 140 282 140 L398 140 Q420 140 420 118 L420 60`;

  /** The farthest any point of a is from the outline of b. */
  function directed(a: Array<[number, number]>, b: Array<[number, number]>): number {
    let worst = 0;
    for (const [px, py] of a) {
      let best = Infinity;
      for (let i = 1; i < b.length; i++) {
        const [x1, y1] = b[i - 1]!, [x2, y2] = b[i]!;
        const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy;
        const u = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
        best = Math.min(best, Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy)));
      }
      worst = Math.max(worst, best);
    }
    return worst;
  }

  it("matches the hand-written curves to within half a pixel", () => {
    const ours = flattenPath(PLAIN, 22).flat(), hand = flattenPath(HAND).flat();
    expect(Math.max(directed(ours, hand), directed(hand, ours))).toBeLessThan(0.5);
    // And the measure tells them apart from the sharp line.
    expect(directed(flattenPath(PLAIN).flat(), hand)).toBeGreaterThan(5);
  });

  it("draws cleanly with nothing for the drawing check to report", () => {
    for (const d of [`d="${PLAIN}" round=22 cap=round join=round`, `d="${HAND}" cap=round join=round`]) {
      const spec = `scene "A metro line" w=460 h=240 bg="#FFFFFF"
  path ${d} stroke=accent width=8 fill=none`;
      const p = parse(spec, reg);
      expect(p.diagnostics).toEqual([]);
      expect(reviewScenes(p)).toEqual([]);
    }
  });
});

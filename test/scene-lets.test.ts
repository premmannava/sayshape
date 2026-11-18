/**
 * let a={…} in scenes (S1): parsing and its messages, which lines see a let,
 * loops between lets, working them out once per moment, and the two
 * acceptance pictures drawn the same as with the formulas written out.
 */
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { reviewScenes, sceneComponents } from "../src/components/scene";
import { letScope } from "../src/components/scene/lets";
import { paintScene, type Frame } from "../src/components/scene/draw";
import { lightTheme } from "../src/theme";
import type { Scope } from "../src/expr";
import { render, type Rendered } from "../src/testing";
import type { SayShapeNode, Value } from "../src/types";
import type { Box } from "../src/types";

const ON = [...coreComponents, ...sceneComponents];
const reg = new Registry(ON);
const core = new Registry(coreComponents);
const diags = (spec: string, opts: { behavior?: boolean } = {}) => parse(spec, reg, opts).diagnostics;
const messages = (spec: string) => diags(spec).map((d) => `${d.line} ${d.severity}: ${d.message}`);

/** The words labels drew, in order. */
const words = (ui: Rendered) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));
const drawn = (spec: string) => {
  const ui = render(spec, { components: ON });
  const out = words(ui);
  ui.destroy();
  return out;
};

const SOLAR_PLANETS = `state planets=[{name: "Mercury", r: 70, per: 2, a0: 0, size: 6, c: "#B5B5B5"}, {name: "Venus", r: 110, per: 3.5, a0: 1.6, size: 9, c: "#E9C46A"}, {name: "Earth", r: 160, per: 5, a0: 3.2, size: 10, c: "#2A9D8F"}, {name: "Mars", r: 220, per: 8, a0: 4.8, size: 8, c: "#E76F51"}]`;

const SOLAR = `${SOLAR_PLANETS}
scene "Four planets circling the Sun" w=600 h=400 duration=40 bg="#0B1D3A"
  circle x=300 y=200 r=30 fill="#FFD166" glow=true
  each items={planets} as=p
    let a={p.a0 + t*6.2832/p.per}
    ellipse x=300 y=200 rx={p.r} ry={p.r*0.45} fill=none stroke=line
    circle x={300 + p.r*cos(a)} y={200 + p.r*0.45*sin(a)} r={p.size} fill={p.c} shine=true
    label "{p.name}" x={300 + p.r*cos(a)} y={200 + p.r*0.45*sin(a) - p.size - 14} size=15 fill="#FFFFFF" align=center
`;

const SOLAR_INLINE = `${SOLAR_PLANETS}
scene "Four planets circling the Sun" w=600 h=400 duration=40 bg="#0B1D3A"
  circle x=300 y=200 r=30 fill="#FFD166" glow=true
  each items={planets} as=p
    ellipse x=300 y=200 rx={p.r} ry={p.r*0.45} fill=none stroke=line
    circle x={300 + p.r*cos(p.a0 + t*6.2832/p.per)} y={200 + p.r*0.45*sin(p.a0 + t*6.2832/p.per)} r={p.size} fill={p.c} shine=true
    label "{p.name}" x={300 + p.r*cos(p.a0 + t*6.2832/p.per)} y={200 + p.r*0.45*sin(p.a0 + t*6.2832/p.per) - p.size - 14} size=15 fill="#FFFFFF" align=center
`;

const WIND = `scene "Snow, smoke and fog in a gusting wind" w=600 h=340 duration=20 bg="#1D3557"
  let wind={8*sin(t*0.7) + 4*sin(t*1.9)}
  each items={range(60)} as=i
    circle x={(random(i)*600 + t*wind*3 + 6000) % 600} y={(random(i + 100)*340 + t*30) % 340} r={1 + 2*random(i + 200)} fill="#FFFFFF"
  group x={wind*4} y=0
    each items={range(5)} as=k
      circle x={420 + 6*k} y={200 - 22*k} r={10 + 4*k} fill="#AAAAAA" opacity={0.6 - 0.1*k}
  ellipse x={300 + wind*6} y=300 rx=260 ry=30 fill="#FFFFFF" opacity=0.25
`;

const W = "(8*sin(t*0.7) + 4*sin(t*1.9))";
const WIND_INLINE = `scene "Snow, smoke and fog in a gusting wind" w=600 h=340 duration=20 bg="#1D3557"
  each items={range(60)} as=i
    circle x={(random(i)*600 + t*${W}*3 + 6000) % 600} y={(random(i + 100)*340 + t*30) % 340} r={1 + 2*random(i + 200)} fill="#FFFFFF"
  group x={${W}*4} y=0
    each items={range(5)} as=k
      circle x={420 + 6*k} y={200 - 22*k} r={10 + 4*k} fill="#AAAAAA" opacity={0.6 - 0.1*k}
  ellipse x={300 + ${W}*6} y=300 rx=260 ry=30 fill="#FFFFFF" opacity=0.25
`;

/** The draw calls at a few moments of the scene's clock. */
function framesOf(spec: string, at: readonly number[]): unknown[] {
  const ui = render(spec, { components: ON, animate: true, clock: true });
  const out: unknown[] = [];
  let now = 0;
  for (const ms of at) {
    ui.clock.advance(ms - now);
    now = ms;
    out.push(JSON.parse(JSON.stringify(ui.drawOps)));
  }
  ui.destroy();
  return out;
}

/**
 * Every call a scene makes on its context, with its arguments (where shapes
 * are, not only their colors), drawn at these scene times.
 */
function callsOf(spec: string, times: readonly number[]): unknown[][] {
  const r = parse(spec, reg);
  const scene = r.root.children.find((n) => n.type === "scene")!;
  const values = new Map<string, Value>(r.state.map((s) => [s.key, s.value as Value]));
  return times.map((time) => {
    const log: unknown[] = [];
    const props: Record<string, unknown> = { globalAlpha: 1 };
    const g = new Proxy(props, {
      get(target, key: string) {
        if (key in target) return target[key];
        if (key === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        if (key === "measureText") return (text: string) => ({ width: text.length * 7 });
        if (key === "createLinearGradient" || key === "createRadialGradient") {
          return (...args: unknown[]) => { log.push([key, ...args]); return { addColorStop: (...a: unknown[]) => log.push(["stop", ...a]) }; };
        }
        return (...args: unknown[]) => { log.push([key, ...args]); };
      },
      set(target, key: string, value) { log.push(["set", key, typeof value === "object" ? "(gradient)" : value]); target[key] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const f: Frame = { g, font: (w, s) => `${w} ${s}px sans`, colors: lightTheme.colors, defs: new Map(), gradients: new Map(), shapes: 0, steps: 0, useDepth: 0, ends: new Map(), time, m: [1, 0, 0, 1, 0, 0] };
    const scope: Scope = (n) => (n === "t" ? f.time : n === "PI" ? Math.PI : values.get(n));
    paintScene(f, scene.children, scope, 600, 400, undefined);
    return log;
  });
}

describe("let lines: parsing", () => {
  it("parse cleanly where they're written well", () => {
    expect(diags(SOLAR)).toEqual([]);
    expect(diags(WIND)).toEqual([]);
    const r = parse(`scene "S"\n  let a={t*2}\n  let n=5\n  circle x={a + n} y=10 r=5\n`, reg);
    const lets = r.root.children[0]!.children.filter((n) => n.type === "let");
    expect(lets.map((n) => n.props)).toEqual([{ name: "a", value: "{t*2}" }, { name: "n", value: "5" }]);
  });

  it("outside a scene keep exactly the old message", () => {
    for (const spec of ["let a={1}\ntext \"x\"\n", "card\n  let a={1}\n", "let total = 5\n"]) {
      expect(diags(spec)).toEqual(parse(spec, core).diagnostics);
    }
    expect(messages("let a={1}\n")).toEqual([
      "1 error: SayShape has no variables. For a value worked out from state, write derive name={…} at the top level; for a value people change, write state name=value. This line and anything under it were skipped",
    ]);
    // After a scene has closed, too.
    expect(messages(`scene "S"\n  circle x=1 y=1 r=1\nlet a={1}\n`)[0]).toMatch(/^3 error: SayShape has no variables/);
  });

  it("say how to write a let that isn't one name and one formula", () => {
    const shape = "A let line names one value with a formula in braces, like let a={t*2}. This line was skipped";
    const braces = (n: string) => `let ${n} needs its formula in braces, like let ${n}={t*2}; for text or a color, quote it inside: let c={'#E63946'}. This line was skipped`;
    expect(messages(`scene "S"
  let a={1} b={2}
  let "x"
  let 3={1}
  let a="red"
  let a=b
  let t={1}
  let PI={2}
  let a={1+}
  let
`)).toEqual([
      `2 error: ${shape}`,
      `3 error: ${shape}`,
      `4 error: ${shape}`,
      `5 error: ${braces("a")}`,
      `6 error: ${braces("a")}`,
      "7 error: t is the scene's time, so a let can't take that name. This line was skipped; call it something else, like let t2={…}",
      "8 error: PI is the scene's π, so a let can't take that name. This line was skipped; call it something else, like let p2={…}",
      "9 error: let a: Expression ended early. This line was skipped",
      `10 error: ${shape}`,
    ]);
  });

  it("never throws on odd let lines, in parsing or drawing", () => {
    const odd = ["let", "let =", "let a", "let a=", "let a={", "let a={}", "let a={{}}", "let __proto__={1}", "let constructor={2}", "let a={a}", "let a=\"{t}\"",
      "let a={'#E63946'}", "let a=1e400", "let a={1/0}", "let a=-3", "let a={t} if={true}", "let a={pick([], 1)}", "let a.b={1}", "let a-b={1}", "let a={b} b={a}"];
    for (const line of odd) {
      const spec = `scene "S" w=100 h=100\n  ${line}\n  circle x={a} y=10 r=5\n  label "{a}" x=5 y=5\n`;
      expect(() => parse(spec, reg)).not.toThrow();
      expect(() => render(spec, { components: ON }).destroy()).not.toThrow();
    }
  });

  it("can't be indented under", () => {
    expect(messages(`scene "S"\n  let a={1}\n    circle x=1 y=1 r=1\n`)[0]).toMatch(/is indented under "let"/);
  });
});

describe("let lines: which lines see them", () => {
  it("count for the lines below them in their block: scene, group, each, if, define", () => {
    expect(diags(`scene "S" w=200 h=100
  let a={2}
  label "{a}" x=10 y=10
  group x=0
    let a={a*10}
    label "{a}" x=10 y=10
  label "{a}" x=10 y=10
  each items={range(2)} as=i
    let b={a + i}
    label "{b}" x=10 y=10
  if={a > 1}
    let c={a + 100}
    label "{c}" x=10 y=10
  define "dot"
    let d={h*2}
    label "{d}" x=0 y=0
  use "dot" args={{h: 4}}
`)).toEqual([]);
    expect(drawn(`scene "S" w=200 h=100
  let a={2}
  label "{a}" x=10 y=10
  group x=0
    let a={a*10}
    label "{a}" x=10 y=10
  label "{a}" x=10 y=10
  each items={range(2)} as=i
    let b={a + i}
    label "{b}" x=10 y=10
  if={a > 1}
    let c={a + 100}
    label "{c}" x=10 y=10
  define "dot"
    let d={h*2}
    label "{d}" x=0 y=0
  use "dot" args={{h: 4}}
`)).toEqual(["2", "20", "2", "2", "3", "102", "8"]);
  });

  it("aren't seen above them or outside their block", () => {
    const reach = (line: number) => `"a" is named by the let on line ${line}, which doesn't reach this line: a let counts only for the lines below it in its own block. Move it above this line, or out into the block around both`;
    expect(messages(`scene "S"
  label "{a}" x=1 y=1
  let a={1}
`)).toEqual([`2 warning: ${reach(3)}`]);
    expect(messages(`scene "S"
  group x=0
    let a={1}
  label "{a}" x=1 y=1
  each items={range(2)} as=i
    let b={i}
  circle x={b} y=1 r=1
`)).toEqual([
      `4 warning: ${reach(3)}`,
      `7 warning: ${reach(3).replace('"a"', '"b"').replace("line 3", "line 6")}`,
    ]);
    // Out of reach, a let's name draws as an unknown name does.
    expect(drawn(`scene "S"\n  group x=0\n    let a={1}\n  label "x{a}" x=1 y=1\n`)).toEqual(["x—"]);
  });

  it("shadow names from further out: state, loop variables and earlier lets", () => {
    expect(diags(`state a=3
scene "S"
  let a={a*2}
  let a={a + 1}
  each items={range(2)} as=i
    let i={i*10}
    label "{a}:{i}" x=1 y=1
`)).toEqual([]);
    expect(drawn(`state a=3
scene "S"
  let a={a*2}
  let a={a + 1}
  each items={range(2)} as=i
    let i={i*10}
    label "{a}:{i}" x=1 y=1
`)).toEqual(["7:0", "7:10"]);
  });
});

describe("let lines: loops", () => {
  const loop = (chain: string, many: boolean) =>
    `let ${chain[0]} depends on itself (${chain.split("").join(" → ")}), so ${many ? "none of these are worked out and their lines were skipped" : "it isn't worked out and the line was skipped"}. A let sees only the lets above it: work one of them out from t, the item or state`;

  it("are reported once and the lets in them skipped", () => {
    expect(messages(`scene "S"\n  let a={a + 1}\n  circle x={a} y=1 r=1\n`)).toEqual([`2 error: ${loop("aa", false)}`]);
    expect(messages(`scene "S"\n  let a={b}\n  let b={a}\n  circle x={a} y=1 r=1\n`)).toEqual([`2 error: ${loop("aba", true)}`]);
    expect(messages(`scene "S"\n  let a={b}\n  let b={c*2}\n  let c={a + t}\n`)).toEqual([`2 error: ${loop("abca", true)}`]);
    const r = parse(`scene "S"\n  let a={b}\n  let b={a}\n  let c={t}\n`, reg);
    expect(r.root.children[0]!.children.map((n) => n.props.name)).toEqual(["c"]);
    expect(r.nodeCount).toBe(2);
  });

  it("aren't loops when the name is state, or a let further out", () => {
    expect(diags(`state a=1\nscene "S"\n  let a={a*2}\n  circle x={a} y=1 r=1\n`)).toEqual([]);
    expect(diags(`scene "S"\n  let a={1}\n  group x=0\n    let a={a + 1}\n    circle x={a} y=1 r=1\n`)).toEqual([]);
    // Same name in two blocks next to each other: each is its own.
    expect(diags(`scene "S"\n  each items={range(2)} as=i\n    let a={i}\n  each items={range(2)} as=j\n    let a={j}\n`)).toEqual([]);
  });
});

describe("let lines: drawing", () => {
  it("are worked out once per moment, again when f.time changes", () => {
    let reads = 0;
    const outer = (n: string): Value | undefined => (n === "t" ? (reads++, f.time) : undefined);
    const f = { time: 1 };
    const node: SayShapeNode = { id: "2:let", type: "let", props: { name: "a", value: "{t*2}" }, children: [], line: 2, indent: 2 };
    const s = letScope(node, outer, f);
    expect(s("a")).toBe(2);
    expect(s("a")).toBe(2);
    expect(reads).toBe(1);
    f.time = 3;
    expect(s("a")).toBe(6);
    expect(reads).toBe(2);
    // Other names go straight through; a number needs no braces.
    expect(s("t")).toBe(3);
    expect(letScope({ ...node, props: { name: "n", value: "5" } }, outer, f)("n")).toBe(5);
  });

  it("are seen by on= actions, and can't be written to", () => {
    const SPEC = `state a=5 got=0
scene "S" w=200 h=100
  let a={1}
  rect x=0 y=0 w=100 h=100 fill=accent on=set:got:{a + 1};set:a:9`;
    const ui = render(SPEC, { components: ON });
    const box = ui.find({ type: "scene" }).box as Box;
    ui.click(box.x + box.w / 4, box.y + box.h / 2);
    expect(ui.state).toMatchObject({ got: 2, a: 5 });
    ui.destroy();
  });

  it("can't be dragged (behavior on)", () => {
    const d = diags(`state px=1\nscene "S" w=100 h=100\n  let a={px}\n  circle x={a} y=10 r=5 drag=true\n`, { behavior: true });
    expect(d.map((x) => x.message)).toContain("x= names the let a (line 3), which a drag can't move: it moves state. Drag a state value instead, like x={px} with state px=…");
    // A let read on the axis that isn't dragged is like t: it moves with the clock, not a stray state name.
    expect(diags(`state px=1\nscene "S" w=100 h=100\n  let a={10 + t}\n  circle x={px} y={a*2} r=5 drag=true\n`, { behavior: true })).toEqual([]);
  });

  it("solar system: one let per planet draws what the written-out formulas draw", () => {
    const frames = framesOf(SOLAR, [0, 1300, 7700]);
    expect(frames).toEqual(framesOf(SOLAR_INLINE, [0, 1300, 7700]));
    // The planets do move between the moments compared.
    expect(frames[1]).not.toEqual(frames[0]);
    const calls = callsOf(SOLAR, [0, 1.3, 7.7, 39.9]);
    expect(calls).toEqual(callsOf(SOLAR_INLINE, [0, 1.3, 7.7, 39.9]));
    expect(calls[1]).not.toEqual(calls[0]);
    const labels = framesOf(SOLAR, [1300])[0] as Array<{ op: string; args: unknown[] }>;
    expect(labels.filter((o) => o.op === "fillText").map((o) => o.args[0])).toEqual(["Mercury", "Venus", "Earth", "Mars"]);
  });

  it("wind: one scene-level let drives snow, smoke and fog together", () => {
    const frames = framesOf(WIND, [0, 900, 4100]);
    expect(frames).toEqual(framesOf(WIND_INLINE, [0, 900, 4100]));
    const calls = callsOf(WIND, [0, 0.9, 4.1, 19.9]);
    expect(calls).toEqual(callsOf(WIND_INLINE, [0, 0.9, 4.1, 19.9]));
    expect(calls[2]).not.toEqual(calls[1]);
  });

  it("add nothing to the drawing check", () => {
    for (const [spec, inline] of [[SOLAR, SOLAR_INLINE], [WIND, WIND_INLINE]] as const) {
      const strip = (s: string) => reviewScenes(parse(s, reg)).map((d) => d.message);
      expect(strip(spec)).toEqual(strip(inline));
    }
  });

  it("stream: every line prefix of the solar system parses with no problems", () => {
    const lines = SOLAR.split("\n");
    for (let k = 0; k <= lines.length; k++) {
      const prefix = lines.slice(0, k).join("\n") + (k ? "\n" : "");
      expect(parse(prefix, reg).diagnostics, `first ${k} lines`).toEqual([]);
      expect(parse(SOLAR.slice(0, SOLAR.split("\n").slice(0, k).join("\n").length + 3), reg, { partial: true }).diagnostics).toEqual([]);
    }
  });
});

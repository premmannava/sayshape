/**
 * Pressable scene shapes: on=, selected=, tip= and name= on shapes, groups and
 * uses (src/components/scene/interact.ts), and the drawing check's phone,
 * contrast and pressable-shape warnings (review.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { sceneComponents, reviewScenes } from "../src/components/scene";
import { geomHit, invert, mul, rotate, scale, translate, IDENTITY, type Matrix } from "../src/components/scene/interact";
import { contrast, parseColor } from "../src/components/scene/review";
import { SayShape } from "../src/engine";
import { darkTheme, lightTheme } from "../src/theme";
import { FakeCanvas, render, type Rendered } from "../src/testing";
import type { Box } from "../src/types";
import { FACTORY_MONITOR } from "../playground/scene-samples";

const ON = [...coreComponents, ...sceneComponents];
const on = new Registry(ON);

/** The first scene's box, and a function from scene coordinates to canvas pixels. */
function sceneAt(ui: Rendered, w: number, h: number) {
  const box = ui.find({ type: "scene" }).box as Box;
  return { box, at: (x: number, y: number): [number, number] => [box.x + (x * box.w) / w, box.y + (y * box.h) / h] };
}
const hover = (ui: Rendered, [x, y]: [number, number]) => {
  ui.canvas.dispatch("pointermove", { clientX: x, clientY: y, pointerId: 1 });
  ui.sayshape.renderNow();
};
const sceneHits = (ui: Rendered) => ui.hits.filter((h) => h.box.node.type === "scene");

describe("transforms", () => {
  it("inverts what it applies", () => {
    const m: Matrix = scale(rotate(translate(IDENTITY, 30, -12), 0.7), 2, 0.5);
    const inv = invert(m)!;
    const back = mul(inv, m);
    [1, 0, 0, 1, 0, 0].forEach((v, i) => expect(back[i]).toBeCloseTo(v));
    expect(invert([0, 0, 0, 0, 5, 5])).toBeNull();
  });

  it("tests rectangles, ovals, polygons and lines exactly", () => {
    const turned = rotate(translate(IDENTITY, 100, 100), Math.PI / 4);
    // A 40×40 square turned 45° around 100,100: its corner direction reaches ~28 px, its side direction 20.
    const sq = { kind: "rect" as const, m: turned, x: -20, y: -20, w: 40, h: 40 };
    expect(geomHit(sq, 100, 126)).toBe(true);
    expect(geomHit(sq, 118, 118)).toBe(false);
    const oval = { kind: "ellipse" as const, m: IDENTITY, x: 50, y: 50, rx: 40, ry: 10 };
    expect(geomHit(oval, 85, 50)).toBe(true);
    expect(geomHit(oval, 85, 58)).toBe(false);
    const tri = { kind: "poly" as const, m: IDENTITY, rings: [[[0, 0], [100, 0], [0, 100]]] as Array<Array<[number, number]>> };
    expect(geomHit(tri, 20, 20)).toBe(true);
    expect(geomHit(tri, 80, 80)).toBe(false);
    const line = { kind: "line" as const, m: scale(IDENTITY, 2, 2), x1: 0, y1: 10, x2: 100, y2: 10, width: 2 };
    expect(geomHit(line, 100, 24)).toBe(true);
    expect(geomHit(line, 100, 40)).toBe(false);
  });
});

describe("pressing shapes", () => {
  const SPEC = `state n=0 sel=''
scene "Two boxes and a dot" w=400 h=200
  rect x=20 y=20 w=100 h=80 fill=accent on=inc:n
  circle x=300 y=100 r=50 fill=good on=set:sel:'dot'
  rect x=200 y=150 w=60 h=40 fill=line`;

  it("runs a shape's actions when it's clicked, and nothing for empty space or plain shapes", () => {
    const ui = render(SPEC, { components: ON });
    const { at } = sceneAt(ui, 400, 200);
    ui.click(...at(60, 60));
    expect(ui.state.n).toBe(1);
    ui.click(...at(300, 100));
    expect(ui.state.sel).toBe("dot");
    ui.click(...at(230, 170));
    ui.click(...at(380, 10));
    expect(ui.state).toMatchObject({ n: 1, sel: "dot" });
    ui.destroy();
  });

  it("hits a circle by its outline, not its box", () => {
    const ui = render(SPEC, { components: ON });
    const { at } = sceneAt(ui, 400, 200);
    ui.click(...at(258, 58)); // inside the circle's box, outside the circle
    expect(ui.state.sel).toBe("");
    ui.destroy();
  });

  it("stays exact at any width (the scene scales)", () => {
    for (const width of [280, 600, 1100]) {
      const ui = render(SPEC, { components: ON, width });
      const { at } = sceneAt(ui, 400, 200);
      ui.click(...at(115, 95));
      ui.click(...at(125, 105));
      expect(ui.state.n, `width ${width}`).toBe(1);
      ui.destroy();
    }
  });

  it("follows groups' moves, turns and scales, and a shape's own turn", () => {
    const ui = render(`state n=0
scene "Turned" w=400 h=400
  group x=200 y=200 rotate=45 scale=2
    rect x=-20 y=-20 w=40 h=40 fill=accent on=inc:n rotate=0`, { components: ON });
    const { at } = sceneAt(ui, 400, 400);
    // Turned 45° and doubled: the square's corners point up, down, left and right, 56 px out.
    ui.click(...at(200, 150));
    expect(ui.state.n).toBe(1);
    ui.click(...at(240, 160)); // inside its upright box, outside the turned square
    expect(ui.state.n).toBe(1);
    ui.destroy();
  });

  it("picks the last drawn of overlapping shapes, and a shape inside a pressable group over the group", () => {
    const ui = render(`state hit=''
scene "Stack" w=400 h=200
  rect x=20 y=20 w=200 h=150 fill=line on=set:hit:'back'
  rect x=100 y=60 w=100 h=60 fill=accent on=set:hit:'front'
  group x=260 y=20 on=set:hit:'machine'
    rect x=0 y=0 w=120 h=150 fill=surface stroke=line
    circle x=60 y=40 r=16 fill=good on=set:hit:'light'`, { components: ON });
    const { at } = sceneAt(ui, 400, 200);
    ui.click(...at(150, 90));
    expect(ui.state.hit).toBe("front");
    ui.click(...at(40, 40));
    expect(ui.state.hit).toBe("back");
    ui.click(...at(320, 60));
    expect(ui.state.hit).toBe("light");
    ui.click(...at(320, 140));
    expect(ui.state.hit).toBe("machine");
    ui.destroy();
  });

  it("presses a drawing used several times, each use on its own", () => {
    const ui = render(`state sel=''
scene "Uses" w=400 h=200
  define "dot"
    circle x=0 y=0 r=30 fill={c}
  use "dot" x=100 y=100 args={{c: 'accent'}} on=set:sel:'a'
  use "dot" x=300 y=100 args={{c: 'bad'}} on=set:sel:'b'`, { components: ON });
    const { at } = sceneAt(ui, 400, 200);
    ui.click(...at(300, 100));
    expect(ui.state.sel).toBe("b");
    ui.click(...at(100, 100));
    expect(ui.state.sel).toBe("a");
    ui.destroy();
  });

  it("isn't pressable where it can't be seen: fully faded, or outside the picture", () => {
    const ui = render(`state n=0
scene "Hidden" w=200 h=100
  rect x=0 y=0 w=100 h=100 fill=accent opacity=0 on=inc:n
  rect x=300 y=0 w=50 h=50 fill=accent on=inc:n
  rect x=150 y=0 w=100 h=50 fill=accent on=inc:n`, { components: ON });
    const { at } = sceneAt(ui, 200, 100);
    expect(sceneHits(ui)).toHaveLength(1);
    ui.click(...at(50, 50));
    expect(ui.state.n).toBe(0);
    // Half out of the picture: pressable on the half that shows.
    ui.click(...at(190, 20));
    expect(ui.state.n).toBe(1);
    ui.destroy();
  });
});

describe("state, each and actions", () => {
  const LINE = `state sel='cut' machines=[{id: 'cut', name: 'Cutter', x: 80, on: true}, {id: 'press', name: 'Press', x: 200, on: true}, {id: 'pack', name: 'Packer', x: 320, on: false}]
scene "Line" w=400 h=200
  each items=machines as=m
    group x={m.x} y=100 on=set:sel:{m.id} selected={sel == m.id} tip="{m.name}"
      rect x=-40 y=-40 w=80 h=80 rx=8 fill={m.on ? 'good' : 'line'}
      label "{m.name}" x=0 y=0 size=16 align=center fill=ink
text "Selected: {find(machines, 'id', sel).name}"`;

  it("sees the scene's each item in actions", () => {
    const ui = render(LINE, { components: ON });
    const { at } = sceneAt(ui, 400, 200);
    ui.click(...at(320, 100));
    expect(ui.state.sel).toBe("pack");
    expect(ui.text()).toContain("Selected: Packer");
    ui.destroy();
  });

  it("writes into the list item it was drawn from (toggle:m.on)", () => {
    const ui = render(LINE.replace("on=set:sel:{m.id}", "on=toggle:m.on"), { components: ON });
    const { at } = sceneAt(ui, 400, 200);
    ui.click(...at(320, 100));
    expect((ui.state.machines as Array<{ on: boolean }>)[2]!.on).toBe(true);
    expect(ui.warnings).toEqual([]);
    ui.destroy();
  });

  it("repaints from state changed outside the scene, without asking the model", () => {
    const ui = render(LINE, { components: ON, theme: lightTheme });
    const fills = () => ui.drawOps.filter((o) => o.op === "fill").map((o) => o.fillStyle);
    const before = fills().filter((c) => c === lightTheme.colors.good).length;
    ui.set("machines", [{ id: "cut", name: "Cutter", x: 80, on: false }, { id: "press", name: "Press", x: 200, on: false }, { id: "pack", name: "Packer", x: 320, on: false }]);
    expect(before).toBe(2);
    expect(fills().filter((c) => c === lightTheme.colors.good)).toHaveLength(0);
    ui.destroy();
  });

  it("emits to the host with the item's value", () => {
    const ui = render(LINE.replace("on=set:sel:{m.id}", "on=emit:inspect:{m.id}"), { components: ON });
    const { at } = sceneAt(ui, 400, 200);
    ui.click(...at(200, 100));
    expect(ui.emitted).toEqual([{ name: "inspect", value: "press" }]);
    ui.destroy();
  });

  it("outlines the selected shape in the theme's accent, and moves it when the selection changes", () => {
    const ui = render(LINE, { components: ON });
    const outlines = () => ui.drawOps.filter((o) => o.op === "stroke" && o.strokeStyle === lightTheme.colors.accent).length;
    expect(outlines()).toBeGreaterThan(0);
    ui.set("sel", "nothing");
    expect(outlines()).toBe(0);
    ui.destroy();
  });

  it("outlines a selected group once, around its outer shape, not every part and word inside it", () => {
    const ui = render(LINE, { components: ON });
    // The selected machine is a rect with a label on it: one outline, stroked twice (a light edge, then the accent).
    expect(ui.drawOps.filter((o) => o.op === "stroke" && o.strokeStyle === lightTheme.colors.accent)).toHaveLength(1);
    ui.destroy();
  });

  it("shows a tip while hovered", () => {
    const ui = render(LINE, { components: ON });
    const { at } = sceneAt(ui, 400, 200);
    expect(ui.text().filter((t) => t === "Press")).toHaveLength(1);
    hover(ui, at(200, 70));
    expect(ui.text().filter((t) => t === "Press")).toHaveLength(2);
    ui.destroy();
  });
});

describe("keyboard and screen readers", () => {
  const SPEC = `state sel=''
scene "Network" w=400 h=200
  circle x=60 y=100 r=30 fill=accent on=set:sel:'web' name="Web server" tip="Healthy"
  group x=170 y=70 on=set:sel:'db' selected={sel == 'db'}
    rect x=0 y=0 w=60 h=60 fill=warn
    label "Database" x=30 y=30 size=12 align=center fill=ink
  group x=340 y=100 on=set:sel:'cache' tip="Cache, 3 nodes"
    circle x=0 y=0 r=24 fill=good`;

  it("makes each pressable shape a Tab stop, in drawing order, pressed with Enter and Space", () => {
    const ui = render(SPEC, { components: ON });
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      ui.tab();
      ui.key(i === 1 ? " " : "Enter");
      seen.push(String(ui.state.sel));
    }
    expect(seen).toEqual(["web", "db", "cache"]);
    ui.destroy();
  });

  it("keeps focus on the same shape across repaints", () => {
    const ui = render(SPEC, { components: ON });
    ui.tab();
    ui.tab();
    ui.set("sel", "x");
    ui.key("Enter");
    expect(ui.state.sel).toBe("db");
    ui.destroy();
  });

  it("is a figure with a named button for each pressable shape", () => {
    const ui = render(SPEC, { components: ON });
    ui.set("sel", "db");
    const tree = JSON.stringify(ui.accessibility({ full: true }));
    expect(tree).toMatch(/"role":"figure","name":"Network"/);
    expect(tree).toMatch(/"role":"button","name":"Web server","description":"Healthy"/);
    expect(tree).toMatch(/"role":"button","name":"Database","pressed":true/);
    expect(tree).toMatch(/"role":"button","name":"Cache, 3 nodes"/);
    ui.destroy();
  });

  it("can be pressed by a screen reader through the mirror", () => {
    const ui = render(SPEC, { components: ON });
    type N = { key: string; name?: string; children: N[] };
    const find = (n: N): N | undefined => (n.name === "Cache, 3 nodes" ? n : n.children.map(find).find(Boolean));
    const node = find(ui.accessibility({ full: true }) as unknown as N);
    expect(node).toBeDefined();
    ui.mirror.activate(node!.key);
    expect(ui.state.sel).toBe("cache");
    ui.destroy();
  });

  it("stays a plain picture when nothing in it can be pressed", () => {
    const ui = render(`scene "Sunset" w=200 h=100\n  circle x=100 y=50 r=30 fill=warn`, { components: ON });
    expect(sceneHits(ui)).toEqual([]);
    expect(JSON.stringify(ui.accessibility({ full: true }))).toMatch(/"role":"img","name":"Sunset"/);
    ui.destroy();
  });
});

describe("animation", () => {
  let queue: FrameRequestCallback[] = [];
  const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
    queue = [];
    g.requestAnimationFrame = (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; };
    g.cancelAnimationFrame = () => {};
  });
  afterEach(() => {
    vi.useRealTimers();
    delete g.requestAnimationFrame;
    delete g.cancelAnimationFrame;
  });
  const frame = (ms: number) => { vi.advanceTimersByTime(ms); const now = queue; queue = []; for (const cb of now) cb(performance.now()); };

  it("moves a shape's hit region with it, frame by frame", () => {
    const canvas = new FakeCanvas();
    const ui = new SayShape(canvas as unknown as HTMLCanvasElement, { components: ON, width: 440, padding: 20, animate: true });
    ui.setSpec(`state n=0\nscene "Moving" w=400 h=100 duration=4 loop=false\n  circle x={50 + 75*t} y=50 r=20 fill=accent on=inc:n`);
    frame(0);
    const box = ui.boxes!.children[0]!;
    const centerX = () => { const r = ui.hitRegions.find((h) => h.box.node.type === "scene")!.box; return r.x + r.w / 2; };
    const start = centerX();
    frame(2000);
    const mid = centerX();
    expect(mid - start).toBeCloseTo((150 * box.w) / 400, 0);
    expect(ui.targetAt(mid, box.y + box.h / 2)).not.toBeNull();
    expect(ui.targetAt(start, box.y + box.h / 2)).toBeNull();
    ui.destroy();
  });

  it("stays pressable with reduced motion, at its resting place", () => {
    const ui = render(`state n=0\nscene "Moving" w=400 h=100 duration=4\n  circle x={50 + 75*t} y=50 r=20 fill=accent on=inc:n`, { components: ON });
    const { at } = sceneAt(ui, 400, 100);
    ui.click(...at(350, 50));
    expect(ui.state.n).toBe(1);
    ui.destroy();
  });
});

describe("language", () => {
  const SPEC = `state sel=''
scene "Plant" w=400 h=200
  each items={range(3)} as=i
    rect x={20 + i*130} y=50 w=100 h=100 fill=accent on=set:sel:{i} selected={sel == i} tip="Machine {i + 1}"`;

  it("parses pressable shapes with no problems, and every prefix while streaming", () => {
    expect(parse(SPEC, on).diagnostics).toEqual([]);
    const lines = SPEC.split("\n");
    for (let i = 1; i <= lines.length; i++) {
      expect(parse(lines.slice(0, i).join("\n"), on).diagnostics.filter((d) => d.severity === "error"), `first ${i} lines`).toEqual([]);
    }
  });

  it("warns about a broken action and still draws the shape", () => {
    const d = parse(`scene "A" w=100 h=100\n  rect x=0 y=0 w=50 h=50 fill=accent on=jump:sky`, on).diagnostics;
    expect(d).toEqual([expect.objectContaining({ line: 2, severity: "warning" })]);
    const ui = render(`state n=0\nscene "A" w=100 h=100\n  rect x=0 y=0 w=50 h=50 fill=accent on=jump:sky`, { components: ON });
    expect(() => ui.click(...sceneAt(ui, 100, 100).at(25, 25))).not.toThrow();
    ui.destroy();
  });

  it("keeps scenes without on= exactly as they were: no regions, no extra drawing", () => {
    const plain = `scene "A" w=300 h=150\n  rect x=10 y=10 w=100 h=50 fill=accent\n  label "Hi" x=150 y=75 size=20 fill=ink`;
    const ui = render(plain, { components: ON });
    expect(sceneHits(ui)).toEqual([]);
    expect(ui.drawOps.map((o) => o.op)).toEqual(["fill", "fillText"]);
    ui.destroy();
  });

  it("bounds what a spec can make pressable by the shape limit", () => {
    const ui = render(`state n=0\nscene "Many" w=400 h=400\n  each items={range(500)} as=a\n    each items={range(10)} as=b\n      rect x={a % 40 * 10} y={b * 40} w=8 h=8 fill=accent on=inc:n`, { components: ON });
    expect(sceneHits(ui).length).toBeLessThanOrEqual(2000);
    ui.destroy();
  });
});

describe("the drawing check, for pressable shapes, phones and contrast", () => {
  const review = (spec: string) => reviewScenes(parse(spec, on)).map((d) => `${d.line}: ${d.message}`);

  it("finds a pressable shape too small to tap on a phone", () => {
    expect(review(`state n=0\nscene "A" w=800 h=400\n  circle x=100 y=100 r=8 fill=accent on=inc:n`))
      .toEqual([expect.stringMatching(/^3: Drawing: this pressable circle is only 7 px across on a phone, too small to tap/)]);
  });

  it("finds pressable shapes on top of each other, but not a shape inside its pressable group", () => {
    expect(review(`state n=0\nscene "A" w=400 h=200\n  rect x=20 y=20 w=100 h=100 fill=accent on=inc:n\n  rect x=30 y=30 w=100 h=100 fill=good on=inc:n`))
      .toEqual([expect.stringMatching(/^4: Drawing: this pressable rect is mostly on top of the one on line 3/)]);
    expect(review(`state n=0\nscene "A" w=400 h=200\n  group x=20 y=20 on=inc:n\n    rect x=0 y=0 w=100 h=100 fill=accent\n    circle x=50 y=50 r=20 fill=good on=inc:n`)).toEqual([]);
  });

  it("finds a pressable shape outside the picture", () => {
    expect(review(`state n=0\nscene "A" w=400 h=200\n  rect x=500 y=20 w=100 h=100 fill=accent on=inc:n`))
      .toEqual([expect.stringMatching(/^3: Drawing: this pressable rect is outside the picture/)]);
  });

  it("finds a label too small to read on a phone", () => {
    expect(review(`scene "A" w=1000 h=400\n  label "Throughput" x=100 y=100 size=14 fill=ink`))
      .toEqual([expect.stringMatching(/^2: Drawing: the label "Throughput" is only 4.6 px tall on a phone. Make its size at least 25/)]);
  });

  it("finds labels too close in color to what's under them, saying which mode", () => {
    expect(review(`scene "A" w=300 h=100\n  rect x=0 y=0 w=300 h=100 fill="#FFFFFF"\n  label "Faint" x=20 y=50 size=20 fill="#DDDDDD"`))
      .toEqual([expect.stringMatching(/^3: Drawing: the label "Faint" is hard to read: its color is too close/)]);
    // ink on a fixed dark box: fine in light mode (dark ink), unreadable in dark mode (light ink on... light? no: dark box).
    expect(review(`scene "A" w=300 h=100\n  rect x=0 y=0 w=300 h=100 fill="#111827"\n  label "Status" x=20 y=50 size=20 fill=ink`))
      .toEqual([expect.stringMatching(/^3: Drawing: the label "Status" is hard to read in light mode/)]);
    // The default black words on the card behind the scene, in dark mode.
    expect(review(`scene "A" w=300 h=100\n  label "Plain" x=20 y=50 size=20`))
      .toEqual([expect.stringMatching(/^2: Drawing: the label "Plain" is hard to read in dark mode/)]);
  });

  it("doesn't judge contrast it can't know: gradients, see-through fills, shadows", () => {
    expect(review(`scene "A" w=300 h=100
  gradient id=sky from="#FFFFFF" to="#EEEEEE"
  rect x=0 y=0 w=300 h=100 fill="url(sky)"
  label "Over a gradient" x=20 y=30 size=20 fill="#F5F5F5"
  rect x=150 y=50 w=150 h=50 fill="ink 40%"
  label "Glass" x=160 y=75 size=20 fill=surface`)).toEqual([]);
  });

  it("reads hex, rgb and hsl colors, and works out contrast as WCAG does", () => {
    expect(contrast(parseColor("#000")!, parseColor("#FFFFFF")!)).toBeCloseTo(21, 0);
    expect(contrast(parseColor("rgb(255, 255, 255)")!, parseColor("hsl(0, 0%, 100%)")!)).toBeCloseTo(1);
    expect(parseColor("#11223380")!.a).toBeCloseTo(0.5, 1);
    expect(parseColor("tomato")).toBeNull();
  });

  it("checks both themes' colors when no theme is given, and only the given one otherwise", () => {
    const spec = `scene "A" w=300 h=100\n  label "Plain" x=20 y=50 size=20`;
    expect(reviewScenes(parse(spec, on), { theme: lightTheme })).toEqual([]);
    expect(reviewScenes(parse(spec, on), { theme: darkTheme })).toHaveLength(1);
  });
});

describe("the factory monitor sample", () => {
  it("parses clean, and the drawing check finds nothing", () => {
    const p = parse(FACTORY_MONITOR, on);
    expect(p.diagnostics).toEqual([]);
    expect(reviewScenes(p)).toEqual([]);
  });

  it("parses every prefix while streaming, and renders as it arrives", () => {
    const lines = FACTORY_MONITOR.split("\n");
    for (let i = 1; i <= lines.length; i++) {
      expect(parse(lines.slice(0, i).join("\n"), on).diagnostics.filter((d) => d.severity === "error"), `first ${i} lines`).toEqual([]);
    }
    const ui = render("", { components: ON });
    ui.stream(lines.map((l) => l + "\n"));
    expect(ui.hits.filter((h) => h.box.node.type === "scene")).toHaveLength(4);
    ui.destroy();
  });

  for (const [theme, width] of [[lightTheme, 1000], [darkTheme, 1000], [lightTheme, 320], [darkTheme, 320]] as const) {
    it(`selects a machine, updates the panel and the controls act on it (${theme.name}, ${width} px)`, () => {
      const ui = render(FACTORY_MONITOR, { components: ON, theme, width });
      const { at } = sceneAt(ui, 800, 280);
      ui.click(...at(490, 110));
      expect(ui.state.sel).toBe("weld");
      expect(ui.text()).toContain("Robot welder");
      // The selection outline is drawn in this theme's accent.
      expect(ui.drawOps.some((o) => o.op === "stroke" && o.strokeStyle === theme.colors.accent)).toBe(true);
      // The output slider beside it writes to the selected machine in the list.
      const sliders = ui.findAll({ type: "slider" }).filter((f) => f.box);
      expect(sliders).toHaveLength(1);
      const slider = sliders[0]!;
      ui.drag({ id: slider.node.id }, slider.box!.x + slider.box!.w);
      expect((ui.state.machines as Array<{ id: string; rate: number }>).find((m) => m.id === "weld")!.rate).toBe(150);
      ui.press({ type: "switch" });
      expect(ui.state.running).toBe(false);
      ui.destroy();
    });
  }
});

/** Each of these was found by an independent review of the first version. */
describe("review findings", () => {
  const MACHINES = `state picked=[] sel='' machines=[{id: 'cut', on: false, rate: 1}, {id: 'press', on: false, rate: 1}, {id: 'pack', on: false, rate: 1}]`;
  const lineOf = (action: string, extra = "") => `${MACHINES}
scene "Line" w=400 h=200
  each items=machines as=m${extra}
    rect x={20 + i * 130} y=50 w=100 h=100 fill=accent on=${action}`.replace("as=m", "as=m index=i");
  const machines = (ui: Rendered) => ui.state.machines as Array<{ id: string; on: boolean; rate: number }>;

  it("writes several fields of the same scene item in one press", () => {
    const ui = render(lineOf("set:m.on:true;set:m.rate:5"), { components: ON });
    ui.click(...sceneAt(ui, 400, 200).at(200, 100));
    expect(machines(ui)[1]).toMatchObject({ on: true, rate: 5 });
    expect(ui.warnings).toEqual([]);
    ui.destroy();
  });

  it("writes to the list the item was drawn from, even when another list holds it too", () => {
    const ui = render(lineOf("add:picked:{m};toggle:m.on"), { components: ON });
    const { at } = sceneAt(ui, 400, 200);
    ui.click(...at(200, 100));
    ui.click(...at(200, 100));
    expect(machines(ui)[1]!.on).toBe(false);
    expect((ui.state.picked as unknown[]).length).toBe(2);
    ui.destroy();
  });

  it("removes the item a shape was drawn from (remove:m)", () => {
    const ui = render(lineOf("remove:m"), { components: ON });
    ui.click(...sceneAt(ui, 400, 200).at(200, 100));
    expect(machines(ui).map((m) => m.id)).toEqual(["cut", "pack"]);
    expect(ui.warnings).toEqual([]);
    ui.destroy();
  });

  it("still finds an item of a filtered list in state, as each does", () => {
    const ui = render(`${MACHINES}
scene "Line" w=400 h=200
  each items={filter(machines, 'on', false)} as=m index=i
    rect x={20 + i * 130} y=50 w=100 h=100 fill=accent on=toggle:m.on`, { components: ON });
    ui.click(...sceneAt(ui, 400, 200).at(200, 100));
    expect(machines(ui)[1]!.on).toBe(true);
    ui.destroy();
  });

  it("doesn't let a drawing's args be written as if they were state", () => {
    const ui = render(`state n=1
scene "Use" w=200 h=200
  define "btn"
    rect x=0 y=0 w=100 h=100 fill=accent on=set:n:{n + 1}
  use "btn" x=50 y=50 args={{n: 40}}`, { components: ON });
    ui.click(...sceneAt(ui, 200, 200).at(100, 100));
    // n is the drawing's own arg here, not state: the write is refused with a warning, never sent elsewhere.
    expect(ui.state.n).toBe(1);
    expect(ui.warnings.join(" ")).toMatch(/Can't change n/);
    ui.destroy();
  });

  it("fills and presses a self-crossing polygon the way the canvas fills it (nonzero)", () => {
    const ui = render(`state n=0
scene "Star" w=400 h=400
  polygon points="200,40 294,330 48,150 352,150 106,330" fill=warn on=inc:n`, { components: ON });
    ui.click(...sceneAt(ui, 400, 400).at(200, 200));
    expect(ui.state.n).toBe(1);
    ui.destroy();
  });

  it("presses a path by its outline, not its box, and an open stroked path near its line", () => {
    const ui = render(`state n=0 k=0
scene "Paths" w=400 h=400
  path d="M0 0 L300 0 L0 300 Z" fill=accent on=inc:n
  path d="M200 380 Q300 280 390 380" stroke=ink width=4 on=inc:k`, { components: ON });
    const { at } = sceneAt(ui, 400, 400);
    ui.click(...at(280, 280));
    expect(ui.state.n).toBe(0);
    ui.click(...at(50, 50));
    expect(ui.state.n).toBe(1);
    ui.click(...at(295, 330)); // on the curve's peak
    expect(ui.state.k).toBe(1);
    ui.click(...at(295, 370)); // under the curve, away from the line
    expect(ui.state.k).toBe(1);
    ui.destroy();
  });

  it("keeps focus on the same item when the list is reordered, with key=", () => {
    const spec = `state sel='' machines=[{id: 'cut'}, {id: 'press'}, {id: 'pack'}]
scene "Line" w=400 h=200
  each items=machines as=m index=i key={m.id}
    rect x={20 + i * 130} y=50 w=100 h=100 fill=accent on=set:sel:{m.id}`;
    const ui = render(spec, { components: ON });
    ui.tab();
    ui.tab();
    ui.set("machines", [{ id: "press" }, { id: "cut" }, { id: "pack" }]);
    ui.key("Enter");
    expect(ui.state.sel).toBe("press");
    ui.destroy();
  });

  it("outlines a pressable label on its own when it's selected", () => {
    const ui = render(`scene "L" w=300 h=100
  label "Pick me" x=20 y=50 size=24 fill=ink on=set:x:1 selected=true`, { components: ON });
    expect(ui.drawOps.filter((o) => o.op === "stroke" && o.strokeStyle === lightTheme.colors.accent)).toHaveLength(1);
    ui.destroy();
  });

  it("warns about a pressable shape thin in one direction, and checks nested groups quickly", () => {
    expect(reviewScenes(parse(`state n=0
scene "A" w=400 h=200
  rect x=20 y=50 w=200 h=2 fill=accent on=inc:n`, on)).map((d) => d.message))
      .toEqual([expect.stringMatching(/too small to tap/)]);
    const depth = 60;
    const lines = [`state n=0`, `scene "Deep" w=1000 h=600`];
    for (let d = 0; d < depth; d++) lines.push(`${"  ".repeat(d + 1)}group on=inc:n`);
    lines.push(`${"  ".repeat(depth + 1)}each items={range(1500)} as=i`, `${"  ".repeat(depth + 2)}rect x={i % 50 * 20} y={floor(i / 50) * 20} w=18 h=18 fill=accent`);
    const parsed = parse(lines.join("\n"), on);
    const start = performance.now();
    reviewScenes(parsed);
    expect(performance.now() - start).toBeLessThan(1500);
  });
});

describe("the mirror follows moving pressable shapes", () => {
  let queue: FrameRequestCallback[] = [];
  const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
    queue = [];
    g.requestAnimationFrame = (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; };
    g.cancelAnimationFrame = () => {};
  });
  afterEach(() => {
    vi.useRealTimers();
    delete g.requestAnimationFrame;
    delete g.cancelAnimationFrame;
  });
  const frame = (ms: number) => { vi.advanceTimersByTime(ms); const now = queue; queue = []; for (const cb of now) cb(performance.now()); };

  it("adds a shape that appears mid-animation, and moves one that moves", () => {
    type Node = { name?: string; rect: { x: number }; children: Node[] };
    let tree: Node | null = null;
    const canvas = new FakeCanvas();
    const ui = new SayShape(canvas as unknown as HTMLCanvasElement, {
      components: ON, width: 440, padding: 20, animate: true,
      accessibility: { announce() {}, update: (t) => { tree = t as unknown as Node; }, destroy() {} },
    });
    ui.setSpec(`state n=0
scene "Moving" w=400 h=100 duration=2 loop=false
  circle x={50 + 100*t} y=50 r=20 fill=accent on=inc:n name="Mover"
  rect x=300 y=20 w=60 h=60 fill=good on=inc:n name="Go" if={t > 1}`);
    frame(0);
    for (let i = 0; i < 20; i++) frame(150);
    const all: Node[] = [];
    const walk = (n: Node) => { all.push(n); n.children.forEach(walk); };
    walk(tree!);
    expect(all.map((n) => n.name)).toEqual(expect.arrayContaining(["Mover", "Go"]));
    const box = ui.boxes!.children[0]!;
    const mover = all.find((n) => n.name === "Mover")!;
    expect(mover.rect.x).toBeGreaterThan(box.x + (200 * box.w) / 400);
    ui.destroy();
  });
});

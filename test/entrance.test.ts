import { describe, expect, it } from "vitest";
import { coreComponents, languageGuide, parse, Registry, type ComponentDef } from "../src";
import { ENTER_MS, enterPose, ENTER_SCALE, lineShift, MAX_STAGGER_STEPS, MotionStarts, STAGGER_MS } from "../src/motion";
import { render, type Rendered } from "../src/testing";
import type { Box, SayShapeNode } from "../src/types";
import { componentExampleSpec } from "../src/prompt";
import { mapComponents } from "../src/components/map";
import { sceneComponents } from "../src/components/scene";

const registry = new Registry(coreComponents);
const read = (src: string) => parse(src.endsWith("\n") ? src : src + "\n", registry);
const messages = (src: string) => read(src).diagnostics.map((d) => d.message);

/** A screen that moves: animate on, with the test's clock. */
const moving = (spec: string, opts: Parameters<typeof render>[1] = {}) => render(spec, { animate: true, clock: true, ...opts });
const alphaOf = (ui: Rendered, text: string) => ui.drawOps.find((d) => d.op === "fillText" && d.args[0] === text)?.globalAlpha;
const progressOf = (ui: Rendered, text: string) => ui.entrance({ text })?.progress;

/** Every box, as plain numbers, to compare layouts. */
function boxes(ui: Rendered): Array<[string, number, number, number, number]> {
  const out: Array<[string, number, number, number, number]> = [];
  const walk = (b: Box) => { out.push([b.node.id, b.x, b.y, b.w, b.h]); b.children.forEach(walk); };
  if (ui.sayshape.boxes) walk(ui.sayshape.boxes);
  return out;
}
const regions = (ui: Rendered) => ui.hits.map((h) => [h.box.node.id, h.box.x, h.box.y, h.box.w, h.box.h, String(h.detail)]);

describe("motion: parsing", () => {
  it("accepts enter= on any element and stagger= on containers, without diagnostics", () => {
    expect(read(`column enter=rise stagger=true\n  text "A" enter=fade\n  card enter=scale\n    button "Go" on=emit:go enter=rise`).diagnostics).toEqual([]);
    expect(read(`row stagger=true\n  stat label="Days" value=2\n  stat label="Hikers" value=3`).diagnostics).toEqual([]);
  });

  it("says which values work when one doesn't", () => {
    expect(messages(`text "A" enter=slide`)).toEqual([`enter should be one of fade, rise, scale; got "slide"`]);
    expect(messages(`column stagger=yes\n  text "A"`)).toEqual([`stagger should be true or false, got "yes"`]);
  });

  it("warns where it can't play, and says where to put it", () => {
    expect(messages(`text "A" stagger=true`)[0]).toMatch(/stagger= only works on an element with children, and "text" has none. Use enter= here/);
    const each = messages(`state xs=[1, 2]\ncolumn\n  each items=xs as=x enter=rise\n    text "{x}"`);
    expect(each[0]).toMatch(/enter= on each doesn't play.*Put enter= on the element around it/);
    const item = messages(`menu "Actions"\n  menu-item "Edit" on=emit:edit enter=fade`);
    expect(item[0]).toMatch(/enter= on a menu-item doesn't play, since its menu draws it/);
  });

  it("keeps the Known props list as it was", () => {
    expect(messages(`text "A" colour=red`)[0]).toBe(`"text" has no prop "colour". Known props: style, weight, tone, align, strike, icon, rich, if, tip`);
  });

  it("streams: every prefix cut at a line boundary parses without errors", () => {
    const spec = `state n=2\ncolumn enter=rise stagger=true\n  text "Title" enter=fade\n  row stagger=true\n    stat label="A" value={n}\n    stat label="B" value=3\n  button "More" on=inc:n enter=scale\n`;
    const lines = spec.split("\n");
    for (let i = 0; i <= lines.length; i++) {
      const r = parse(lines.slice(0, i).join("\n") + "\n", registry, { partial: true });
      expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    }
    expect(read(spec).diagnostics).toEqual([]);
  });
});

describe("motion: the guide", () => {
  it("says nothing about motion unless asked", () => {
    for (const mode of ["full", "compact"] as const) {
      const g = languageGuide(registry, { mode });
      expect(g).not.toMatch(/enter=|stagger=|MOTION/);
    }
  });

  it("explains enter= and stagger= when motion is on, from the prop definitions", () => {
    const full = languageGuide(registry, { motion: true });
    expect(full).toMatch(/MOTION \(optional\)\n {4}enter=<fade\|rise\|scale>/);
    expect(full).toMatch(/stagger=<boolean> {2}On an element with children: they come in one after another/);
    expect(languageGuide(registry, { mode: "compact", motion: true })).toMatch(/MOTION \(optional, any element\): enter=fade\|rise\|scale/);
  });
});

describe("motion: entrances on the clock", () => {
  const spec = `text "Hello" enter=rise\ntext "Plain"`;

  it("starts at its first frame, moves mid-way, and rests at the end", () => {
    const ui = moving(spec);
    expect(progressOf(ui, "Hello")).toBe(0);
    expect(alphaOf(ui, "Hello")).toBe(0);
    ui.clock.advance(ENTER_MS / 2);
    const mid = progressOf(ui, "Hello")!;
    expect(mid).toBeCloseTo(0.5, 5);
    const a = alphaOf(ui, "Hello")!;
    expect(a).toBeGreaterThan(0.5);
    expect(a).toBeLessThan(1);
    ui.clock.advance(ENTER_MS);
    expect(progressOf(ui, "Hello")).toBe(1);
    expect(alphaOf(ui, "Hello")).toBe(1);
    // Without enter= an element has none (it only fades in, as before).
    expect(ui.entrance({ text: "Plain" })).toBeNull();
  });

  it("stops asking for frames once everything is at rest", () => {
    const ui = moving(spec);
    ui.clock.advance(ENTER_MS * 2);
    let frames = 0;
    ui.sayshape.on("render", () => frames++);
    ui.clock.advance(1000);
    ui.sayshape.renderNow();
    expect(frames).toBe(0);
  });

  it("changes painting only: boxes, hit regions, the accessibility tree and text layer match the still screen", () => {
    const s = `column enter=rise stagger=true\n  text "Hello" enter=scale tip="Hi"\n  button "Go" on=emit:go enter=rise\n  card enter=fade\n    text "Inside"`;
    const still = render(s);
    const ui = moving(s);
    ui.clock.advance(ENTER_MS / 3);
    expect(progressOf(ui, "Go")).toBeGreaterThan(0);
    expect(progressOf(ui, "Go")).toBeLessThan(1);
    expect(boxes(ui)).toEqual(boxes(still));
    expect(regions(ui)).toEqual(regions(still));
    expect(ui.accessibility({ full: true })).toEqual(still.accessibility({ full: true }));
    expect(ui.textLayer.lines.map((l) => l.text)).toEqual(still.textLayer.lines.map((l) => l.text));
    // And it can be pressed mid-entrance, where it will end up.
    ui.press("button");
    expect(ui.emitted.map((e) => e.name)).toEqual(["go"]);
  });

  it("is drawn at rest at once under reduced motion or with animate: false", () => {
    for (const ui of [moving(spec, { reducedMotion: true }), render(spec, { clock: true })]) {
      expect(progressOf(ui, "Hello")).toBe(1);
      expect(alphaOf(ui, "Hello")).toBe(1);
      expect(ui.sayshape.boxes).toBeTruthy();
    }
  });

  it("stagger=true brings children in one step apart, with the parent's role", () => {
    const ui = moving(`column enter=rise stagger=true\n  text "A"\n  text "B"\n  text "C" enter=scale`);
    expect(ui.entrance({ text: "B" })?.role).toBe("rise");
    expect(ui.entrance({ text: "C" })?.role).toBe("scale");
    ui.clock.advance(STAGGER_MS * 2);
    const a = progressOf(ui, "A")!, b = progressOf(ui, "B")!, c = progressOf(ui, "C")!;
    expect(a).toBeCloseTo((STAGGER_MS * 2) / ENTER_MS, 5);
    expect(b).toBeCloseTo(STAGGER_MS / ENTER_MS, 5);
    expect(c).toBe(0);
    // The parent's own entrance isn't laid over its children's: A's opacity is its own.
    expect(alphaOf(ui, "A")).toBeCloseTo(enterPose("rise", a, 0).alpha, 5);
  });

  it("stagger=true alone fades the children in by turns", () => {
    const ui = moving(`row stagger=true\n  text "A"\n  text "B"`);
    expect(ui.entrance({ text: "B" })?.role).toBe("fade");
    expect(ui.entrance({ type: "row" })).toBeNull();
  });

  it("caps the steps, so a long list doesn't take seconds", () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const ui = moving(`state xs=[${items.join(", ")}]\ncolumn stagger=true\n  each items=xs as=x\n    text "Item {x}"`);
    ui.clock.advance(STAGGER_MS * MAX_STAGGER_STEPS + ENTER_MS / 2);
    expect(progressOf(ui, "Item 29")).toBeGreaterThan(0);
    expect(progressOf(ui, "Item 29")).toBeCloseTo(progressOf(ui, "Item 10")!, 5);
  });

  it("poses: rise moves up from below, scale grows from a little smaller", () => {
    expect(enterPose("rise", 0, 14)).toEqual({ alpha: 0, dy: 14, scale: 1 });
    expect(enterPose("scale", 0, 14)).toEqual({ alpha: 0, dy: 0, scale: ENTER_SCALE });
    expect(enterPose("fade", 1, 14)).toEqual({ alpha: 1, dy: 0, scale: 1 });
    expect(enterPose("rise", 0.5, 14).dy).toBeLessThan(7);
  });
});

describe("motion: scrolled into sight", () => {
  const tall = `spacer size=xl\n${Array.from({ length: 12 }, (_, i) => `text "Line ${i}"`).join("\n")}\ntext "Below" enter=rise\n`;

  it("waits below the visible area, plays when scrolled to, and only once", () => {
    const viewport = { top: 0, bottom: 120 };
    const ui = moving(tall, { viewport });
    ui.clock.advance(ENTER_MS * 2);
    expect(progressOf(ui, "Below")).toBe(0);
    expect(alphaOf(ui, "Below")).toBe(0);
    const y = ui.find({ text: "Below" }).box!.y;
    viewport.top = y - 60;
    viewport.bottom = y + 60;
    ui.sayshape.invalidate("paint");
    ui.sayshape.renderNow();
    expect(progressOf(ui, "Below")).toBe(0);
    ui.clock.advance(ENTER_MS / 2);
    expect(progressOf(ui, "Below")).toBeCloseTo(0.5, 5);
    ui.clock.advance(ENTER_MS);
    expect(progressOf(ui, "Below")).toBe(1);
    // Away and back: it stays where it is.
    viewport.top = 0; viewport.bottom = 120;
    ui.sayshape.invalidate("paint"); ui.sayshape.renderNow();
    viewport.top = y - 60; viewport.bottom = y + 60;
    ui.sayshape.invalidate("paint"); ui.sayshape.renderNow();
    expect(progressOf(ui, "Below")).toBe(1);
    expect(alphaOf(ui, "Below")).toBe(1);
  });

  it("with no visible area known, everything counts as in sight", () => {
    const ui = moving(tall);
    ui.clock.advance(ENTER_MS / 2);
    expect(progressOf(ui, "Below")).toBeCloseTo(0.5, 5);
  });
});

describe("motion: streaming and edits", () => {
  it("a line that arrives enters; lines already drawn don't play again", () => {
    const ui = moving("");
    const s = ui.sayshape;
    s.beginStream();
    s.push(`column stagger=true\n  text "One" enter=rise\n`);
    s.renderNow();
    ui.clock.advance(ENTER_MS * 2);
    expect(progressOf(ui, "One")).toBe(1);
    s.push(`  text "Two"\n  text "Thr`);
    s.renderNow();
    expect(progressOf(ui, "One")).toBe(1);
    expect(progressOf(ui, "Two")).toBe(0);
    ui.clock.advance(ENTER_MS / 2);
    expect(progressOf(ui, "Two")).toBeCloseTo(0.5, 5);
    s.push(`ee"\n`);
    s.endStream();
    s.renderNow();
    expect(progressOf(ui, "One")).toBe(1);
    expect(progressOf(ui, "Three")).toBe(0);
    ui.clock.advance(ENTER_MS * 2);
    expect(progressOf(ui, "Two")).toBe(1);
    expect(progressOf(ui, "Three")).toBe(1);
  });

  it("an edit that moves lines keeps what was shown at rest, and a new line enters", () => {
    const ui = moving(`text "Kept" enter=rise\ntext "Also" enter=fade\n`);
    ui.clock.advance(ENTER_MS * 2);
    ui.setSpec(`text "New" enter=scale\ntext "Kept" enter=rise\ntext "Also" enter=fade\n`);
    expect(progressOf(ui, "Kept")).toBe(1);
    expect(progressOf(ui, "Also")).toBe(1);
    expect(progressOf(ui, "New")).toBe(0);
    // A changed line is new.
    ui.clock.advance(ENTER_MS * 2);
    ui.setSpec(`text "New" enter=scale\ntext "Changed" enter=rise\ntext "Also" enter=fade\n`);
    expect(progressOf(ui, "Changed")).toBe(0);
    expect(progressOf(ui, "Also")).toBe(1);
  });

  it("a new spec with its state reset plays from the start", () => {
    const ui = moving(`text "Kept" enter=rise\n`);
    ui.clock.advance(ENTER_MS * 2);
    ui.setSpec(`text "Kept" enter=rise\n`, { resetState: true });
    expect(progressOf(ui, "Kept")).toBe(0);
  });

  it("lineShift maps unchanged lines through inserts, deletes and replacements", () => {
    const at = lineShift("a\nb\nc\nd", "a\nx\ny\nb\nc\nd");
    expect([1, 2, 3, 4].map(at)).toEqual([1, 4, 5, 6]);
    const del = lineShift("a\nb\nc", "a\nc");
    expect([1, 2, 3].map(del)).toEqual([1, null, 2]);
    const repl = lineShift("a\nb\nc", "a\nB\nc");
    expect([1, 2, 3].map(repl)).toEqual([1, null, 3]);
    const m = new MotionStarts();
    m.set("2:text", "enter", 5);
    m.set("3:card#k1", "enter", 6);
    m.set("root", "enter", 7);
    m.remap((n) => (n === 2 ? null : n + 1));
    expect(m.get("2:text", "enter")).toBeUndefined();
    expect(m.get("4:card#k1", "enter")).toBe(6);
    expect(m.get("root", "enter")).toBe(7);
  });
});

describe("motion: progress for a component's long-running motion", () => {
  const seen: number[] = [];
  const zoomer: ComponentDef = {
    type: "zoomer",
    category: "content",
    description: "Test only.",
    props: {},
    layout(box) { box.h = 40; },
    paint(box, ctx) { seen.push(ctx.progress(box, "zoom", 4000, "linear")); },
  };
  const components = [...coreComponents, zoomer];

  it("runs on the clock from first sight, carries across re-parses, and rests", () => {
    seen.length = 0;
    const ui = moving(`zoomer\n`, { components });
    ui.clock.advance(1000);
    expect(seen.at(-1)).toBeCloseTo(0.25, 5);
    ui.setSpec(`zoomer\n`);
    ui.sayshape.renderNow();
    ui.clock.advance(1000);
    expect(seen.at(-1)).toBeCloseTo(0.5, 5);
    ui.clock.advance(4000);
    expect(seen.at(-1)).toBe(1);
  });

  it("is 1 at once with motion off, and 0 until in sight", () => {
    seen.length = 0;
    moving(`zoomer\n`, { components, reducedMotion: true });
    expect(seen.at(-1)).toBe(1);
    seen.length = 0;
    const ui = moving(`spacer size=xl\nspacer size=xl\nspacer size=xl\nzoomer\n`, { components, viewport: { top: 0, bottom: 10 } });
    ui.clock.advance(2000);
    expect(seen.at(-1)).toBe(0);
  });
});

/** Follows translate() through save and restore, and says how far down each piece of text was drawn. */
function trackRise(ui: Rendered): { dyOf: Map<string, number>; balance: () => number; reset: () => void } {
  const g = ui.canvas.getContext("2d") as unknown as Record<string, (...a: unknown[]) => unknown>;
  const save = g.save!, restore = g.restore!, fillText = g.fillText!;
  let dy = 0, depth = 0;
  const stack: number[] = [];
  const dyOf = new Map<string, number>();
  g.save = () => { stack.push(dy); depth++; return save(); };
  g.restore = () => { dy = stack.pop() ?? 0; depth--; return restore(); };
  g.translate = (_x: unknown, y: unknown) => { dy += Number(y); };
  g.fillText = (...a: unknown[]) => { dyOf.set(String(a[0]), dy); return fillText(...a); };
  return { dyOf, balance: () => depth, reset: () => { dyOf.clear(); depth = 0; dy = 0; stack.length = 0; } };
}

describe("motion: what is drawn moves", () => {
  it("rise draws the element and what's inside it lower mid-way, and in place at rest", () => {
    const ui = moving(`card enter=rise\n  text "Inside"\ntext "Still"\n`);
    const t = trackRise(ui);
    ui.clock.advance(ENTER_MS / 2);
    expect(t.dyOf.get("Inside")).toBeGreaterThan(0);
    expect(t.dyOf.get("Still")).toBe(0);
    expect(t.balance()).toBe(0);
    t.reset();
    ui.clock.advance(ENTER_MS);
    expect(t.dyOf.get("Inside")).toBe(0);
    expect(t.balance()).toBe(0);
  });

  it("under stagger=true the parent's pose doesn't carry its children", () => {
    const ui = moving(`card enter=rise stagger=true\n  text "A" enter=fade\n  text "B"\n`);
    const t = trackRise(ui);
    ui.clock.advance(ENTER_MS / 4);
    // A only fades; B rises on its own turn, from the card's role.
    expect(t.dyOf.get("A")).toBe(0);
    expect(t.dyOf.get("B")).toBeGreaterThan(0);
    expect(t.balance()).toBe(0);
  });
});

describe("motion: every element", () => {
  const all = [...coreComponents, ...mapComponents, ...sceneComponents];
  const reg = new Registry(all);
  const types = new Set(all.map((c) => c.type));

  it("an element either plays enter= or the parser says it can't", () => {
    const boxed = new Set<string>(), silent = new Set<string>();
    for (const c of all) {
      const spec = componentExampleSpec(c, all);
      if (!spec) continue;
      const withEnter = spec.split("\n").map((l) => {
        const w = l.trim().split(/\s/)[0] ?? "";
        return types.has(w) && w !== "each" && w !== "if" ? `${l} enter=fade` : l;
      }).join("\n");
      const warned = new Set(parse(withEnter + "\n", reg).diagnostics.filter((d) => /enter=/.test(d.message)).map((d) => d.line));
      const ui = render(withEnter, { animate: true, clock: true, components: all });
      const shown = new Set<string>();
      const walkBoxes = (b: Box) => { shown.add(b.node.id); b.children.forEach(walkBoxes); };
      if (ui.sayshape.boxes) walkBoxes(ui.sayshape.boxes);
      const walk = (n: SayShapeNode) => {
        if (n.id !== "root" && n.type !== "each" && n.type !== "if" && !warned.has(n.line)) {
          if (shown.has(n.id)) {
            boxed.add(n.type);
            expect(ui.sayshape.entranceOf(n.id), `${n.type} in ${c.type}'s example`).not.toBeNull();
          } else silent.add(n.type);
        }
        n.children.forEach(walk);
      };
      walk(ui.sayshape.tree!);
    }
    // Hidden (another screen, tab or slide) is fine: it enters when shown. Never shown anywhere is not.
    expect([...silent].filter((t) => !boxed.has(t))).toEqual([]);
  });
});

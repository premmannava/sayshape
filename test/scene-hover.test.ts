/**
 * Hover in scenes: on-hover= and on-leave= on shapes, groups and uses
 * (src/components/scene/hover.ts), the engine's hover hook
 * (ComponentDef.hover) that drives them, and what a shape that's only
 * hovered is not: a Tab stop, a screen-reader button, an outlined target or
 * a tap target for the drawing check.
 */
import { describe, expect, it, vi } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { sceneComponents, reviewScenes } from "../src/components/scene";
import type { ComponentDef } from "../src/component";
import { render, type Rendered } from "../src/testing";
import type { Box } from "../src/types";

const ON = [...coreComponents, ...sceneComponents];
const on = new Registry(ON);

/** A function from scene coordinates to canvas pixels for the (only) scene. */
function sceneAt(ui: Rendered, w: number, h: number) {
  const box = ui.find({ type: "scene" }).box as Box;
  return (x: number, y: number): [number, number] => [box.x + (x * box.w) / w, box.y + (y * box.h) / h];
}
const sceneHits = (ui: Rendered) => ui.hits.filter((h) => h.box.node.type === "scene");

const METRO = `state hov=''
state lines=[{id: "red", c: "#E63946", y: 50}, {id: "blue", c: "#1D4ED8", y: 100}, {id: "green", c: "#2D6A4F", y: 150}]
scene "Metro map" w=400 h=200
  each items=lines as=l
    path d="M20 {l.y} L380 {l.y}" stroke={l.c} width=8 opacity={hov == "" || hov == l.id ? 1 : 0.25} on-hover=set:hov:{l.id} on-leave="set:hov:''"`;

/** The alpha each metro line's stroke was drawn with, by color. */
function lineAlphas(ui: Rendered): Record<string, number> {
  const out: Record<string, number> = {};
  for (const op of ui.drawOps) if (op.op === "stroke" && ["#E63946", "#1D4ED8", "#2D6A4F"].includes(op.strokeStyle)) out[op.strokeStyle] = op.globalAlpha;
  return out;
}

describe("on-hover and on-leave", () => {
  it("parses with no diagnostics, both ways of writing an empty text", () => {
    expect(parse(METRO, on).diagnostics).toEqual([]);
    const both = `state hov='x'\nscene "S" w=100 h=100\n  circle x=30 y=50 r=20 fill=accent on-leave=set:hov:""\n  circle x=70 y=50 r=20 fill=accent on-leave=set:hov:''`;
    expect(parse(both, on).diagnostics).toEqual([]);
    const ui = render(both, { components: ON, width: 240 });
    const at = sceneAt(ui, 100, 100);
    for (const x of [30, 70]) {
      ui.set("hov", "x");
      ui.hover(...at(x, 50));
      ui.hover(...at(50, 95));
      expect(ui.state.hov).toBe("");
    }
    ui.destroy();
  });

  it("warns about an action it can't read, like on=", () => {
    const d = parse(`scene "S" w=100 h=100\n  circle x=50 y=50 r=20 fill=accent on-hover=frob:x`, on).diagnostics;
    expect(d.some((x) => x.severity === "warning" && x.line === 2)).toBe(true);
  });

  it("metro map: hovering a line fades the others, leaving restores them", () => {
    const ui = render(METRO, { components: ON, width: 440 });
    const at = sceneAt(ui, 400, 200);
    expect(lineAlphas(ui)).toEqual({ "#E63946": 1, "#1D4ED8": 1, "#2D6A4F": 1 });
    ui.hover(...at(200, 100));
    expect(ui.state.hov).toBe("blue");
    expect(lineAlphas(ui)).toEqual({ "#E63946": 0.25, "#1D4ED8": 1, "#2D6A4F": 0.25 });
    // Straight onto another line: blue's leave, then red's hover.
    ui.hover(...at(200, 50));
    expect(ui.state.hov).toBe("red");
    expect(lineAlphas(ui)).toEqual({ "#E63946": 1, "#1D4ED8": 0.25, "#2D6A4F": 0.25 });
    // Between the lines, then off the canvas.
    ui.hover(...at(200, 75));
    expect(ui.state.hov).toBe("");
    ui.hover(...at(200, 150));
    expect(ui.state.hov).toBe("green");
    ui.leave();
    expect(ui.state.hov).toBe("");
    expect(lineAlphas(ui)).toEqual({ "#E63946": 1, "#1D4ED8": 1, "#2D6A4F": 1 });
    ui.destroy();
  });

  it("metro map: a finger changes nothing", () => {
    const ui = render(METRO, { components: ON, width: 440 });
    const at = sceneAt(ui, 400, 200);
    ui.click(...at(200, 100), { touch: true });
    expect(ui.state.hov).toBe("");
    expect(lineAlphas(ui)).toEqual({ "#E63946": 1, "#1D4ED8": 1, "#2D6A4F": 1 });
    ui.destroy();
  });

  it("planets: hovering one shows its name, leaving hides it", () => {
    const ui = render(`state hov=''
state planets=[{name: "Venus", x: 100}, {name: "Mars", x: 300}]
scene "Planets" w=400 h=200
  each items=planets as=p
    circle x={p.x} y=100 r=30 fill=accent on-hover=set:hov:{p.name} on-leave="set:hov:''"
  label "{hov}" x=200 y=180 size=16 align=center fill=ink if={hov != ""}`, { components: ON, width: 440 });
    const at = sceneAt(ui, 400, 200);
    expect(ui.text()).not.toContain("Mars");
    ui.hover(...at(300, 100));
    expect(ui.text()).toContain("Mars");
    ui.hover(...at(200, 40));
    expect(ui.text()).not.toContain("Mars");
    ui.hover(...at(100, 100));
    expect(ui.text()).toContain("Venus");
    ui.destroy();
  });

  it("a tap runs on= but never on-hover=", () => {
    const ui = render(`state n=0\nstate h=0\nscene "S" w=100 h=100\n  circle x=50 y=50 r=30 fill=accent on=inc:n on-hover=inc:h on-leave=inc:h`, { components: ON, width: 240 });
    const at = sceneAt(ui, 100, 100);
    ui.click(...at(50, 50), { touch: true });
    expect(ui.state).toMatchObject({ n: 1, h: 0 });
    // A mouse click hovers first, then presses.
    ui.click(...at(50, 50));
    expect(ui.state).toMatchObject({ n: 2, h: 1 });
    ui.destroy();
  });

  it("enters and leaves along the chain: a group's pressable child doesn't leave the group", () => {
    const ui = render(`state n=0
state enters=0
state leaves=0
scene "S" w=200 h=100
  group x=0 y=0 on-hover=inc:enters on-leave=inc:leaves
    rect x=10 y=10 w=180 h=80 fill=surface
    circle x=150 y=50 r=20 fill=accent on=inc:n`, { components: ON, width: 240 });
    const at = sceneAt(ui, 200, 100);
    ui.hover(...at(40, 50));
    expect(ui.state).toMatchObject({ enters: 1, leaves: 0 });
    ui.hover(...at(150, 50));
    ui.hover(...at(60, 50));
    ui.hover(...at(150, 50));
    expect(ui.state).toMatchObject({ enters: 1, leaves: 0 });
    ui.click(...at(150, 50));
    expect(ui.state).toMatchObject({ n: 1, enters: 1, leaves: 0 });
    ui.leave();
    expect(ui.state).toMatchObject({ enters: 1, leaves: 1 });
    ui.destroy();
  });

  it("works on use, with the drawing's own shapes", () => {
    const ui = render(`state hov=''\nscene "S" w=200 h=100\n  define "dot"\n    circle x=0 y=0 r=20 fill=accent\n  use "dot" x=100 y=50 on-hover=set:hov:'dot' on-leave="set:hov:''"`, { components: ON, width: 240 });
    const at = sceneAt(ui, 200, 100);
    ui.hover(...at(100, 50));
    expect(ui.state.hov).toBe("dot");
    ui.leave();
    expect(ui.state.hov).toBe("");
    ui.destroy();
  });

  it("runs on-leave when the hovered shape stops being drawn", () => {
    const ui = render(`state hov=''\nstate gone=false\nscene "S" w=100 h=100\n  circle x=50 y=50 r=30 fill=accent if={!gone} on-hover=set:hov:'a' on-leave="set:hov:''"`, { components: ON, width: 240 });
    const at = sceneAt(ui, 100, 100);
    ui.hover(...at(50, 50));
    expect(ui.state.hov).toBe("a");
    ui.set("gone", true);
    expect(ui.state.hov).toBe("");
    // Back under a resting pointer: nothing is entered until it moves.
    ui.set("gone", false);
    expect(ui.state.hov).toBe("");
    ui.hover(...at(52, 50));
    expect(ui.state.hov).toBe("a");
    ui.destroy();
  });

  it("runs on-leave when a spec edit removes the scene", () => {
    const ui = render(`state hov=''\nscene "S" w=100 h=100\n  circle x=50 y=50 r=30 fill=accent on-hover=set:hov:'a' on-leave="set:hov:''"`, { components: ON, width: 240 });
    ui.hover(...sceneAt(ui, 100, 100)(50, 50));
    expect(ui.state.hov).toBe("a");
    ui.setSpec(`state hov=''\ntext "No picture"`);
    expect(ui.state.hov).toBe("");
    ui.destroy();
  });
});

describe("a shape that's only hovered", () => {
  const SPEC = `state hov=''
state sel=''
scene "Map" w=300 h=100
  circle x=50 y=50 r=30 fill=accent on=set:sel:'a' name="Alpha" tip="First"
  circle x=150 y=50 r=30 fill=warn on-hover=set:hov:'b' tip="Only hovered"
  circle x=250 y=50 r=30 fill=good on=set:sel:'c' on-hover=set:hov:'c' name="Gamma"`;

  it("isn't a Tab stop or a screen-reader button, and isn't grown", () => {
    const ui = render(SPEC, { components: ON, width: 340 });
    const hits = sceneHits(ui);
    expect(hits.filter((h) => h.focusable).length).toBe(2);
    const only = hits.find((h) => !h.focusable)!;
    expect(only.box.w).toBeCloseTo(60, 0);
    const tree = JSON.stringify(ui.accessibility({ full: true }));
    expect(tree).toMatch(/"role":"button","name":"Alpha","description":"First"/);
    expect(tree).toMatch(/"role":"button","name":"Gamma"/);
    const figure = (ui.accessibility({ full: true }).children ?? [])[0]!;
    expect(figure.children.map((c) => c.name)).toEqual(["Alpha", "Gamma"]);
    const seen: string[] = [];
    for (let i = 0; i < 2; i++) { ui.tab(); ui.key("Enter"); seen.push(String(ui.state.sel)); }
    expect(seen).toEqual(["a", "c"]);
    expect(ui.state.hov).toBe("");
    ui.destroy();
  });

  it("shows its tip but no outline, with an arrow pointer", () => {
    const ui = render(SPEC, { components: ON, width: 340 });
    const at = sceneAt(ui, 300, 100);
    const strokes = () => ui.drawOps.filter((o) => o.op === "stroke").length;
    const before = strokes();
    ui.hover(...at(150, 50));
    expect(ui.state.hov).toBe("b");
    expect(strokes()).toBe(before);
    expect(ui.text()).toContain("Only hovered");
    expect(ui.canvas.style.cursor).toBe("default");
    // A pressable shape still gets its hover outline and a hand.
    ui.hover(...at(50, 50));
    expect(strokes()).toBeGreaterThan(before);
    expect(ui.text()).toContain("First");
    expect(ui.canvas.style.cursor).toBe("pointer");
    ui.destroy();
  });

  it("isn't held to tap sizes or overlaps by the drawing check", () => {
    const check = (attrs: string) => reviewScenes(parse(`state hov=''\nscene "S" w=600 h=300\n  circle x=100 y=100 r=4 fill=ink ${attrs}\n  circle x=102 y=100 r=4 fill=ink ${attrs}`, on)).map((d) => d.message);
    expect(check("on-hover=set:hov:'x'").filter((m) => /too small to tap|on top of/.test(m))).toEqual([]);
    expect(check("on=set:hov:'x'").filter((m) => /too small to tap|on top of/.test(m)).length).toBeGreaterThan(0);
  });
});

describe("the engine's hover hook", () => {
  const spy = vi.fn();
  const scene = sceneComponents.find((c) => c.type === "scene")!;
  const watched: ComponentDef[] = [...coreComponents, ...sceneComponents.map((c) => (c === scene ? { ...c, hover: (ctx, from, to) => { spy(from, to); scene.hover!(ctx, from, to); } } satisfies ComponentDef : c))];
  const SPEC = `state hov=''\nscene "S" w=200 h=100\n  circle x=50 y=50 r=30 fill=accent on-hover=set:hov:'a'\n  circle x=150 y=50 r=30 fill=accent on-hover=set:hov:'b'`;

  it("isn't called for a finger's moves, but is for a pen's", () => {
    spy.mockClear();
    const ui = render(SPEC, { components: watched, width: 240 });
    const [x, y] = sceneAt(ui, 200, 100)(50, 50);
    ui.canvas.dispatch("pointermove", { clientX: x, clientY: y, pointerId: 1, pointerType: "touch" });
    ui.sayshape.renderNow();
    expect(spy).not.toHaveBeenCalled();
    ui.canvas.dispatch("pointermove", { clientX: x, clientY: y, pointerId: 1, pointerType: "pen" });
    ui.sayshape.renderNow();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ui.state.hov).toBe("a");
    ui.destroy();
  });

  it("is told both parts within one element, once per change", () => {
    spy.mockClear();
    const ui = render(SPEC, { components: watched, width: 240 });
    const at = sceneAt(ui, 200, 100);
    ui.hover(...at(50, 50));
    ui.hover(...at(52, 50));
    ui.hover(...at(150, 50));
    ui.leave();
    const [a, b] = sceneHits(ui).map((h) => h.detail);
    expect(spy.mock.calls).toEqual([[undefined, a], [a, b], [b, undefined]]);
    ui.destroy();
  });
});

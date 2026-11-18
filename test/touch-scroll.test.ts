import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { render, type Rendered } from "../src/testing";

/**
 * Touch swipes over an interface on a phone: which axis a gesture is, who gets it (an element
 * inside or the page), and that the page always gets vertical swipes nothing inside can use.
 * `prevented` is whether the engine called preventDefault, which is what stops the page scrolling.
 */
type Point = [number, number];

function swipe(ui: Rendered, path: Point[]): boolean[] {
  const [first, ...rest] = path;
  const ev = ([x, y]: Point) => ({ touches: [{ clientX: x, clientY: y }], cancelable: true });
  ui.canvas.dispatch("touchstart", ev(first!));
  const prevented = rest.map((p) => { const r = ui.canvas.dispatch("touchmove", ev(p)); ui.sayshape.renderNow(); return r; });
  ui.canvas.dispatch("touchend", { touches: [] });
  return prevented;
}
const steps = ([x, y]: Point, dx: number, dy: number, n = 6): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => [x + (dx * i) / n, y + (dy * i) / n]);

const teams = Array.from({ length: 6 }, (_, i) => `{id: ${i}, team: "Team ${i}", p: ${i}, w: ${i}, d: ${i}, l: ${i}, gf: ${i}, ga: ${i}, gd: ${i}, pts: ${i}}`);
const stats = ["p", "w", "d", "l", "gf", "ga", "gd", "pts"];
const wideTable = () =>
  render(`state rows=[${teams.join(", ")}]\ntable items=rows\n  table-column "Team" field=team\n${stats.map((k) => `  table-column "${k.toUpperCase()} long" field=${k} format=number`).join("\n")}\n`, { width: 360 });
const tableOffset = (ui: Rendered) => ui.sayshape.viewState(ui.find("table").node.id)?.x ?? 0;
const mid = (ui: Rendered, type: string): Point => { const b = ui.find(type).box!; return [b.x + b.w / 2, b.y + b.h / 2]; };

describe("touch swipes", () => {
  it("leave a vertical swipe over a sideways-scrolling table to the page", () => {
    const ui = wideTable();
    expect(swipe(ui, steps(mid(ui, "table"), 0, -120))).not.toContain(true);
    expect(swipe(ui, steps(mid(ui, "table"), 0, 120))).not.toContain(true);
    expect(tableOffset(ui)).toBe(0);
  });

  it.each([
    ["table", `state rows=[{id: "a", name: "Laptop"}, {id: "b", name: "Monitor"}] pick=""\ntable items=rows key=id bind=pick\n  table-column "Name" field=name\n`, "pick"],
    ["tree", `state items=[{id: "a", name: "Root"}, {id: "b", name: "Leaf", parent: "a"}] pick=""\ntree items=items bind=pick\n`, "pick"],
  ])("press nothing on a %s when the page takes the swipe (pointercancel)", (type, spec, name) => {
    const ui = render(spec, { width: 360 });
    const [x, y] = mid(ui, type);
    ui.canvas.dispatch("pointermove", { clientX: x, clientY: y, pointerId: 1, pointerType: "touch" });
    ui.canvas.dispatch("pointerdown", { clientX: x, clientY: y, pointerId: 1, pointerType: "touch" });
    swipe(ui, steps([x, y], 0, -80));
    ui.canvas.dispatch("pointercancel", { pointerId: 1 });
    ui.sayshape.renderNow();
    expect(ui.state[name]).toBe("");
  });

  it("give a sideways swipe over the table to the table, even where words take the touch", () => {
    const ui = wideTable();
    const prevented = swipe(ui, steps(mid(ui, "table"), -120, 0));
    expect(prevented.at(-1)).toBe(true);
    expect(tableOffset(ui)).toBeGreaterThan(60);
  });

  it("lock the axis on the first few pixels: a mostly sideways start never scrolls the page later", () => {
    const ui = wideTable();
    const [x, y] = mid(ui, "table");
    swipe(ui, [[x, y], [x - 8, y + 2], [x - 20, y + 40], [x - 30, y + 90]]);
    const after = tableOffset(ui);
    expect(after).toBeGreaterThan(0);
    // Locked to sideways: the vertical part moved nothing and only the sideways part counted.
    expect(after).toBeCloseTo(30, 0);
  });

  it("never zoom a map on a one-finger vertical swipe", () => {
    const ui = render(`map\n  pin "Phoenix" lat=33.4484 lon=-112.074\n`, { width: 360, components: [...coreComponents, ...mapComponents] });
    const view = () => JSON.stringify((ui.find("map").box!.data as unknown as { runtime: { view: unknown } }).runtime.view);
    const before = view();
    expect(swipe(ui, steps(mid(ui, "map"), 0, -120))).not.toContain(true);
    expect(view()).toBe(before);
  });

  it("let an inner scrolling element take a swipe it can use, and hand off to the page at its edge", () => {
    const ui = render(`scroll size=sm\n${Array.from({ length: 60 }, (_, i) => `  text "Line ${i}"`).join("\n")}\ntext "After"\n`, { width: 360 });
    const y = () => ui.sayshape.viewState(ui.find("scroll").node.id)?.y ?? 0;
    const [cx, cy] = mid(ui, "scroll");
    // At the top, pulling down (scrolling up) can't move it: the page has it.
    expect(swipe(ui, steps([cx, cy], 0, 80))).not.toContain(true);
    expect(y()).toBe(0);
    // Pushing up scrolls it, and the gesture is its own.
    expect(swipe(ui, steps([cx, cy], 0, -80)).at(-1)).toBe(true);
    expect(y()).toBeGreaterThan(40);
    // Scrolled to the end, a further push up goes to the page from the start.
    swipe(ui, steps([cx, cy], 0, -5000, 10));
    const end = y();
    expect(swipe(ui, steps([cx, cy], 0, -80))).not.toContain(true);
    expect(y()).toBe(end);
  });

  it("scroll an inner region by the finger once, when pointer and touch events both arrive (as on phones)", () => {
    const ui = render(`scroll size=sm\n${Array.from({ length: 60 }, (_, i) => `  text "Line ${i}"`).join("\n")}\n`, { width: 360 });
    const y = () => ui.sayshape.viewState(ui.find("scroll").node.id)?.y ?? 0;
    const [cx, cy] = mid(ui, "scroll");
    const p = (type: string, py: number) => ui.canvas.dispatch(type, { clientX: cx, clientY: py, pointerId: 1, pointerType: "touch" });
    const t = (type: string, py: number) => ui.canvas.dispatch(type, { touches: type === "touchend" ? [] : [{ clientX: cx, clientY: py }], cancelable: true });
    p("pointermove", cy); p("pointerdown", cy); t("touchstart", cy);
    let prevented = false;
    for (const py of [cy - 10, cy - 30, cy - 60]) { p("pointermove", py); prevented = t("touchmove", py) || prevented; ui.sayshape.renderNow(); }
    p("pointerup", cy - 60); t("touchend", cy - 60); ui.sayshape.renderNow();
    expect(prevented).toBe(true);
    expect(y()).toBeCloseTo(60, 0);
  });

  it("never start taking a gesture the page already has", () => {
    const ui = render(`text "Above"\nscroll size=sm\n${Array.from({ length: 60 }, (_, i) => `  text "Line ${i}"`).join("\n")}\n`, { width: 360 });
    const [cx, cy] = mid(ui, "scroll");
    // Starts pulling down at the top (the page's), then reverses: still the page's.
    const prevented = swipe(ui, [[cx, cy], [cx, cy + 20], [cx, cy + 10], [cx, cy - 40], [cx, cy - 90]]);
    expect(prevented).not.toContain(true);
  });
});

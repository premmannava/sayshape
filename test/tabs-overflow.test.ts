import { describe, expect, it } from "vitest";
import { render, type Rendered } from "../src/testing";

/** Tabs on a phone: more tabs than fit at 390 px. */
const LABELS = ["Day 1 arrival", "Day 2 hiking", "Day 3 lakes", "Day 4 summit", "Overview", "Packing list"];
const spec = (selected = "d0") => `state view=${selected}
tabs bind=view
${LABELS.map((l, i) => `  tab "${l}" value=d${i}\n    text "Plan for ${l}"`).join("\n")}
`;
type Cell = { label: string; x: number; w: number };
type Data = { cells: Cell[]; scroll?: { max: number } };
const data = (ui: Rendered) => ui.find("tabs").box!.data as unknown as Data;
const offset = (ui: Rendered) => ui.sayshape.viewState(ui.find("tabs").node.id)?.x ?? 0;
const labelsDrawn = (ui: Rendered) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));
/** Where a tab is on screen now, after scrolling. */
const onScreen = (ui: Rendered, label: string) => { const c = data(ui).cells.find((x) => x.label === label)!; return { x: c.x - offset(ui), w: c.w }; };

describe("tabs that don't fit", () => {
  it("keep every label whole and scroll sideways instead of cutting to a stub", () => {
    const ui = render(spec(), { width: 390 });
    expect(data(ui).scroll?.max).toBeGreaterThan(0);
    const drawn = labelsDrawn(ui);
    for (const l of LABELS.slice(0, 3)) expect(drawn).toContain(l);
    expect(drawn.join("|")).not.toContain("…");
    expect(ui.warnings).toEqual([]);
  });

  it("scroll the selected tab into view, also when it's chosen from state", () => {
    const ui = render(spec("d5"), { width: 390 });
    const box = ui.find("tabs").box!;
    const at = onScreen(ui, "Packing list");
    expect(at.x).toBeGreaterThanOrEqual(box.x - 0.5);
    expect(at.x + at.w).toBeLessThanOrEqual(box.x + box.w + 0.5);
    ui.set("view", "d0");
    expect(onScreen(ui, "Day 1 arrival").x).toBeGreaterThanOrEqual(box.x - 0.5);
  });

  it("scroll with the wheel sideways and with a finger swipe, and press only tabs in sight", () => {
    const ui = render(spec(), { width: 390 });
    const box = ui.find("tabs").box!;
    ui.wheel(box.x + 100, box.y + 20, 0, { deltaX: 60 });
    expect(offset(ui)).toBe(60);
    const ev = (x: number) => ({ touches: [{ clientX: x, clientY: box.y + 20 }], cancelable: true });
    ui.canvas.dispatch("touchstart", ev(300));
    for (const x of [290, 260, 220]) { ui.canvas.dispatch("touchmove", ev(x)); ui.sayshape.renderNow(); }
    ui.canvas.dispatch("touchend", { touches: [] });
    expect(offset(ui)).toBeCloseTo(140, 0);
    // Hit regions stay inside the strip.
    for (const h of ui.hits.filter((h) => h.box.node.type === "tabs")) {
      expect(h.box.x).toBeGreaterThanOrEqual(box.x - 0.5);
      expect(h.box.x + h.box.w).toBeLessThanOrEqual(box.x + box.w + 0.5);
    }
  });

  it("fade the edge where more tabs are, and not where there are none", () => {
    const ui = render(spec(), { width: 390 });
    const fades = () => ui.drawOps.filter((o) => o.op === "fillText" && o.gradientStops?.length);
    expect(fades().length).toBeGreaterThan(0);
    const fits = render(`state view=a\ntabs bind=view\n  tab "A" value=a\n  tab "B" value=b\n`, { width: 390 });
    expect(fits.drawOps.some((o) => o.gradientStops?.length)).toBe(false);
    expect((fits.find("tabs").box!.data as unknown as Data).scroll).toBeUndefined();
  });

  it("bring a tab the keyboard reaches into view, and select it with Enter", () => {
    const ui = render(spec(), { width: 390 });
    const box = ui.find("tabs").box!;
    for (let i = 0; i < 6; i++) ui.tab();
    expect((ui.sayshape.focus as { detail?: unknown } | null)?.detail).toBe("d5");
    ui.sayshape.renderNow();
    const at = onScreen(ui, "Packing list");
    expect(at.x + at.w).toBeLessThanOrEqual(box.x + box.w + 0.5);
    ui.key("Enter");
    expect(ui.state.view).toBe("d5");
    expect(JSON.stringify(ui.accessibility({ full: true }))).toMatch(/"role":"tab","name":"Packing list"[^}]*"selected":true/);
  });
});

import { describe, expect, it } from "vitest";
import { coreComponents } from "../../src/components";
import type { ChartGeometry } from "../../src/components/chart";
import { MAX_SCATTER_GROUPS, type ScatterGeometry } from "../../src/components/chart-kinds";
import { relation } from "../../src/components/chart-a11y";
import { parse } from "../../src/parser";
import { languageGuide } from "../../src/prompt";
import { Registry } from "../../src/registry";
import { render } from "../../src/testing";

const registry = new Registry(coreComponents);
const msgs = (spec: string) => parse(spec + "\n", registry).diagnostics.map((d) => d.message);
const FUNDS = `state funds=[{name: "Bond", risk: 3, ret: 3.4, assets: 800, type: "Bonds"}, {name: "Balanced", risk: 8, ret: 6.1, assets: 1200, type: "Mixed"}, {name: "Growth", risk: 14, ret: 9.8, assets: 2100, type: "Stocks"}, {name: "Small", risk: 20, ret: 11.2, assets: 450, type: "Stocks"}, {name: "Tech", risk: 25, ret: 13.5, assets: 700, type: "Stocks"}, {name: "Odd", risk: "n/a", ret: 2}]
chart "Funds" kind=scatter items=funds x=risk y=ret label=name size=assets group=type labels="Risk,Return" format=percent
`;
const geo = (spec: string, width = 600) => render(spec, { width }).find("chart").box!.data as ChartGeometry;
const dots = (d: ChartGeometry) => (d.custom as ScatterGeometry).dots;

describe("chart kind=scatter", () => {
  it("is in the guide as the pick for how two numbers relate", () => {
    expect(languageGuide(registry)).toContain("chart kind=scatter x=risk y=return label=name");
  });

  it("puts each dot at its x and y numbers, on number scales, in x order", () => {
    const d = geo(FUNDS);
    expect(d.slots.map((s) => s.label)).toEqual(["Bond", "Balanced", "Growth", "Small", "Tech"]);
    const xs = dots(d).map((p) => p.x), ys = dots(d).map((p) => p.y);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    // Higher return is higher up.
    expect(ys[3]!).toBeLessThan(ys[0]!);
    // Spacing follows the numbers, not the list: 3→8 is shorter than 8→14.
    expect(xs[1]! - xs[0]!).toBeLessThan(xs[2]! - xs[1]!);
    for (const p of dots(d)) {
      expect(p.x - p.r).toBeGreaterThanOrEqual(d.plot.x - 0.5);
      expect(p.x + p.r).toBeLessThanOrEqual(d.plot.x + d.plot.w + 0.5);
      expect(p.y - p.r).toBeGreaterThanOrEqual(d.plot.y - 0.5);
      expect(p.y + p.r).toBeLessThanOrEqual(d.plot.y + d.plot.h + 0.5);
    }
  });

  it("sizes dots by size= (area) and colors them by group= with a legend", () => {
    const d = geo(FUNDS);
    const r = Object.fromEntries(d.slots.map((s, i) => [s.label, dots(d)[i]!.r]));
    expect(r.Growth!).toBeGreaterThan(r.Balanced!);
    expect(r.Balanced!).toBeGreaterThan(r.Small!);
    expect(new Set(dots(d).map((p) => p.color))).toEqual(new Set([0, 1, 2]));
    expect(d.legend.map((l) => l.label)).toEqual(["Bonds", "Mixed", "Stocks"]);
  });

  it("skips items without both numbers, with a warning", () => {
    const ui = render(FUNDS, { width: 600 });
    expect(ui.warnings.join(" ")).toContain("1 of 6 items have no number in risk or ret");
  });

  it("warns about scatter props on other kinds, and about axis names", () => {
    expect(msgs(`state s=[]\nchart kind=bar items=s x=a y=b size=c`).some((m) => m.includes("size= is for kind=scatter"))).toBe(true);
    expect(msgs(`state s=[]\nchart kind=scatter items=s x=a y=b labels="One"`).some((m) => m.includes("two axes"))).toBe(true);
    expect(msgs(`state s=[]\nchart kind=scatter items=s x=a y=b labels="A,B"`)).toEqual([]);
  });

  it("says so instead of drawing more groups than colors", () => {
    const many = Array.from({ length: MAX_SCATTER_GROUPS + 1 }, (_, i) => `{x: ${i}, y: ${i}, g: "G${i}"}`).join(", ");
    expect(geo(`state s=[${many}]\nchart kind=scatter items=s x=x y=y group=g\n`).message).toContain("Too many groups");
  });

  it("takes keyboard focus, shows the focused dot's tip, and the arrow keys move from dot to dot", () => {
    const ui = render(FUNDS, { width: 600 });
    ui.tab();
    expect(ui.focused?.type).toBe("chart");
    expect(ui.text()).toContain("Bond");
    expect(ui.text()).toContain("Risk: 3");
    ui.key("ArrowRight");
    ui.key("ArrowRight");
    expect(ui.text()).toContain("Growth");
    expect(ui.text()).toContain("Return: 9.8%");
    ui.key("End");
    ui.key("ArrowRight");
    expect(ui.text()).toContain("Tech");
    ui.key("Home");
    expect(ui.text()).toContain("Risk: 3");
  });

  it("finds the nearest dot under the pointer", async () => {
    const { chartHoverAt } = await import("../../src/components/chart");
    const d = geo(FUNDS);
    const p = dots(d)[2]!;
    expect(chartHoverAt(d, p.x + 2, p.y - 2)).toEqual({ kind: "slot", index: 2 });
    expect(chartHoverAt(d, d.plot.x + 1, d.plot.y + 1)).toBeNull();
  });

  it("is never a Tab stop for other kinds", () => {
    const ui = render(`state s=[{m: "a", v: 1}]\nchart kind=bar items=s x=m y=v\n`);
    ui.tab();
    expect(ui.focused).toBeNull();
  });

  it("is a figure with a summary of how the numbers relate, and the data as a table", () => {
    const ui = render(FUNDS, { width: 600 });
    type N = { role: string; description?: string; children: N[] };
    const find = (n: N): N | undefined => (n.role === "figure" ? n : n.children.map(find).find(Boolean));
    const fig = find(ui.accessibility({ full: true }) as unknown as N)!;
    expect(fig.description).toBe("5 dots. Risk from 3 to 25; Return from 3.4% to 13.5%. Return mostly rises as Risk rises.");
    const lines = ui.copyText().split("\n");
    expect(lines).toContain("name\tRisk\tReturn\tassets\ttype");
    expect(lines).toContain("Growth\t14\t9.8%\t2,100\tStocks");
  });

  it("describes the relation in words, or nothing when there's too little to say", () => {
    const up = [1, 2, 3, 4, 5].map((x) => ({ x, y: x * 2 }));
    expect(relation(up, "x", "y")).toBe("y mostly rises as x rises.");
    expect(relation(up.map((p) => ({ x: p.x, y: -p.y })), "x", "y")).toBe("y mostly falls as x rises.");
    expect(relation(up.slice(0, 4), "x", "y")).toBe("");
    expect(relation([{ x: 1, y: 1 }, { x: 2, y: -1 }, { x: 3, y: 0 }, { x: 4, y: -1 }, { x: 5, y: 1 }], "x", "y")).toContain("No clear pattern");
    expect(relation([{ x: -1e308, y: 1e308 }, { x: 1e308, y: -1e308 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], "x", "y")).toBe("");
  });

  it("lays out inside its box at every width, and never throws on odd data", () => {
    for (const width of [240, 360, 600, 1024]) {
      const ui = render(FUNDS, { width });
      const b = ui.find("chart").box!;
      expect(b.w).toBeLessThanOrEqual(width);
      const d = b.data as ChartGeometry;
      if (!d.message) for (const p of dots(d)) expect(p.x + p.r).toBeLessThanOrEqual(b.w + 0.5);
    }
    for (const odd of [`items=5`, `items={[1, 2]}`, `items={[{x: 1, y: 1}]}`, `items={[{x: 1, y: 1}, {x: 1, y: 1}]}`, `items={[{x: -1e308, y: 1e308}, {x: 1e308, y: -1e308}]}`]) {
      expect(() => render(`chart kind=scatter x=x y=y ${odd}\n`, { width: 360 })).not.toThrow();
    }
    const lines = FUNDS.trim().split("\n");
    for (let i = 1; i <= lines.length; i++) expect(render(lines.slice(0, i).join("\n") + "\n").diagnostics).toEqual([]);
  });
});

describe("chart kind=scatter, after review", () => {
  it("moves keyboard focus to each dot, named by its numbers, as options in a list", () => {
    const ui = render(FUNDS, { width: 600 });
    ui.tab();
    ui.key("ArrowRight");
    const json = JSON.stringify(ui.accessibility());
    expect(json).toContain('"role":"listbox"');
    expect(json).toContain('"name":"Balanced: Risk: 8, Return: 6.1%, assets: 1,200, type: Mixed"');
    expect(ui.mirror.focused).toContain("dot:1");
    // Only one dot is a Tab stop.
    ui.tab();
    expect(ui.focused).toBeNull();
  });

  it("gives each group its own shape as well as its color", async () => {
    const { shapeOf } = await import("../../src/components/chart-kinds/scatter");
    const d = geo(FUNDS);
    expect(new Set(dots(d).map((p) => shapeOf(p.color))).size).toBe(3);
  });

  it("keeps a size of 0 or below in the tip and warns about negatives", () => {
    const ui = render(`state s=[{n: "a", x: 1, y: 1, z: 0}, {n: "b", x: 2, y: 2, z: -5}, {n: "c", x: 3, y: 3, z: 10}]\nchart kind=scatter items=s x=x y=y label=n size=z\n`, { width: 600 });
    const d = ui.find("chart").box!.data as ChartGeometry;
    expect(d.slots[1]!.notes).toContain("z: -5");
    expect(ui.warnings.join(" ")).toContain("size below 0");
  });

  it("says how many more dots share a spot, and handles one dot or a constant axis", () => {
    const d = geo(`state s=[{x: 1, y: 1}, {x: 1, y: 1}, {x: 2, y: 1}]\nchart kind=scatter items=s x=x y=y\n`);
    expect(d.slots[0]!.notes).toContain("and 1 more here");
    const ui = render(`state s=[{x: 5, y: 2}]\nchart kind=scatter items=s x=x y=y\n`, { width: 600 });
    expect(ui.copyText()).toContain("1 dot. x is 5; y is 2.");
  });

  it("stays finite with numbers near the largest doubles", () => {
    const ui = render(`chart kind=scatter items=s x=x y=y\n`, { width: 600 });
    ui.set("s", [{ x: -1e308, y: 1e308 }, { x: 1e308, y: -1e308 }]);
    const d = ui.find("chart").box!.data as ChartGeometry;
    for (const p of dots(d)) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); }
  });

  it("points a one-word labels= at label=", () => {
    expect(msgs(`state s=[]\nchart kind=scatter items=s x=a y=b labels=name`).join(" ")).toContain("use label=name");
  });
});

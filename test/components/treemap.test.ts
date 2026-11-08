import { describe, expect, it } from "vitest";
import { coreComponents } from "../../src/components";
import type { ChartGeometry } from "../../src/components/chart";
import { MAX_TREEMAP_ITEMS, squarify, type TreemapGeometry } from "../../src/components/chart-kinds";
import { parse } from "../../src/parser";
import { languageGuide } from "../../src/prompt";
import { Registry } from "../../src/registry";
import { render } from "../../src/testing";

const registry = new Registry(coreComponents);
const msgs = (spec: string) => parse(spec + "\n", registry).diagnostics.map((d) => d.message);
const COSTS = `state costs=[{item: "Rent", amount: 360}, {item: "Salaries", amount: 1840}, {item: "Hosting", amount: 290}, {item: "Travel", amount: 88}, {item: "Fees", amount: 9}, {item: "Nothing", amount: 0}, {item: "Unknown"}]
chart "Costs" kind=treemap items=costs x=item y=amount format=money
`;
const geo = (spec: string, width = 600) => render(spec, { width }).find("chart").box!.data as ChartGeometry;
const cells = (d: ChartGeometry) => (d.custom as TreemapGeometry).cells;

describe("squarify", () => {
  it("fills the area exactly, each rect's area in proportion to its value", () => {
    const values = [6, 6, 4, 3, 2, 2, 1];
    const area = { x: 0, y: 0, w: 600, h: 400 };
    const rects = squarify(values, area);
    const total = values.reduce((a, v) => a + v, 0);
    rects.forEach((r, i) => expect(r.w * r.h).toBeCloseTo((values[i]! / total) * 600 * 400, 3));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(600 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(400 + 1e-6);
    }
    // No two overlap.
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!, b = rects[j]!;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      expect(ox > 1e-6 && oy > 1e-6).toBe(false);
    }
  });

  it("keeps rectangles close to square for the textbook values", () => {
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, y: 0, w: 6, h: 4 });
    const worst = Math.max(...rects.map((r) => Math.max(r.w / r.h, r.h / r.w)));
    expect(worst).toBeLessThan(3);
  });

  it("never throws or makes NaN on nothing to lay out", () => {
    expect(squarify([], { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    for (const r of squarify([1, 2], { x: 0, y: 0, w: 0, h: 10 })) expect(r.w).toBe(0);
  });
});

describe("chart kind=treemap", () => {
  it("is in the guide as the pick for parts of a total with too many for a pie", () => {
    expect(languageGuide(registry)).toContain("parts of a total when there are too many for a pie");
    expect(msgs(`state s=[]\nchart kind=treemap items=s x=a y=b,c`).some((m) => m.includes("one field"))).toBe(true);
  });

  it("draws one rectangle per item above 0, biggest first, darker for more, and warns about the rest", () => {
    const ui = render(COSTS, { width: 600 });
    const d = ui.find("chart").box!.data as ChartGeometry;
    expect(cells(d).map((c) => c.label)).toEqual(["Salaries", "Rent", "Hosting", "Travel", "Fees"]);
    expect(cells(d)[0]!.shade).toBe(1);
    expect(cells(d)[4]!.shade).toBe(0);
    expect(ui.warnings.join(" ")).toContain("2 of 7 items have no number above 0");
  });

  it("writes names and values where they fit, and nothing where they don't", () => {
    const c = cells(geo(COSTS));
    expect(c[0]!.lines).toEqual(["Salaries", "$1,840"]);
    expect(c[4]!.lines.length).toBeLessThanOrEqual(1);
  });

  it("sums the smallest into Other past MAX_TREEMAP_ITEMS, keeping the total", () => {
    const many = Array.from({ length: MAX_TREEMAP_ITEMS + 10 }, (_, i) => `{n: "i${i}", v: ${i + 1}}`).join(", ");
    const ui = render(`state s=[${many}]\nchart kind=treemap items=s x=n y=v\n`, { width: 600 });
    const c = cells(ui.find("chart").box!.data as ChartGeometry);
    expect(c.length).toBe(MAX_TREEMAP_ITEMS);
    const total = c.reduce((a, x) => a + x.value, 0);
    expect(total).toBe(((MAX_TREEMAP_ITEMS + 10) * (MAX_TREEMAP_ITEMS + 11)) / 2);
    expect(c.find((x) => x.other)!.label).toBe("11 others");
    expect(ui.warnings.join(" ")).toContain("drawn together as one rectangle");
  });

  it("shows a message for negative values", () => {
    expect(geo(`state s=[{n: "a", v: 5}, {n: "b", v: -2}]\nchart kind=treemap items=s x=n y=v\n`).message).toContain("negative");
  });

  it("gives each part a tip with its share, and a summary and table to screen readers and Copy text", () => {
    const d = geo(COSTS);
    expect(d.slots[0]!.notes![0]).toContain("of the total");
    const text = render(COSTS, { width: 600 }).copyText();
    expect(text).toContain("5 parts, total $2,587. Largest: Salaries, $1,840 (71%); Rent, $360 (14%); Hosting, $290 (11%).");
    expect(text).toContain("Salaries\t$1,840");
  });

  it("lays out inside its box at every width and never throws on odd data", () => {
    for (const width of [240, 360, 600, 1024]) {
      const ui = render(COSTS, { width });
      const b = ui.find("chart").box!;
      for (const c of cells(b.data as ChartGeometry)) {
        expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(b.w + 0.01);
        expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(b.h + 0.01);
      }
    }
    for (const odd of [`items=5`, `items={[1, 2]}`, `items={[{n: "a", v: 1}]}`, `items={[{n: "a", v: 1e300}, {n: "b", v: 1e-300}]}`]) {
      expect(() => render(`chart kind=treemap x=n y=v ${odd}\n`, { width: 360 })).not.toThrow();
    }
    const lines = COSTS.trim().split("\n");
    for (let i = 1; i <= lines.length; i++) expect(render(lines.slice(0, i).join("\n") + "\n").diagnostics).toEqual([]);
  });
});

describe("chart kind=treemap, after review", () => {
  it("keeps repeated labels apart, and the folded rectangle from a real item called Other", () => {
    const d = geo(`state s=[{n: "Misc", v: 9}, {n: "Misc", v: 1}, {n: "A", v: 5}]\nchart kind=treemap items=s x=n y=v\n`);
    const keys = cells(d).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the words on every shade at AA contrast, in light and dark", async () => {
    const { readableAlpha } = await import("../../src/components/chart-kinds/treemap");
    const { cellInk } = await import("../../src/components/chart-kinds/heatmap");
    const { lightTheme, darkTheme, mixColors, parseColor } = await import("../../src/theme");
    const lum = (hex: string) => { const c = parseColor(hex)!; const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    for (const theme of [lightTheme, darkTheme]) {
      for (let s = 0; s <= 1.0001; s += 0.05) {
        const a = readableAlpha(theme.colors, s);
        const ink = lum(cellInk(theme.colors, a));
        for (const under of [theme.colors.surface, theme.colors.raised]) {
          const bg = lum(mixColors(under, theme.colors.accent, a)!);
          expect((Math.max(ink, bg) + 0.05) / (Math.min(ink, bg) + 0.05)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("sets shades by the real items, not the folded rectangle", () => {
    const list = [...Array.from({ length: 59 }, (_, i) => `{n: "k${i}", v: ${100 - i}}`), ...Array.from({ length: 40 }, (_, i) => `{n: "s${i}", v: 20}`)].join(", ");
    const c = cells(geo(`state s=[${list}]\nchart kind=treemap items=s x=n y=v\n`));
    expect(c.find((x) => x.label === "k0")!.shade).toBe(1);
  });

  it("folds items too small to see, with a warning, instead of drawing nothing", () => {
    const list = ["{n: \"big\", v: 1000000}", ...Array.from({ length: 30 }, (_, i) => `{n: "t${i}", v: 1}`)].join(", ");
    const ui = render(`state s=[${list}]\nchart kind=treemap items=s x=n y=v\n`, { width: 600 });
    const c = cells(ui.find("chart").box!.data as ChartGeometry);
    for (const x of c.filter((y) => !y.other)) expect(Math.min(x.rect.w, x.rect.h) + 2).toBeGreaterThanOrEqual(6);
    expect(c.some((x) => x.other)).toBe(true);
    expect(ui.copyText()).toContain("drawn together as one");
  });

  it("never leaves a two-letter stub as a name", () => {
    for (const width of [240, 360, 600]) for (const c of cells(geo(COSTS, width))) {
      if (c.lines[0]) expect(c.lines[0].replace("…", "").length).toBeGreaterThanOrEqual(Math.min(4, c.label.length));
    }
  });

  it("says so when the values are too large to add up", () => {
    const ui = render(`chart kind=treemap items=s x=n y=v\n`, { width: 600 });
    ui.set("s", [{ n: "a", v: 1e308 }, { n: "b", v: 1e308 }]);
    expect((ui.find("chart").box!.data as ChartGeometry).message).toContain("too large");
  });
});

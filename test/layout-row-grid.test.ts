import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { layoutTree } from "../src/layout";
import { lightTheme } from "../src/theme";
import { MonoMeasurer } from "../src/text";
import { Store } from "../src/state";

const reg = new Registry(coreComponents);

function lay(src: string, width = 600) {
  const r = parse(src, reg, { rootProps: { pad: "20", gap: "14" } });
  expect(r.diagnostics).toEqual([]);
  const store = new Store();
  return layoutTree(r.root, width, reg, lightTheme, new MonoMeasurer(), store.scope).children[0]!;
}
const cards = (n: number) => Array.from({ length: n }, (_, i) => `  card\n    text "C${i}"`).join("\n");
/** Items per visual row, by y. */
const rowsOf = (kids: { y: number }[]) => {
  const counts = new Map<number, number>();
  for (const k of kids) counts.set(k.y, (counts.get(k.y) ?? 0) + 1);
  return [...counts.values()];
};

describe("grid balance and cols", () => {
  it("wraps four items two and two where three fit", () => {
    const g = lay(`grid min=140 gap=10\n${cards(4)}`, 500);
    expect(rowsOf(g.children)).toEqual([2, 2]);
  });
  it("spreads 7 as 3, 2, 2 and keeps 5 as 3, 2", () => {
    expect(rowsOf(lay(`grid min=140 gap=10\n${cards(7)}`, 500).children)).toEqual([3, 2, 2]);
    expect(rowsOf(lay(`grid min=140 gap=10\n${cards(5)}`, 500).children)).toEqual([3, 2]);
  });
  it("never adds rows: single column stays single, full rows stay full", () => {
    expect(rowsOf(lay(`grid min=200 gap=10\n${cards(3)}`, 375).children)).toEqual([1, 1, 1]);
    expect(rowsOf(lay(`grid min=140 gap=10\n${cards(6)}`, 500).children)).toEqual([3, 3]);
  });
  it("treats cols as a maximum that min still limits", () => {
    expect(rowsOf(lay(`grid cols=2 gap=10\n${cards(5)}`, 700).children)).toEqual([2, 2, 1]);
    expect(rowsOf(lay(`grid cols=4 min=200 gap=10\n${cards(4)}`, 700).children)).toEqual([2, 2]);
    // The default min (150) fits two columns in 375 (335 inside the padding), and only one in 320.
    expect(rowsOf(lay(`grid cols=2 gap=10\n${cards(4)}`, 375).children)).toEqual([2, 2]);
    expect(rowsOf(lay(`grid cols=2 gap=10\n${cards(4)}`, 320).children)).toEqual([1, 1, 1, 1]);
  });
});

describe("row fit and justify", () => {
  const btns = `  button "One"\n  button "Two"\n  badge "New"`;
  it("keeps today's layout by default", () => {
    const r = lay(`row gap=10\n${btns}`);
    expect(r.children[0]!.x).toBe(20);
  });
  it("hugs children with fit", () => {
    const r = lay(`row gap=10 fit=true\n  stat label="A" value=1\n${btns}`);
    const [stat, one, two] = r.children;
    expect(one!.w).toBeLessThan(120);
    expect(two!.x).toBeCloseTo(one!.x + one!.w + 10);
    expect(stat!.w).toBeGreaterThan(one!.w);
  });
  it("places hugging children with justify", () => {
    const start = lay(`row gap=10 justify=start\n${btns}`).children;
    const end = lay(`row gap=10 justify=end\n${btns}`).children;
    const between = lay(`row gap=10 justify=between\n${btns}`).children;
    expect(start[0]!.x).toBe(20);
    expect(end[2]!.x + end[2]!.w).toBeCloseTo(580);
    expect(between[0]!.x).toBe(20);
    expect(between[2]!.x + between[2]!.w).toBeCloseTo(580);
    expect(between[1]!.x).toBeGreaterThan(start[1]!.x);
  });
  it("still wraps children that don't fit", () => {
    const r = lay(`row gap=10 fit=true\n${btns}`, 140);
    expect(new Set(r.children.map((c) => c.y)).size).toBeGreaterThan(1);
  });
});

describe("through render() from sayshape/testing", () => {
  const cardBoxes = (spec: string, width: number) => {
    const ui = render(spec, { width });
    const out = ui.findAll({ type: "card" }).map((f) => f.box!);
    ui.destroy();
    return out;
  };
  it("lands four cards where three fit as two rows of two", () => {
    const b = cardBoxes(`grid min=140 gap=10\n${cards(4)}`, 500);
    expect(rowsOf(b)).toEqual([2, 2]);
  });
  it("caps columns with cols=2 for five cards", () => {
    const b = cardBoxes(`grid cols=2 gap=10\n${cards(5)}`, 700);
    expect(rowsOf(b)).toEqual([2, 2, 1]);
  });
  it("puts a justify=end row's last button on the row's right edge", () => {
    const ui = render(`row fit=true justify=end gap=10\n  button "One"\n  button "Two"\n`, { width: 600 });
    const [, two] = ui.findAll({ type: "button" }).map((f) => f.box!);
    const row = ui.find({ type: "row" }).box!;
    expect(two!.x + two!.w).toBeCloseTo(row.x + row.w);
    ui.destroy();
  });
});

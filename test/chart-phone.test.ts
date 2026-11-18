/**
 * kind=bar on a phone: narrower than BARS_ACROSS_WIDTH, a bar chart of
 * categories draws its bars across (as kind=hbar), and stays vertical when
 * that would read worse or can't be done: layers, items in time order, more
 * rows than MAX_HBAR_HEIGHT holds, or no room for bars beside their labels.
 */
import { describe, expect, it } from "vitest";
import { BARS_ACROSS_WIDTH, hbarRows, inTimeOrder, MAX_HBAR_HEIGHT, type ChartGeometry } from "../src/components/chart";
import { toData } from "../src/data";
import { render, type Rendered } from "../src/testing";
import { lightTheme } from "../src/theme";

const PHONE = 360, DESKTOP = 1000;
const geo = (ui: Rendered, i = 0): ChartGeometry => ui.findAll("chart")[i]!.box!.data as ChartGeometry;
const TEAMS = `state teams=[{name: "Sales", q1: 42000, q2: 51000}, {name: "Marketing", q1: 31000, q2: 28000}, {name: "Engineering", q1: 78000, q2: 83000}, {name: "Support", q1: 19000, q2: -4000}, {name: "Finance", q1: 23000, q2: 26000}]`;
const bars = (extra = "", y = "q1") => `${TEAMS}\nchart "Spend" kind=bar items=teams x=name y=${y}${extra}\n`;
const both = (spec: string) => [render(spec, { width: PHONE }), render(spec, { width: DESKTOP })] as const;

describe("kind=bar on a phone", () => {
  it("draws categories across when narrow and up when wide", () => {
    const [phone, desk] = both(bars());
    expect(phone.find("chart").box!.w).toBeLessThan(BARS_ACROSS_WIDTH);
    expect(geo(phone).kind).toBe("hbar");
    // One row per item, top to bottom in list order, each label at the left.
    const p = geo(phone);
    expect(p.slots.map((s) => s.shownLabel)).toEqual(["Sales", "Marketing", "Engineering", "Support", "Finance"]);
    expect(p.slots.every((s, i) => i === 0 || s.cy! > p.slots[i - 1]!.cy!)).toBe(true);
    expect(p.slots.every((s) => s.bar!.w > 0 && s.bar!.h < s.bar!.w)).toBe(true);
    expect(geo(desk).kind).toBe("bar");
    expect(geo(desk).slots.every((s) => s.bar!.h > 0 && s.bar!.x > 0)).toBe(true);
    for (const ui of [phone, desk]) { expect(ui.warnings).toEqual([]); ui.destroy(); }
  });

  it("switches at BARS_ACROSS_WIDTH, by the chart's own width", () => {
    const at = (w: number) => {
      const ui = render(bars(), { width: w, padding: 0 });
      const kind = geo(ui).kind;
      ui.destroy();
      return kind;
    };
    expect(at(BARS_ACROSS_WIDTH - 1)).toBe("hbar");
    expect(at(BARS_ACROSS_WIDTH)).toBe("bar");
    // Its box, not the screen: a narrow column on a wide screen turns across too.
    const ui = render(`${TEAMS}\nrow\n  chart kind=bar items=teams x=name y=q1\n  chart kind=bar items=teams x=name y=q2\n  chart kind=bar items=teams x=name y=q1`, { width: DESKTOP });
    expect(ui.findAll("chart")[0]!.box!.w).toBeLessThan(BARS_ACROSS_WIDTH);
    expect(geo(ui).kind).toBe("hbar");
    ui.destroy();
  });

  it("writes each value at the end of its bar, in its format", () => {
    const [phone, desk] = both(bars(" format=money"));
    const p = geo(phone);
    expect(p.slots.map((s) => s.valueLabels![0]!.text)).toEqual(["$42,000", "$31,000", "$78,000", "$19,000", "$23,000"]);
    expect(phone.text()).toEqual(expect.arrayContaining(["$42,000", "$78,000"]));
    // Vertical keeps its own money axis.
    expect(geo(desk).ticks.some((t) => t.label.startsWith("$"))).toBe(true);
    phone.destroy();
    desk.destroy();
  });

  it("keeps several series side by side in each row, with their legend", () => {
    const [phone, desk] = both(bars(` labels="Q1,Q2"`, "q1,q2"));
    const p = geo(phone);
    expect(p.kind).toBe("hbar");
    expect(p.slots.every((s) => s.bars!.length === 2)).toBe(true);
    expect(p.legend.map((l) => l.label)).toEqual(["Q1", "Q2"]);
    // The two bars of a row sit one under the other.
    const [a, b] = p.slots[0]!.bars!;
    expect(b!.y).toBeGreaterThan(a!.y);
    expect(geo(desk).kind).toBe("bar");
    phone.destroy();
    desk.destroy();
  });

  it("draws negative values left of the zero line", () => {
    const ui = render(bars("", "q2"), { width: PHONE });
    const g = geo(ui);
    expect(g.kind).toBe("hbar");
    const support = g.slots[3]!;
    expect(support.bar!.x + support.bar!.w).toBeCloseTo(g.zeroX!, 5);
    expect(support.valueLabels![0]).toMatchObject({ text: "-4,000", align: "right" });
    expect(g.slots[0]!.bar!.x).toBeCloseTo(g.zeroX!, 5);
    ui.destroy();
  });

  it("stays vertical with layers, which are drawn on vertical bars only", () => {
    for (const layer of [`  chart-rule "Target" y=40000`, `  chart-line "Q2" y=q2`, `  chart-note "Launch" at="Sales"`]) {
      const ui = render(bars(`\n${layer}`), { width: PHONE });
      expect(geo(ui).kind, layer).toBe("bar");
      expect(geo(ui).layers, layer).toBeDefined();
      expect(ui.warnings, layer).toEqual([]);
      ui.destroy();
    }
  });

  it("stays vertical rather than show the take() message for many items", () => {
    const rowH = hbarRows(lightTheme, 1).rowH;
    const n = Math.floor(MAX_HBAR_HEIGHT / rowH) + 1;
    const rows = `[${Array.from({ length: n }, (_, i) => `{k: "Item ${i + 1}", v: ${(i * 7) % 13 + 1}}`).join(", ")}]`;
    const ui = render(`state rows=${rows}\nchart kind=bar items=rows x=k y=v\n`, { width: PHONE });
    const g = geo(ui);
    expect(g.kind).toBe("bar");
    expect(g.message ?? "").not.toMatch(/take\(\)/);
    expect(ui.warnings.some((w) => /take\(\)/.test(w))).toBe(false);
    ui.destroy();
    // One fewer fits, so it turns across.
    const fits = `[${Array.from({ length: n - 1 }, (_, i) => `{k: "Item ${i + 1}", v: ${(i * 7) % 13 + 1}}`).join(", ")}]`;
    const ok = render(`state rows=${fits}\nchart kind=bar items=rows x=k y=v\n`, { width: PHONE });
    expect(geo(ok).kind).toBe("hbar");
    ok.destroy();
  });

  it("stays vertical, without a warning, when bars across wouldn't fit beside their labels and values", () => {
    const ui = render(`state rows=[{k: "A long category name", v: -123456789}, {k: "Another long category", v: 987654321}]\nchart kind=bar items=rows x=k y=v format=money\n`, { width: 240 });
    expect(geo(ui).kind).toBe("bar");
    expect(geo(ui).message).toBeUndefined();
    expect(ui.warnings.some((w) => /horizontal bars/.test(w))).toBe(false);
    ui.destroy();
  });

  it("keeps items in time order vertical, so they read left to right", () => {
    const series = [
      `[{k: "Jan", v: 1}, {k: "Feb", v: 3}, {k: "Mar", v: 2}]`,
      `[{k: "2024-01-01", v: 1}, {k: "2024-01-02", v: 3}, {k: "2024-01-03", v: 2}]`,
      `[{k: "Q1 2024", v: 1}, {k: "Q2 2024", v: 3}, {k: "Q3 2024", v: 2}]`,
      `[{k: "Mon", v: 1}, {k: "Tue", v: 3}, {k: "Wed", v: 2}]`,
      `[{k: 2021, v: 1}, {k: 2022, v: 3}, {k: 2023, v: 2}]`,
    ];
    for (const rows of series) {
      const ui = render(`state rows=${rows}\nchart kind=bar items=rows x=k y=v\n`, { width: PHONE });
      expect(geo(ui).kind, rows).toBe("bar");
      ui.destroy();
    }
  });

  it("tells time from categories", () => {
    const yes = (xs: unknown[]) => inTimeOrder(toData(xs.map((k) => ({ k }))), "k");
    expect(yes(["January", "February", "March"])).toBe(true);
    expect(yes(["Jan 2024", "Feb 2024"])).toBe(true);
    expect(yes(["2024-01", "2024-02"])).toBe(true);
    expect(yes(["Week 1", "Week 2"])).toBe(true);
    expect(yes(["FY24", "FY25"])).toBe(true);
    expect(yes(["9am", "10am", "11:30"])).toBe(true);
    expect(yes([1, 2, 5])).toBe(true);
    // Categories, including ones starting like a month or a day.
    expect(yes(["Marketing", "Sales"])).toBe(false);
    expect(yes(["Monitors", "Sunglasses"])).toBe(false);
    expect(yes(["Jan", "Sales"])).toBe(false);
    // Numbers out of order are ranks or ids, not a sequence.
    expect(yes([3, 1, 2])).toBe(false);
    expect(yes(["Jan"])).toBe(false);
  });

  it("leaves kind=hbar and kind=line as written", () => {
    const line = render(`${TEAMS}\nchart kind=line items=teams x=name y=q1`, { width: PHONE });
    expect(geo(line).kind).toBe("line");
    line.destroy();
    const across = render(`${TEAMS}\nchart kind=hbar items=teams x=name y=q1`, { width: DESKTOP });
    expect(geo(across).kind).toBe("hbar");
    across.destroy();
  });

  it("reads and copies the same either way", () => {
    for (const spec of [bars(" format=money"), bars(` labels="Q1,Q2"`, "q1,q2")]) {
      const [phone, desk] = both(spec);
      expect(geo(phone).kind).toBe("hbar");
      expect(geo(desk).kind).toBe("bar");
      expect(phone.accessibility()).toEqual(desk.accessibility());
      expect(phone.copyText()).toBe(desk.copyText());
      expect(phone.accessibility().children![0]).toMatchObject({ role: "figure", name: "Spend" });
      phone.destroy();
      desk.destroy();
    }
  });
});

/**
 * kind=bar draws its bars across (as kind=hbar) at every width, so each item
 * keeps its whole name and its amount in full, and stays vertical when that
 * would read worse or can't be done: layers, items in time order, rows
 * taller than MAX_ACROSS_HEIGHT (on a phone, than MAX_HBAR_HEIGHT), or no
 * room for bars beside their labels.
 */
import { describe, expect, it } from "vitest";
import { BARS_ACROSS_WIDTH, hbarRows, MAX_ACROSS_HEIGHT, inTimeOrder, MAX_HBAR_HEIGHT, type ChartGeometry } from "../src/components/chart";
import { toData } from "../src/data";
import { render, type Rendered } from "../src/testing";
import { lightTheme } from "../src/theme";

const PHONE = 360, DESKTOP = 1000;
const geo = (ui: Rendered, i = 0): ChartGeometry => ui.findAll("chart")[i]!.box!.data as ChartGeometry;
const TEAMS = `state teams=[{name: "Sales", q1: 42000, q2: 51000}, {name: "Marketing", q1: 31000, q2: 28000}, {name: "Engineering", q1: 78000, q2: 83000}, {name: "Support", q1: 19000, q2: -4000}, {name: "Finance", q1: 23000, q2: 26000}]`;
const bars = (extra = "", y = "q1") => `${TEAMS}\nchart "Spend" kind=bar items=teams x=name y=${y}${extra}\n`;
const both = (spec: string) => [render(spec, { width: PHONE }), render(spec, { width: DESKTOP })] as const;

describe("kind=bar across", () => {
  it("draws categories across, on a phone and on a desktop", () => {
    for (const ui of both(bars())) {
      const g = geo(ui);
      expect(g.kind).toBe("hbar");
      // One row per item, top to bottom in list order, each label at the left.
      expect(g.slots.map((s) => s.shownLabel)).toEqual(["Sales", "Marketing", "Engineering", "Support", "Finance"]);
      expect(g.slots.every((s, i) => i === 0 || s.cy! > g.slots[i - 1]!.cy!)).toBe(true);
      expect(g.slots.every((s) => s.bar!.w > 0 && s.bar!.h < s.bar!.w)).toBe(true);
      expect(ui.warnings).toEqual([]);
      ui.destroy();
    }
  });

  it("doesn't go by width", () => {
    for (const width of [240, 479, 480, 700, 1400]) {
      const ui = render(bars(), { width, padding: 0 });
      expect(geo(ui).kind, String(width)).toBe("hbar");
      ui.destroy();
    }
  });

  it("keeps a long list upright on a wide screen, where across it would be several times as tall", () => {
    const list = (n: number, y = "v") => `state rows=[${Array.from({ length: n }, (_, i) => `{k: "Item ${i + 1}", v: ${(i * 7) % 13 + 1}, w: ${i + 2}}`).join(", ")}]\nchart kind=bar items=rows x=k y=${y}\n`;
    const kindOf = (spec: string, width: number) => {
      const ui = render(spec, { width, padding: 0 });
      const g = geo(ui);
      expect(ui.warnings).toEqual([]);
      ui.destroy();
      return g.kind;
    };
    const fits = (ns: number) => Math.floor(MAX_ACROSS_HEIGHT / hbarRows(lightTheme, ns).rowH);
    expect(fits(1)).toBe(13);
    expect(kindOf(list(fits(1)), DESKTOP)).toBe("hbar");
    expect(kindOf(list(fits(1) + 1), DESKTOP)).toBe("bar");
    // Rows of two bars are taller, so fewer of them.
    expect(fits(2)).toBeLessThan(fits(1));
    expect(kindOf(list(fits(2), "v,w"), DESKTOP)).toBe("hbar");
    expect(kindOf(list(fits(2) + 1, "v,w"), DESKTOP)).toBe("bar");
    // A phone has no room for that many upright bars: it goes by MAX_HBAR_HEIGHT alone.
    expect(kindOf(list(fits(1) + 1), BARS_ACROSS_WIDTH - 1)).toBe("hbar");
    expect(kindOf(list(fits(1) + 1), BARS_ACROSS_WIDTH)).toBe("bar");
  });

  it("fits a slide, whose height is fixed", () => {
    const deck = (n: number) => `deck\n  slide "Spend by category"\n    chart kind=bar items=rows x=k y=v format=money\nstate rows=[${Array.from({ length: n }, (_, i) => `{k: "Category ${i + 1}", v: ${(i + 1) * 41000}}`).join(", ")}]\n`;
    for (const n of [6, 9, 24, 40]) {
      const ui = render(deck(n), { width: 800 });
      expect(ui.warnings, String(n)).toEqual([]);
      ui.destroy();
    }
  });

  it("writes each value in full at the end of its bar, in its format", () => {
    for (const ui of both(bars(" format=money"))) {
      expect(geo(ui).slots.map((s) => s.valueLabels![0]!.text)).toEqual(["$42,000", "$31,000", "$78,000", "$19,000", "$23,000"]);
      expect(ui.text()).toEqual(expect.arrayContaining(["$42,000", "$78,000"]));
      ui.destroy();
    }
  });

  it("writes amounts under a million in full, and shortens them from there up", () => {
    const rows = `state rows=[{k: "Acme", v: 999999}, {k: "Globex", v: 1000000}, {k: "Initech", v: 172500}, {k: "Umbrella", v: 12345678}, {k: "Hooli", v: 456789.37}]`;
    for (const kind of ["bar", "hbar"]) {
      const ui = render(`${rows}\nchart kind=${kind} items=rows x=k y=v format=money\n`, { width: DESKTOP });
      expect(geo(ui).slots.map((s) => s.valueLabels![0]!.text), kind).toEqual(["$999,999", "$1M", "$172,500", "$12.3M", "$456,789.37"]);
      ui.destroy();
    }
  });

  it("shortens the amounts only when written out they'd leave the bars no room", () => {
    // A loss and a gain: amounts on both sides of the bars.
    const spec = `state rows=[{k: "Professional services", v: -456789}, {k: "Enterprise licences", v: 318000}]\nchart kind=hbar items=rows x=k y=v format=money\n`;
    const texts = (ui: Rendered) => geo(ui).slots.map((s) => s.valueLabels![0]!.text);
    const wide = render(spec, { width: 600 });
    expect(texts(wide)).toEqual(["-$456,789", "$318,000"]);
    wide.destroy();
    // Too narrow for the bars between the full amounts: every amount goes short, and the chart is still drawn.
    const narrow = render(spec, { width: 260, padding: 0 });
    expect(geo(narrow).message).toBeUndefined();
    expect(texts(narrow)).toEqual(["-$456.8K", "$318K"]);
    expect(narrow.warnings).toEqual([]);
    narrow.destroy();
  });

  it("keeps several series side by side in each row, with their legend", () => {
    for (const ui of both(bars(` labels="Q1,Q2"`, "q1,q2"))) {
      const g = geo(ui);
      expect(g.kind).toBe("hbar");
      expect(g.slots.every((s) => s.bars!.length === 2)).toBe(true);
      expect(g.legend.map((l) => l.label)).toEqual(["Q1", "Q2"]);
      // The two bars of a row sit one under the other.
      const [a, b] = g.slots[0]!.bars!;
      expect(b!.y).toBeGreaterThan(a!.y);
      ui.destroy();
    }
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
      for (const ui of both(bars(`\n${layer}`))) {
        expect(geo(ui).kind, layer).toBe("bar");
        expect(geo(ui).layers, layer).toBeDefined();
        expect(ui.warnings, layer).toEqual([]);
        ui.destroy();
      }
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
      for (const ui of both(`state rows=${rows}\nchart kind=bar items=rows x=k y=v\n`)) {
        expect(geo(ui).kind, rows).toBe("bar");
        ui.destroy();
      }
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

  it("reads and copies the same across as it does upright", () => {
    // The same items, in time order (upright) and not (across): only the labels differ.
    const spec = (xs: string[]) => `state rows=[${xs.map((k, i) => `{k: "${k}", v: ${(i + 2) * 1500}}`).join(", ")}]\nchart "Spend" kind=bar items=rows x=k y=v format=money\n`;
    const upright = render(spec(["Jan", "Feb", "Mar"]), { width: DESKTOP });
    const across = render(spec(["Ads", "Rent", "Pay"]), { width: DESKTOP });
    expect(geo(upright).kind).toBe("bar");
    expect(geo(across).kind).toBe("hbar");
    const renamed = (text: string) => text.replace(/Jan/g, "Ads").replace(/Feb/g, "Rent").replace(/Mar/g, "Pay");
    expect(renamed(JSON.stringify(upright.accessibility()))).toBe(JSON.stringify(across.accessibility()));
    expect(renamed(upright.copyText())).toBe(across.copyText());
    expect(across.accessibility().children![0]).toMatchObject({ role: "figure", name: "Spend" });
    upright.destroy();
    across.destroy();
  });

  it("waits for its data in the shape it will most likely have", () => {
    const loading = (line: string) => {
      const ui = render("", { width: DESKTOP });
      ui.sayshape.setLoading(["teams"]);
      ui.sayshape.setSpec(`${line}\n`);
      ui.sayshape.renderNow();
      const g = geo(ui);
      expect(g.loading, line).toBeDefined();
      ui.destroy();
      return g;
    };
    // Rows, as bars across: what categories will be.
    expect(loading("chart kind=bar items=teams x=name y=q1").rowH).toBeGreaterThan(0);
    // Upright where the bars will be: a field of points in time, or a layer.
    expect(loading("chart kind=bar items=teams x=month y=q1").rowH).toBeUndefined();
    expect(loading(`chart kind=bar items=teams x=name y=q1\n  chart-rule "Target" y=40000`).rowH).toBeUndefined();
  });
});

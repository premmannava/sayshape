import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { darkTheme, lightTheme, mixColors, type Theme } from "../src/theme";
import { toData } from "../src/data";
import type { ChartGeometry } from "../src/components/chart";

const data = 'state rows=[{k:"North",v:12},{k:"South",v:9},{k:"West",v:17}]';
const geometry = (ui: ReturnType<typeof render>): ChartGeometry => ui.find("chart").box!.data as ChartGeometry;

/** The recording canvas captures real CanvasGradient stops rather than a mock color. */
function gradientFills(ui: ReturnType<typeof render>) {
  return ui.drawOps.filter((op) => op.op === "fill" && op.gradientStops?.length === 2);
}

describe("premium vertical and horizontal bars", () => {
  it.each([lightTheme, darkTheme].map((theme) => [theme.name, theme] as const))(
    "paints vertical bars with theme-derived gradients in %s mode", (_name, theme: Theme) => {
      const ui = render(data + '\nchart kind=bar items=rows x=k y=v', { theme });
      const color = theme.colors.accent;
      const stops = gradientFills(ui).map((op) => op.gradientStops!);
      expect(stops).toHaveLength(3);
      for (const gradient of stops) {
        expect(gradient).toEqual([
          { offset: 0, color },
          { offset: 1, color: mixColors(color, theme.colors.raised, 0.27) ?? color },
        ]);
      }
      expect(ui.diagnostics).toEqual([]);
      ui.destroy();
    },
  );

  it.each(["bar", "hbar"] as const)("handles positive and negative %s bars", (kind) => {
    const ui = render('state rows=[{k:"Gain",v:14},{k:"Loss",v:-8}]' +
      '\nchart kind=' + kind + ' items=rows x=k y=v');
    const d = geometry(ui);
    expect(d.message).toBeUndefined();
    expect(d.slots).toHaveLength(2);
    expect(gradientFills(ui).length).toBe(2);
    expect(ui.drawOps.some((op) => op.op === "fill" && op.fillStyle === lightTheme.colors.accent)).toBe(true);
    expect(ui.diagnostics).toEqual([]);
    ui.destroy();
  });

  it("keeps grouped bars in distinct series colors", () => {
    const ui = render('state rows=[{k:"Jan",a:5,b:8},{k:"Feb",a:6,b:4}]' +
      '\nchart kind=bar items=rows x=k y=a,b');
    const stops = gradientFills(ui).map((op) => op.gradientStops![0]!.color);
    expect(stops).toHaveLength(4);
    expect(new Set(stops).size).toBe(2);
    expect(stops).toContain(lightTheme.colors.series1);
    expect(stops).toContain(lightTheme.colors.series2);
    ui.destroy();
  });

  it("shows compact value labels only when vertical single-series bars have room", () => {
    const ui = render('state rows=[{k:"North",v:12},{k:"South",v:20}]' +
      '\nchart kind=bar items=rows x=k y=v', { width: 620 });
    expect(ui.text()).toContain("12");
    expect(ui.text()).toContain("20");
    const narrow = render(
      'state rows=[{k:"A",v:12},{k:"B",v:20},{k:"C",v:16},{k:"D",v:9},{k:"E",v:17},{k:"F",v:13},{k:"G",v:12},{k:"H",v:19}]' +
      '\nchart kind=bar items=rows x=k y=v', { width: 375 },
    );
    expect(narrow.drawOps.filter((op) => op.op === "fillText" && op.args[0] === "12")).toHaveLength(0);
    ui.destroy();
    narrow.destroy();
  });

  it("preserves horizontal value labels and reactive bar geometry", () => {
    const ui = render(data + '\nchart kind=hbar items=rows x=k y=v');
    const before = geometry(ui).slots[0]!.bar!.w;
    expect(ui.text().some((x) => x === "12")).toBe(true);
    ui.set("rows", toData([{ k: "North", v: 28 }, { k: "South", v: 9 }, { k: "West", v: 17 }]));
    expect(geometry(ui).slots[0]!.value).toBe(28);
    expect(ui.text().some((x) => x === "28")).toBe(true);
    expect(gradientFills(ui).length).toBe(3);
    // Bar widths need not always increase: the whole scale adapts, too.
    expect(Number.isFinite(geometry(ui).slots[0]!.bar!.w)).toBe(true);
    expect(before).toBeGreaterThan(0);
    ui.destroy();
  });
});

describe("premium KPI sparkline and trend", () => {
  const spec = 'state series=[12,16,13,20,18,25]\nstat label="Revenue" value="$25,600" change="+12%" spark=series';

  it.each([lightTheme, darkTheme].map((theme) => [theme.name, theme] as const))(
    "paints a smooth gradient sparkline and accessible trend indicator in %s", (_name, theme: Theme) => {
      const ui = render(spec, { theme });
      const fills = gradientFills(ui);
      expect(fills).toHaveLength(1);
      expect(fills[0]!.gradientStops![1]!.color).toBe(theme.colors.raised);
      expect(fills[0]!.globalAlpha).toBeLessThan(0.2);
      expect(ui.drawOps.some((op) => op.op === "stroke" && op.strokeStyle === theme.colors.good)).toBe(true);
      expect(ui.text()).toContain("$25,600");
      expect(ui.diagnostics).toEqual([]);
      ui.destroy();
    },
  );

  it("updates sparkline values without changing component height or using new DSL", () => {
    const ui = render(spec);
    const before = ui.find("stat").box!.h;
    ui.set("series", toData([15,18,22,20,26,32]));
    const after = ui.find("stat");
    expect(after.box!.h).toBe(before);
    expect(gradientFills(ui)).toHaveLength(1);
    expect(ui.diagnostics).toEqual([]);
    ui.destroy();
  });

  it("handles absent, flat and short sparkline inputs safely", () => {
    for (const series of ['[1,1,1,1]', '[]', '[100]', '[4,6,6,6,6]']) {
      const ui = render('state points=' + series + '\nstat label="Revenue" value=100 spark=points');
      expect(ui.diagnostics).toEqual([]);
      for (const op of ui.drawOps) expect(Number.isFinite(op.globalAlpha)).toBe(true);
      ui.destroy();
    }
  });
});

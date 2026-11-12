/** Layers under a bar or line chart: chart-line, chart-rule and chart-note. */
import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import type { ChartGeometry } from "../src/components/chart-kit";

const DATA = `state months=[{month: "Apr", revenue: 30000, forecast: 28000}, {month: "May", revenue: 42000, forecast: 40000}, {month: "Jun", revenue: 38000, forecast: 47000}]\n`;
const chart = (kind: string, layers: string) => `${DATA}chart "Revenue" kind=${kind} items=months x=month y=revenue format=money\n${layers}`;
const geo = (ui: ReturnType<typeof render>) => ui.find({ type: "chart" }).box!.data as ChartGeometry;
const words = (ui: ReturnType<typeof render>) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));

describe("chart layers", () => {
  it("draws a level, a line and a note on a bar chart, with no problems", () => {
    const ui = render(chart("bar", `  chart-line "Forecast" y=forecast\n  chart-rule "Target" y=60000\n  chart-note "Launch" at="Jun"\n`), { width: 600 });
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    const d = geo(ui);
    expect(d.layers!.lines[0]!.runs[0]!.length).toBe(3);
    expect(d.layers!.notes[0]!.index).toBe(2);
    expect(words(ui)).toContain("Launch");
    expect(words(ui).some((w) => w.startsWith("Target"))).toBe(true);
    // The line is named in a legend, beside the chart's own series.
    expect(d.legend.map((l) => l.label)).toEqual(["revenue", "Forecast"]);
  });

  it("makes room on the scale for a level above the tallest bar", () => {
    const d = geo(render(chart("bar", `  chart-rule "Target" y=60000\n`), { width: 600 }));
    expect(d.max).toBeGreaterThanOrEqual(60000);
    expect(d.layers!.rules[0]!.y).toBeGreaterThanOrEqual(d.plot.y);
  });

  it("works on a line chart, and leaves a chart without layers as it was", () => {
    expect(geo(render(chart("line", `  chart-rule "Target" y=35000\n`), { width: 600 })).layers!.rules.length).toBe(1);
    const plain = geo(render(chart("bar", ""), { width: 600 }));
    expect(plain.layers).toBeUndefined();
    expect(plain.legend).toEqual([]);
  });

  it("warns, and draws the chart, when a layer can't be drawn", () => {
    const ui = render(chart("bar", `  chart-note "Launch" at="Dec"\n  chart-line "Plan" y=nothing\n`), { width: 600 });
    expect(ui.warnings.join("\n")).toMatch(/matches no item/);
    expect(ui.warnings.join("\n")).toMatch(/no item has a number in nothing/);
    expect(geo(ui).slots.length).toBe(3);
    const pie = render(chart("donut", `  chart-rule "Target" y=1\n`), { width: 600 });
    expect(pie.warnings.join("\n")).toMatch(/kind=bar and kind=line only/);
  });

  it("tells screen readers about levels and gives line layers a column", () => {
    const ui = render(chart("bar", `  chart-line "Forecast" y=forecast\n  chart-rule "Target" y=60000\n`), { width: 600 });
    expect(ui.accessibility({ full: true }).children[0]!.description).toMatch(/Target: \$60,000\./);
    expect(ui.copyText()).toMatch(/Forecast/);
  });

  it("keeps a level's name off a line that passes where it would sit", () => {
    const at = (layers: string) => {
      const op = render(chart("bar", layers), { width: 600 }).drawOps.find((o) => o.op === "fillText" && String(o.args[0]).startsWith("Target"))!;
      return { x: Number(op.args[1]), y: Number(op.args[2]) };
    };
    // Forecast ends at 47,000, just above a target of 45,000: right where the name goes.
    const alone = at(`  chart-rule "Target" y=45000\n`);
    const crossed = at(`  chart-line "Forecast" y=forecast\n  chart-rule "Target" y=45000\n`);
    expect(crossed.y).toBeGreaterThan(alone.y);
    // A line nowhere near leaves it where it was.
    const clear = at(`  chart-line "Forecast" y=forecast\n  chart-rule "Target" y=10000\n`);
    expect(clear.y).toBe(at(`  chart-rule "Target" y=10000\n`).y);
  });
});

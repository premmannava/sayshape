/**
 * Regression tests for the design defaults: KPI rows line up, money
 * columns show cents only when an amount has them, reference-line labels
 * stay off the series, and dense lines are drawn straight.
 */
import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { lightTheme } from "../src/theme";
import { cellText, needsCents } from "../src/components/table";
import { DENSE_POINT_GAP, traceSmoothLine } from "../src/components/chart-kit";

describe("KPI rows", () => {
  it("top-aligns a row of stats, so labels share a line when one has a sparkline", () => {
    const ui = render(`row
  stat label="Revenue" value="$1.2M" spark={[1, 3, 2, 5]}
  stat label="Orders" value="812"`, { width: 600 });
    const [a, b] = ui.findAll("stat").map((s) => s.box!);
    expect(a!.y).toBe(b!.y);
    ui.destroy();
  });

  it("still centers other rows", () => {
    const ui = render(`row
  stat label="Revenue" value="$1.2M" spark={[1, 3, 2, 5]}
  button "Go"`, { width: 600 });
    const s = ui.find("stat").box!, b = ui.find("button").box!;
    expect(b.y).toBeGreaterThan(s.y);
    ui.destroy();
  });
});

describe("money columns", () => {
  it("shows cents only when one of the amounts has them", () => {
    expect(needsCents([48200, 9120, undefined])).toBe(false);
    expect(needsCents([48200, 1299.99])).toBe(true);
    expect(cellText(48200, "money", false).text).toBe("$48,200");
    expect(cellText(48200, "money").text).toBe("$48,200.00");
    const whole = render(`state r=[{p: 1200}, {p: 35}]\ntable items=r\n  table-column "Price" field=p format=money`);
    expect(whole.text()).toEqual(expect.arrayContaining(["$1,200", "$35"]));
    const mixed = render(`state r=[{p: 1200}, {p: 35.5}]\ntable items=r\n  table-column "Price" field=p format=money`);
    expect(mixed.text()).toEqual(expect.arrayContaining(["$1,200.00", "$35.50"]));
    whole.destroy(); mixed.destroy();
  });
});

describe("chart lines", () => {
  const months = `[{m: "Jan", v: 10}, {m: "Feb", v: 52}, {m: "Mar", v: 60}, {m: "Apr", v: 64}]`;

  it("draws a reference level quietly and keeps its label off the chart's own line", () => {
    const ui = render(`state rows=${months}\nchart "Sales" kind=line items=rows x=m y=v\n  chart-rule "Target" y=55`, { width: 360 });
    const label = ui.drawOps.find((o) => o.op === "fillText" && String(o.args[0]).startsWith("Target"));
    expect(label).toBeDefined();
    // The muted color, not the ink: a reference, read against the data.
    expect(label!.fillStyle).toBe(lightTheme.colors.muted);
    // No point of the line under the label (sampled along each segment).
    const box = ui.find("chart").box!;
    const d = box.data as { seriesSegments: Array<Array<Array<{ x: number; y: number }>>> };
    const [lx, ly] = [Number(label!.args[1]), Number(label!.args[2])];
    for (const run of d.seriesSegments.flat()) {
      for (let i = 0; i + 1 < run.length; i++) {
        for (let u = 0; u <= 1; u += 0.05) {
          const x = box.x + run[i]!.x + (run[i + 1]!.x - run[i]!.x) * u, y = box.y + run[i]!.y + (run[i + 1]!.y - run[i]!.y) * u;
          expect(x >= lx - 2 && x <= lx + 40 && Math.abs(y - ly) < 8, `line at ${x},${y} under the label`).toBe(false);
        }
      }
    }
    ui.destroy();
  });

  it("joins dense points straight, so no curve invents wiggles between them", () => {
    const calls: string[] = [];
    const g = { moveTo: () => calls.push("moveTo"), lineTo: () => calls.push("lineTo"), bezierCurveTo: () => calls.push("curve") } as unknown as CanvasRenderingContext2D;
    const run = (gap: number) => Array.from({ length: 10 }, (_, i) => ({ x: i * gap, y: (i * 7) % 5 }));
    traceSmoothLine(g, run(DENSE_POINT_GAP - 1), 0, 0);
    expect(calls).not.toContain("curve");
    calls.length = 0;
    traceSmoothLine(g, run(DENSE_POINT_GAP * 3), 0, 0);
    expect(calls).toContain("curve");
  });
});

describe("chart tooltips", () => {
  it("show whole money amounts without .00, and cents when there are some", async () => {
    const { preciseText } = await import("../src/components/chart-kit");
    expect(preciseText(51200, "money")).toBe("$51,200");
    expect(preciseText(172000.5, "money")).toBe("$172,000.50");
  });
});

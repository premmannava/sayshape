/**
 * Area fills, and the wash under a single line, meet the 0 line when the
 * values cross it: a negative year reads as an amount below 0, never as mass
 * rising from the bottom of the plot (−40% there).
 */
import { describe, expect, it } from "vitest";
import type { ChartGeometry } from "../src/components/chart";
import { lightTheme } from "../src/theme";
import { render } from "../src/testing";

const RETURNS = `[{year: "2019", r: 12}, {year: "2020", r: -40}, {year: "2021", r: 25}, {year: "2022", r: -8}]`;
const GAINS = `[{year: "2019", r: 12}, {year: "2020", r: 30}, {year: "2021", r: 25}]`;

/** The y of every lineTo while the chart paints, and the chart's box and geometry. */
function paintChart(kind: string, rows: string) {
  const ui = render(`state r=${rows}\nchart "Returns" kind=${kind} items=r x=year y=r format=percent\n`, { width: 600 });
  const box = ui.find("chart").box!;
  const ys: number[] = [];
  const g = ui.canvas.getContext("2d") as unknown as Record<string, unknown>;
  g.lineTo = (_x: number, y: number) => { ys.push(y); };
  ui.sayshape.invalidate("paint");
  ui.sayshape.renderNow();
  const fills = ui.drawOps.filter((o) => o.op === "fill" && o.gradientStops);
  ui.destroy();
  return { d: box.data as ChartGeometry, top: box.y, ys, fills };
}

describe("fills meet the 0 line", () => {
  for (const kind of ["area", "line"]) {
    it(`kind=${kind}: the fill closes on 0, not on the bottom of the plot`, () => {
      const { d, top, ys } = paintChart(kind, RETURNS);
      expect(d.min).toBeLessThan(0);
      const zero = top + d.zeroY!;
      const bottom = top + d.plot.y + d.plot.h;
      expect(ys.some((y) => Math.abs(y - zero) < 0.01), "a lineTo on the 0 line").toBe(true);
      expect(ys.some((y) => Math.abs(y - bottom) < 0.01), "no lineTo on the plot's bottom").toBe(false);
    });

    it(`kind=${kind}: below 0 the wash is mirrored, strongest at the bottom and fading to the surface at 0`, () => {
      const { d, fills } = paintChart(kind, RETURNS);
      expect(fills.length).toBeGreaterThan(0);
      const stops = fills[0]!.gradientStops!;
      expect(stops).toHaveLength(3);
      const at = (d.zeroY! - d.plot.y) / d.plot.h;
      expect(stops[1]!.offset).toBeCloseTo(at, 5);
      expect(stops[1]!.color).toBe(lightTheme.colors.raised);
      expect(stops[2]!.color).toBe(stops[0]!.color);
    });
  }

  it("all-positive values keep the plain wash down to 0", () => {
    const { fills } = paintChart("area", GAINS);
    expect(fills[0]!.gradientStops!.map((s) => s.offset)).toEqual([0, 1]);
  });
});

describe("bar headroom", () => {
  it("adds a step over a value that reaches the top tick, and under one that reaches the bottom", async () => {
    const { chartScale, BAR_HEADROOM } = await import("../src/components/chart-kit");
    const up = chartScale([0, 12, 38, 40], "bar", 4);
    expect(up.max - 40).toBeGreaterThanOrEqual(up.step * BAR_HEADROOM);
    const down = chartScale([-40, 10], "bar", 4);
    expect(-40 - down.min).toBeGreaterThanOrEqual(down.step * BAR_HEADROOM);
    // Room already there: the scale stays as it was.
    expect(chartScale([0, 35], "bar", 4).max).toBe(40);
    // Lines are scaled to their values, with no headroom.
    expect(chartScale([10, 40], "line", 4).max).toBe(40);
  });
});

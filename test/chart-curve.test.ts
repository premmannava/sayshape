/**
 * Line and area charts join discrete points with straight segments, so a
 * curve never draws values between samples that were never measured;
 * curve=smooth is the opt-in.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import type { ChartGeometry } from "../src/components/chart";
import { traceLine } from "../src/components/chart-kit";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";

const registry = new Registry(coreComponents);
const RETURNS = `[{year: "2019", r: 12}, {year: "2020", r: -40}, {year: "2021", r: 25}, {year: "2022", r: -8}, {year: "2023", r: 18}]`;

/** Every path call while the chart paints, by name. */
function pathCalls(spec: string): string[] {
  const ui = render(spec, { width: 600 });
  const calls: string[] = [];
  const g = ui.canvas.getContext("2d") as unknown as Record<string, unknown>;
  g.bezierCurveTo = () => { calls.push("curve"); };
  g.quadraticCurveTo = () => { calls.push("curve"); };
  g.lineTo = () => { calls.push("lineTo"); };
  ui.sayshape.invalidate("paint");
  ui.sayshape.renderNow();
  ui.destroy();
  return calls;
}

describe("line shape", () => {
  it("traceLine joins points straight unless asked to smooth", () => {
    const calls: string[] = [];
    const g = { moveTo: () => calls.push("moveTo"), lineTo: () => calls.push("lineTo"), bezierCurveTo: () => calls.push("curve") } as unknown as CanvasRenderingContext2D;
    const run = [0, 1, 2, 3].map((i) => ({ x: i * 60, y: (i % 2) * 40 }));
    traceLine(g, run, 0, 0);
    expect(calls).toEqual(["moveTo", "lineTo", "lineTo", "lineTo"]);
    calls.length = 0;
    traceLine(g, run, 0, 0, true);
    expect(calls).toContain("curve");
  });

  for (const kind of ["line", "area"]) {
    it(`kind=${kind} draws straight segments by default, so nothing is drawn between the yearly points`, () => {
      const calls = pathCalls(`state r=${RETURNS}\nchart "Returns" kind=${kind} items=r x=year y=r format=percent\n`);
      expect(calls).toContain("lineTo");
      expect(calls).not.toContain("curve");
    });

    it(`kind=${kind} curve=smooth opts in to the monotone curve`, () => {
      const spec = `state r=${RETURNS}\nchart "Returns" kind=${kind} items=r x=year y=r curve=smooth\n`;
      expect(pathCalls(spec)).toContain("curve");
      const ui = render(spec, { width: 600 });
      expect((ui.find("chart").box!.data as ChartGeometry).smooth).toBe(true);
      ui.destroy();
    });
  }

  it("chart-line layers over bars follow the chart: straight by default", () => {
    const calls = pathCalls(`state r=${RETURNS}\nchart "Returns" kind=bar items=r x=year y=r\n  chart-line y=r\n`);
    expect(calls).not.toContain("curve");
  });

  it("warns that curve= does nothing on other kinds", () => {
    const msgs = parse(`state r=${RETURNS}\nchart kind=bar items=r x=year y=r curve=smooth\n`, registry).diagnostics.map((d) => d.message);
    expect(msgs.join("\n")).toMatch(/curve= shapes the line of kind=line and kind=area only/);
  });
});

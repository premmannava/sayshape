import { describe, expect, it } from "vitest";
import { chartHoverAt, type ChartGeometry } from "../src/components/chart";
import { render } from "../src/testing";

const geometry = (data: string, kind: "bar" | "hbar" | "line" | "pie" | "donut", ys = "v"): ChartGeometry => {
  const ui = render("state rows=" + data + "\nchart kind=" + kind + " items=rows x=k y=" + ys, { width: 550 });
  return ui.find("chart").box!.data as ChartGeometry;
};
const atRect = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

describe("chart hover geometry", () => {
  it("locates actual bars, including grouped series, but not nearby whitespace", () => {
    const d = geometry('[{k:"Jan",v:10,w:12},{k:"Feb",v:20,w:15}]', "bar", "v,w");
    const bar = d.slots[1]!.bars![1]!;
    expect(chartHoverAt(d, atRect(bar).x, atRect(bar).y)).toEqual({ kind: "slot", index: 1 });
    expect(chartHoverAt(d, d.plot.x + 1, d.plot.y + 1)).toBeNull();
  });

  it("locates horizontal bar rows without making their labels clickable", () => {
    const d = geometry('[{k:"North America",v:15},{k:"EMEA",v:25}]', "hbar");
    const b = d.slots[0]!.bars![0]!;
    expect(chartHoverAt(d, atRect(b).x, atRect(b).y)).toEqual({ kind: "slot", index: 0 });
    expect(chartHoverAt(d, 0, d.slots[0]!.cy!)).toBeNull();
  });

  it("selects line slots for a multi-series crosshair and skips all-null gaps", () => {
    const d = geometry('[{k:"Jan",v:10,w:12},{k:"Feb",v:null,w:null},{k:"Mar",v:20,w:17}]', "line", "v,w");
    const mid = d.plot.y + d.plot.h / 2;
    expect(chartHoverAt(d, d.slots[0]!.cx, mid)).toEqual({ kind: "slot", index: 0 });
    expect(chartHoverAt(d, d.slots[1]!.cx, mid)).toBeNull();
    expect(chartHoverAt(d, d.slots[2]!.cx, mid)).toEqual({ kind: "slot", index: 2 });
    expect(chartHoverAt(d, d.plot.x - 5, mid)).toBeNull();
  });

  it.each(["pie", "donut"] as const)("selects %s slices by angle, excluding the center hole and outer area", (kind) => {
    const d = geometry('[{k:"Direct",v:40},{k:"Partner",v:60}]', kind);
    const p = d.pie!, slice = p.slices[1]!;
    const a = (slice.start + slice.end) / 2 - Math.PI / 2;
    const radius = (p.inner + p.r) / 2;
    expect(chartHoverAt(d, p.cx + Math.cos(a) * radius, p.cy + Math.sin(a) * radius)).toEqual({ kind: "slice", index: 1 });
    expect(chartHoverAt(d, p.cx + p.r + 3, p.cy)).toBeNull();
    if (kind === "donut") expect(chartHoverAt(d, p.cx, p.cy)).toBeNull();
  });

  it("does not produce hover targets for empty charts", () => {
    const d = geometry("[]", "bar");
    expect(chartHoverAt(d, d.plot.x, d.plot.y)).toBeNull();
  });
});

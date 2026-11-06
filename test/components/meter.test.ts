import { describe, expect, it } from "vitest";
import { coreComponents } from "../../src/components";
import { meterText, parseBands, type MeterGeometry } from "../../src/components/meter";
import { parse } from "../../src/parser";
import { languageGuide } from "../../src/prompt";
import { Registry } from "../../src/registry";
import { render, type Rendered } from "../../src/testing";

// The contract tests (test/contract.test.ts) already check the definition,
// layout bounds at three widths, theme-only colors and keyboard reach.
// Test what's specific to meter here.

const registry = new Registry(coreComponents);
const geo = (ui: Rendered): MeterGeometry => ui.find("meter").box!.data as unknown as MeterGeometry;
const msgs = (spec: string) => parse(spec + "\n", registry).diagnostics.map((d) => d.message);

describe("meter", () => {
  it("renders its example without diagnostics", () => {
    const ui = render(`state score=72\nmeter "Health score" kind=gauge value=score max=100 bands="60,85"\n`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    expect(ui.text()).toEqual(expect.arrayContaining(["72", "Health score", "0", "100"]));
  });

  it("is taught in the model guide", () => {
    const guide = languageGuide(registry);
    expect(guide).toContain("meter");
    expect(guide).toContain("kind=<ring|gauge>");
  });

  it("places the value in its range, and stops the mark at the ends", () => {
    expect(geo(render(`meter value=25\n`)).frac).toBeCloseTo(0.25);
    expect(geo(render(`meter value=5 min=0 max=20\n`)).frac).toBeCloseTo(0.25);
    const over = geo(render(`meter value=140 max=100\n`));
    expect(over.frac).toBe(1);
    expect(over.text).toBe("140");
    expect(geo(render(`meter value={-5}\n`)).frac).toBe(0);
  });

  it("follows state as it changes", () => {
    const ui = render(`state done=3 total=4\nmeter "Packed" value={done / total * 100} format=percent\nbutton "Pack" on=inc:done\n`);
    expect(geo(ui).text).toBe("75%");
    ui.press({ type: "button", text: "Pack" });
    expect(geo(ui).frac).toBe(1);
    expect(geo(ui).text).toBe("100%");
  });

  it("colors the mark by the band its value is in", () => {
    const zone = (v: number, extra = "") => geo(render(`meter value=${v} bands="60,85" ${extra}\n`)).zone;
    expect([zone(10), zone(70), zone(90)]).toEqual(["bad", "warn", "good"]);
    expect([zone(10, "good=down"), zone(70, "good=down"), zone(90, "good=down")]).toEqual(["good", "warn", "bad"]);
    expect(geo(render(`meter value=50 bands="40"\n`)).zone).toBe("good");
    expect(geo(render(`meter value=50\n`)).zone).toBe("accent");
    expect(geo(render(`meter kind=gauge value=50 bands="60,85"\n`)).zones.map((z) => z.zone)).toEqual(["bad", "warn", "good"]);
  });

  it("formats the number", () => {
    expect(meterText(1200, 0, 5000, "money")).toBe("$1,200");
    expect(meterText(41, 0, 50, "percent")).toBe("82%");
    expect(meterText(null, 0, 100, "number")).toBe("—");
  });

  it("shows — and an empty mark for a value that isn't a number, with a warning", () => {
    const ui = render(`state v="high"\nmeter "Load" value=v\n`);
    expect(geo(ui).frac).toBeNull();
    expect(geo(ui).text).toBe("—");
    expect(ui.warnings.join()).toMatch(/value isn't a number/);
  });

  it("checks bands and the range where they're written", () => {
    expect(parseBands("60,85")).toEqual([60, 85]);
    expect(parseBands("85,60")).toBeNull();
    expect(parseBands("1,2,3")).toBeNull();
    expect(msgs(`meter value=5 bands="high"`)[0]).toMatch(/bands="high" should be one or two numbers/);
    expect(msgs(`meter value=5 min=10 max=5`)[0]).toMatch(/min=10 should be less than max=5/);
    const ui = render(`state lo=10 hi=5\nmeter value=3 min={lo} max={hi}\n`);
    expect(ui.warnings.join()).toMatch(/isn't less than max/);
    expect(geo(ui).frac).toBeCloseTo(0.03);
  });

  it("lays out at narrow and wide widths, never wider than its box", () => {
    for (const width of [120, 240, 600]) {
      for (const kind of ["ring", "gauge"]) {
        const ui = render(`meter "A label long enough to wrap onto a second line here" kind=${kind} value=40 format=money max=1000000\n`, { width });
        const d = geo(ui);
        expect(d.cx + d.r + d.stroke / 2).toBeLessThanOrEqual(width + 0.01);
        expect(d.label.length).toBeLessThanOrEqual(2);
        ui.destroy();
      }
    }
  });

  it("isn't a Tab stop: it shows a value, nothing to press", () => {
    const ui = render(`meter value=5\n`);
    expect(ui.hits).toEqual([]);
  });
});

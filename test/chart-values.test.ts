/** values= and highlight= on bar, hbar and stacked charts. */
import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { mutedBar, type ChartGeometry } from "../src/components/chart-kit";
import { isDark, lightTheme } from "../src/theme";

const DATA = `state sales=[{m: "Jan", a: 12000, b: 9000}, {m: "Feb", a: 18000, b: 15000}, {m: "Mar", a: 15000, b: 21000}, {m: "Apr", a: 9000, b: 8000}, {m: "May", a: 11000, b: 12000}, {m: "Jun", a: 16000, b: 7000}, {m: "Jul", a: 14000, b: 10000}, {m: "Aug", a: 20000, b: 9000}, {m: "Sep", a: 8000, b: 6000}, {m: "Oct", a: 13000, b: 5000}]\n`;
const spec = (props: string, y = "a") => `${DATA}chart "Sales" items=sales x=m y=${y} format=money ${props}\n`;
const words = (ui: ReturnType<typeof render>) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));
const geo = (ui: ReturnType<typeof render>) => ui.find({ type: "chart" }).box!.data as ChartGeometry;
/** Value labels drawn: the money texts, less the axis ticks. */
const money = (w: string[]) => w.filter((t) => /^\$\d/.test(t));
const labelsOf = (ui: ReturnType<typeof render>) => {
  const out = money(words(ui));
  for (const k of geo(ui).ticks) { const at = out.indexOf(k.label); if (at >= 0) out.splice(at, 1); }
  return out;
};

describe("chart values=", () => {
  it("is off by default and labels only what fits when on: ten bars gain labels", () => {
    const off = labelsOf(render(spec("kind=bar"), { width: 700 }));
    const ui = render(spec("kind=bar values=true"), { width: 700 });
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    expect(off.length).toBe(0);
    expect(labelsOf(ui).length).toBe(10);
  });

  it("labels grouped bars, one per bar, in the chart's format", () => {
    const few = (props: string) => `state s=[{m: "Jan", a: 12000, b: 9000}, {m: "Feb", a: 18000, b: 15000}, {m: "Mar", a: 15000, b: 21000}]\nchart "S" items=s x=m y=a,b format=money ${props}\n`;
    const ui = render(few("kind=bar values=true"), { width: 500 });
    expect(labelsOf(ui).sort()).toEqual(["$12K", "$15K", "$15K", "$18K", "$21K", "$9K"].sort());
    expect(labelsOf(render(few("kind=bar"), { width: 500 }))).toEqual([]);
  });

  it("leaves out labels that cannot fit", () => {
    const ui = render(spec("kind=bar values=true", "a,b"), { width: 260 });
    expect(labelsOf(ui).length).toBeLessThan(20);
  });

  it("adds part values and totals to a stacked chart without repeating the totals", () => {
    const few = (props: string) => `state s=[{m: "Jan", a: 12000, b: 9000}, {m: "Feb", a: 18000, b: 15000}]\nchart "S" items=s x=m y=a,b format=money ${props}\n`;
    // Already drawn without values=: the two totals.
    expect(labelsOf(render(few("kind=stacked"), { width: 500 })).sort()).toEqual(["$21K", "$33K"]);
    // Added: each part's value inside its segment; the totals aren't drawn twice.
    expect(labelsOf(render(few("kind=stacked values=true"), { width: 500 })).sort()).toEqual(["$12K", "$15K", "$18K", "$21K", "$33K", "$9K"]);
    // Ten bars: no totals without values=, one over each bar with it.
    expect(labelsOf(render(spec("kind=stacked", "a,b"), { width: 700 }))).toEqual([]);
    expect(labelsOf(render(spec("kind=stacked values=true", "a,b"), { width: 700 })).length).toBeGreaterThanOrEqual(10);
  });

  it("is ignored with a warning on other kinds", () => {
    const ui = render(spec("kind=line values=true highlight=Jan"), { width: 600 });
    expect(ui.diagnostics.map((d) => d.message).join("\n")).toMatch(/values= is for kind=bar/);
    expect(ui.diagnostics.map((d) => d.message).join("\n")).toMatch(/highlight= is for kind=bar/);
  });
});

describe("chart highlight=", () => {
  it("keeps one item's bars in full color and fades the rest", () => {
    const ui = render(spec("kind=bar highlight=Mar"), { width: 700 });
    expect(geo(ui).highlight).toEqual([2]);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    // Muted: the same hue, nearer the surface.
    const faded = mutedBar(lightTheme, lightTheme.colors.accent);
    expect(faded).not.toBe(lightTheme.colors.accent);
    expect(isDark(faded)).toBe(false);
  });

  it("works on hbar and stacked, and matches without regard to case", () => {
    expect(geo(render(spec("kind=hbar highlight=mar"), { width: 600 })).highlight).toEqual([2]);
    expect(geo(render(spec("kind=stacked highlight=Feb", "a,b"), { width: 600 })).highlight).toEqual([1]);
  });

  it("warns and draws normally when no item matches", () => {
    const ui = render(spec("kind=bar highlight=Dec"), { width: 700 });
    expect(ui.warnings.join("\n")).toMatch(/highlight="Dec" matches no item/);
    expect(geo(ui).highlight).toBeUndefined();
    expect(geo(ui).slots.length).toBe(10);
  });
});

describe("chart highlight= in words", () => {
  it("names the highlighted item for screen readers", () => {
    const ui = render(spec("kind=bar highlight=Mar"), { width: 700 });
    expect(ui.accessibility({ full: true }).children[0]!.description).toMatch(/Highlighted: Mar\./);
  });
});

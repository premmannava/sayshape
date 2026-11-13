// Flatter, more compact drawing for interfaces inside chat apps: solid bars,
// dots only where they say something, flat sparklines, smaller donuts with
// the legend beside them, and a bare root card when the host asks for it.
import { describe, expect, it } from "vitest";
import { MAX_ROUND_SIZE, type ChartGeometry } from "../src/components/chart";
import { render, type Rendered } from "../src/testing";
import { lightTheme } from "../src/theme";

const c = lightTheme.colors;
const geo = (ui: Rendered): ChartGeometry => ui.find("chart").box!.data as ChartGeometry;
const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => `{k:"P${i}",a:${(i * 7) % 11 + 1},b:${(i * 5) % 9 + 2}}`).join(",");

describe("flat charts", () => {
  it.each(["bar", "hbar", "waterfall"])("fills %s bars solid, with no gradient", (kind) => {
    const ui = render(`state rows=[${rowsOf(5)}]\nchart kind=${kind} items=rows x=k y=a`);
    expect(ui.drawOps.filter((op) => op.op === "fill" && op.fillStyle !== "").length).toBeGreaterThanOrEqual(5);
    expect(ui.drawOps.some((op) => op.gradientStops?.length)).toBe(false);
    ui.destroy();
  });

  it.each(["line", "area"])("draws one dot per %s series when nothing is hovered", (kind) => {
    for (const n of [4, 9]) {
      for (const [y, series] of [["a", 1], ["a,b", 2]] as const) {
        const ui = render(`state rows=[${rowsOf(n)}]\nchart kind=${kind} items=rows x=k y=${y}`);
        // Each dot is filled with the raised color under its colored ring.
        const dots = ui.drawOps.filter((op) => op.op === "fill" && op.fillStyle === c.raised);
        expect(dots).toHaveLength(series);
        ui.destroy();
      }
    }
  });

  it("draws a stat's sparkline as a stroke with no fill or glow under it", () => {
    const ui = render("stat label=\"Visits\" value=\"1,204\" spark=[3, 5, 4, 8, 7, 9]");
    const spark = ui.drawOps.filter((op) => op.strokeStyle === c.accent || op.fillStyle === c.accent);
    expect(spark.some((op) => op.op === "stroke" && op.strokeStyle === c.accent)).toBe(true);
    expect(ui.drawOps.some((op) => op.gradientStops?.length)).toBe(false);
    // The only fill in the line's color is the small dot at the latest value, drawn solid.
    const fills = spark.filter((op) => op.op === "fill");
    expect(fills).toHaveLength(1);
    expect(fills[0]!.globalAlpha).toBe(1);
    ui.destroy();
  });
});

describe("donut and pie size", () => {
  const SPEC = 'state rows=[{k:"Rent",v:1500},{k:"Food",v:500},{k:"Travel",v:300}]\nchart kind=donut items=rows x=k y=v format=money\n';

  it(`caps a donut at ${MAX_ROUND_SIZE} px with its legend beside it when there's room`, () => {
    const ui = render(SPEC, { width: 600 });
    const pie = geo(ui).pie!;
    expect(MAX_ROUND_SIZE).toBe(160);
    expect(pie.r * 2).toBe(160);
    for (const item of geo(ui).legend) {
      expect(item.swatch.x).toBeGreaterThanOrEqual(pie.cx + pie.r);
      expect(item.swatch.y).toBeGreaterThanOrEqual(pie.cy - pie.r);
      expect(item.swatch.y + item.swatch.h).toBeLessThanOrEqual(pie.cy + pie.r);
    }
    ui.destroy();
  });

  it("puts the legend under a donut in a narrow box", () => {
    const ui = render(SPEC, { width: 240 });
    const pie = geo(ui).pie!;
    expect(pie.r * 2).toBeLessThanOrEqual(160);
    for (const item of geo(ui).legend) expect(item.swatch.y).toBeGreaterThan(pie.cy + pie.r);
    ui.destroy();
  });

  it("caps a pie the same way", () => {
    const ui = render(SPEC.replace("donut", "pie"), { width: 900 });
    expect(geo(ui).pie!.r * 2).toBe(160);
    ui.destroy();
  });
});

describe("bare root card (bareRootCard)", () => {
  const ROOT = 'card\n  text "Order summary" style=title\n  text "2 items"\n';
  const NESTED = 'card\n  text "Orders" style=title\n  card\n    text "Trail socks"\n';
  // A raised card's frame: its fill fades from raised (filled twice, for its two shadows), and its border is in the line color.
  const frames = (ui: Rendered) => ({
    cards: ui.drawOps.filter((op) => op.op === "fill" && op.gradientStops?.[0]?.color === c.raised).length / 2,
    borders: ui.drawOps.filter((op) => op.op === "stroke" && op.strokeStyle === c.line).length,
  });

  it("paints no border or shadow and starts its content at the box edge", () => {
    const ui = render(ROOT, { bareRootCard: true });
    expect(frames(ui)).toEqual({ cards: 0, borders: 0 });
    const card = ui.find("card").box!, title = ui.findAll("text")[0]!.box!;
    expect(title.x).toBe(card.x);
    expect(title.y).toBe(card.y);
    ui.destroy();
  });

  it("keeps a nested card's frame", () => {
    const ui = render(NESTED, { bareRootCard: true });
    expect(frames(ui)).toEqual({ cards: 1, borders: 1 });
    const [outer, inner] = ui.findAll("card").map((n) => n.box!);
    expect(inner!.x).toBe(outer!.x);
    expect(ui.findAll("text")[1]!.box!.x).toBeGreaterThan(inner!.x);
    ui.destroy();
  });

  it("frames the card when it isn't the only top-level element", () => {
    const ui = render(`${ROOT}text "Footnote"\n`, { bareRootCard: true });
    expect(frames(ui)).toEqual({ cards: 1, borders: 1 });
    ui.destroy();
  });

  it("changes nothing with the option off", () => {
    for (const spec of [ROOT, NESTED]) {
      const off = render(spec), on = render(spec, { bareRootCard: false });
      expect(off.drawOps).toEqual(on.drawOps);
      expect(frames(off).cards).toBeGreaterThan(0);
      const card = off.findAll("card")[0]!.box!, title = off.findAll("text")[0]!.box!;
      expect(title.x).toBe(card.x + lightTheme.space.lg);
      off.destroy();
      on.destroy();
    }
  });

  it("still lets a bare pressable card be pressed", () => {
    const ui = render('card on=emit:open\n  text "Open order"\n', { bareRootCard: true });
    ui.press("card");
    expect(ui.emitted).toEqual([{ name: "open", value: undefined }]);
    ui.destroy();
  });
});

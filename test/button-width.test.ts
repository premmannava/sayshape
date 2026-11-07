/**
 * Buttons take their label's width wherever there's room, and the full width
 * on a phone. In a row they stay together instead of sitting apart in empty
 * slots.
 */
import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { BUTTON_FULL_UNDER } from "../src/components/input";

const boxes = (spec: string, width: number) => {
  const ui = render(spec, { width });
  const out = ui.hits.filter((h) => h.box.node.type === "button").map((h) => h.box);
  ui.destroy();
  return out;
};

describe("button width", () => {
  it("takes the full width on a phone", () => {
    const [b] = boxes(`button "Book now"\n`, 360);
    expect(b!.w).toBe(360 - 40);
    expect(360).toBeLessThanOrEqual(BUTTON_FULL_UNDER);
  });

  it("takes its label's width where there's room, at the start", () => {
    const [b] = boxes(`button "Book now"\n`, 1024);
    expect(b!.w).toBeGreaterThanOrEqual(96);
    expect(b!.w).toBeLessThan(200);
    expect(b!.x).toBe(20);
  });

  it("grows with a long label", () => {
    const [short] = boxes(`button "Go"\n`, 1024);
    const [long] = boxes(`button "Download the full quarterly report"\n`, 1024);
    expect(short!.w).toBe(96);
    expect(long!.w).toBeGreaterThan(short!.w);
  });

  it("keeps a row of buttons together, from the left", () => {
    const [a, b] = boxes(`row gap=10
  button "Cancel" variant=secondary
  button "Save"
`, 1024);
    expect(a!.x).toBe(20);
    expect(b!.x).toBeCloseTo(a!.x + a!.w + 10, 5);
  });

  it("puts buttons after other content at the row's right edge", () => {
    const ui = render(`row
  text "$129" style=title
  button "Add to cart"
`, { width: 1024 });
    const b = ui.hits.find((h) => h.box.node.type === "button")!.box;
    expect(b.x + b.w).toBeCloseTo(1024 - 20, 5);
    ui.destroy();
  });

  it("still splits a phone-width row equally", () => {
    const [a, b] = boxes(`row gap=10
  button "Cancel" variant=secondary
  button "Save"
`, 360);
    expect(a!.w).toBeCloseTo(b!.w, 5);
    expect(a!.w + b!.w + 10).toBeCloseTo(320, 5);
  });

  it("keeps its label's width in a narrow slot on a wider screen", () => {
    // Two buttons in a row in a padded card at 760: each slot is under 360, but it isn't a phone.
    const [a, b] = boxes(`card
  row
    button "Export report"
    button "Share" variant=secondary
`, 760);
    expect(a!.w).toBeLessThan(160);
    expect(b!.w).toBeLessThan(120);
    expect(b!.x).toBeCloseTo(a!.x + a!.w + 10, 5);
    // A lone button in a narrow grid cell, too.
    const [c] = boxes(`grid min=170
  card
    button "Go"
  card
    text "x"
  card
    text "y"
  card
    text "z"
`, 1024);
    expect(c!.w).toBe(96);
  });

  it("takes the full width of its slot on a phone, even in a card", () => {
    const [a] = boxes(`card
  button "Pay"
`, 400);
    expect(a!.w).toBeGreaterThan(300);
  });

  it("presses where it's drawn", () => {
    const ui = render(`state n=0
button "Add" on=inc:n
`, { width: 1024 });
    ui.press("button");
    expect(ui.state.n).toBe(1);
    ui.click(600, 40);
    expect(ui.state.n).toBe(1);
    ui.destroy();
  });
});

describe("button shine", () => {
  const shines = (theme: import("../src/theme").Theme) => {
    const ui = render(`button "Save"\n`, { width: 1024, theme });
    // The shine is the only stroke a primary button draws in its label color.
    const n = ui.drawOps.filter((o) => o.op === "stroke" && o.strokeStyle === theme.colors.onAccent).length;
    ui.destroy();
    return n;
  };

  it("draws a light line across the top only where the label is light", async () => {
    const { lightTheme, darkTheme, studioLightTheme, studioDarkTheme } = await import("../src/theme");
    expect(shines(lightTheme)).toBe(1);
    expect(shines(studioLightTheme)).toBe(1);
    // Dark themes put a dark label on a light accent: a dark line there looked like a seam.
    expect(shines(darkTheme)).toBe(0);
    expect(shines(studioDarkTheme)).toBe(0);
  });
});

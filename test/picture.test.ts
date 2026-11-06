/**
 * picture(): the screen as it is now, drawn onto a new canvas for saving as
 * an image. It needs a document to make the canvas, so these tests lend it
 * one that hands out recording canvases.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeCanvas, render, type DrawOp } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";
import { MAX_PICTURE_WIDTH } from "../src/engine";

let made: FakeCanvas[] = [];
const g = globalThis as { document?: unknown };
let saved: unknown;

beforeEach(() => {
  made = [];
  saved = g.document;
  g.document = { createElement: () => { const c = new FakeCanvas(); made.push(c); return c; } };
});
afterEach(() => { g.document = saved; });

const textsIn = (ops: DrawOp[]) => ops.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));

describe("picture", () => {
  it("draws the current state, not the spec's starting values, at twice the sharpness", async () => {
    const ui = render(`state n=1\ncard\n  text "Count: {n}"\n  button "Add" on=inc:n\n`, { width: 400 });
    ui.press({ type: "button", text: "Add" });
    ui.press({ type: "button", text: "Add" });
    const out = (await ui.sayshape.picture()) as unknown as FakeCanvas;
    expect(out).toBe(made[0]);
    expect(out.width).toBe(400 * 2);
    expect(out.height).toBe(Math.round(ui.sayshape.boxes!.h * 2));
    expect(textsIn(out.takeDrawOps())).toContain("Count: 3");
    ui.destroy();
  });

  it("follows the pixel ratio it's given", async () => {
    const ui = render(`text "Hi"\n`, { width: 300 });
    const out = await ui.sayshape.picture({ pixelRatio: 3 });
    expect(out.width).toBe(900);
    ui.destroy();
  });

  it("fills the background with the theme's surface, under everything else", async () => {
    for (const theme of [lightTheme, darkTheme]) {
      const ui = render(`text "Hi"\n`, { theme });
      const ops = ((await ui.sayshape.picture()) as unknown as FakeCanvas).takeDrawOps();
      const last = ops[ops.length - 1]!;
      expect(last.op).toBe("fillRect");
      expect(last.fillStyle).toBe(theme.colors.surface);
      ui.destroy();
    }
    const ui = render(`text "Hi"\n`);
    const ops = ((await ui.sayshape.picture({ background: false })) as unknown as FakeCanvas).takeDrawOps();
    expect(ops.some((o) => o.op === "fillRect" && o.fillStyle === lightTheme.colors.surface)).toBe(false);
    ui.destroy();
  });

  it("leaves out notices, and shows the screen people are on", async () => {
    const ui = render(`screen name=a\n  text "First"\n  button "Next" on=go:b\nscreen name=b\n  text "Second"\n`);
    ui.press({ type: "button", text: "Next" });
    ui.sayshape.notify("Sent to the assistant");
    ui.sayshape.renderNow();
    expect(textsIn(ui.drawOps)).toContain("Sent to the assistant");
    const texts = textsIn(((await ui.sayshape.picture()) as unknown as FakeCanvas).takeDrawOps());
    expect(texts).toContain("Second");
    expect(texts).not.toContain("First");
    expect(texts).not.toContain("Sent to the assistant");
    ui.destroy();
  });

  it("doesn't change the screen it was taken from", async () => {
    const ui = render(`state n=4\ntext "n is {n}"\n`);
    const before = ui.sayshape.state.snapshot();
    await ui.sayshape.picture();
    expect(ui.sayshape.state.snapshot()).toEqual(before);
    expect(ui.emitted).toEqual([]);
    ui.destroy();
  });
});

describe("destroy", () => {
  it("stops a destroyed engine from asking for more frames", () => {
    const g2 = globalThis as { requestAnimationFrame?: unknown };
    const had = g2.requestAnimationFrame;
    let asked = 0;
    g2.requestAnimationFrame = () => ++asked;
    try {
      const ui = render(`text "Hi"\n`);
      ui.destroy();
      asked = 0;
      ui.sayshape.invalidate("layout");
      ui.sayshape.notify("late");
      expect(asked).toBe(0);
    } finally {
      g2.requestAnimationFrame = had;
    }
  });
});

describe("picture of a table that scrolls sideways", () => {
  const WIDE = `state rows=[{id: "A-1042", customer: "Ada Lovelace", city: "London", total: 1290, status: "Shipped", carrier: "Royal Mail", note: "Leave at the front desk"}, {id: "A-1043", customer: "Grace Hopper", city: "Arlington", total: 540, status: "Pending", carrier: "UPS", note: "Call on arrival"}]
table "Orders" items=rows key=id
  table-column "Order" field=id
  table-column "Customer" field=customer
  table-column "City" field=city
  table-column "Total" field=total format=money
  table-column "Status" field=status
  table-column "Carrier" field=carrier
  table-column "Delivery note" field=note
`;

  it("draws the screen wider, so every column is in the image", async () => {
    const ui = render(WIDE, { width: 360 });
    const scroll = (ui.find("table").box!.data as { scroll?: { max: number } }).scroll;
    expect(scroll?.max).toBeGreaterThan(0);
    expect(ui.sayshape.hiddenWidth()).toBeCloseTo(scroll!.max);
    const out = (await ui.sayshape.picture({ pixelRatio: 1 })) as unknown as FakeCanvas;
    expect(out.width).toBeGreaterThanOrEqual(360 + scroll!.max - 1);
    const texts = textsIn(out.takeDrawOps());
    expect(texts).toEqual(expect.arrayContaining(["Delivery note", "Leave at the front desk", "Call on arrival"]));
    // The screen itself still scrolls, at its own width.
    expect(ui.sayshape.hiddenWidth()).toBeGreaterThan(0);
    ui.destroy();
  });

  it("keeps the screen's width with widen: false", async () => {
    const ui = render(WIDE, { width: 360 });
    const out = await ui.sayshape.picture({ pixelRatio: 1, widen: false });
    expect(out.width).toBe(360);
    ui.destroy();
  });

  it("leaves a screen that doesn't scroll at its own width", async () => {
    const ui = render(`text "Hi"\n`, { width: 360 });
    expect(ui.sayshape.hiddenWidth()).toBe(0);
    expect((await ui.sayshape.picture({ pixelRatio: 1 })).width).toBe(360);
    ui.destroy();
  });

  it("never draws wider than MAX_PICTURE_WIDTH", async () => {
    const cols = Array.from({ length: 8 }, (_v, i) => `  table-column "Column ${i}" field=f${i}`).join("\n");
    const long = "x".repeat(200);
    const row = `{${Array.from({ length: 8 }, (_v, i) => `f${i}: "${long}"`).join(", ")}}`;
    const ui = render(`state rows=[${row}]\ntable items=rows\n${cols}\n`, { width: 360 });
    const out = await ui.sayshape.picture({ pixelRatio: 1 });
    expect(out.width).toBeLessThanOrEqual(MAX_PICTURE_WIDTH);
    ui.destroy();
  });
});

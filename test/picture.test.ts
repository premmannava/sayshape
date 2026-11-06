/**
 * picture(): the screen as it is now, drawn onto a new canvas for saving as
 * an image. It needs a document to make the canvas, so these tests lend it
 * one that hands out recording canvases.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeCanvas, render, type DrawOp } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";

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

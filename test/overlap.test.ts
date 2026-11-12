/** overlap: later children drawn on top of the first, at a corner, an edge or the middle. */
import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import type { Box } from "../src/types";

const spec = (at: string, tops = `  badge "Sale" tone=bad\n`) => `overlap at=${at}\n  card\n    text "Trail runner socks" weight=semibold\n    text "Three pairs" tone=muted\n${tops}`;
const boxes = (at: string, tops?: string) => {
  const ui = render(spec(at, tops), { width: 400 });
  const o = ui.find({ type: "overlap" }).box as Box;
  return { ui, o, base: o.children[0]!, top: o.children[1]!, all: o.children };
};

describe("overlap", () => {
  it("puts a badge on the first child's corner, inside it", () => {
    const { ui, o, base, top } = boxes("top-right");
    expect(ui.diagnostics).toEqual([]);
    expect(o.h).toBe(base.h);
    expect(top.w).toBeLessThan(base.w / 2);
    expect(top.x + top.w).toBe(o.x + o.w - 8);
    expect(top.y).toBe(o.y + 8);
  });

  it("places by corner, edge and middle", () => {
    const bl = boxes("bottom-left");
    expect(bl.top.x).toBe(bl.o.x + 8);
    expect(bl.top.y + bl.top.h).toBe(bl.o.y + bl.o.h - 8);
    const c = boxes("center");
    expect(Math.round(c.top.x + c.top.w / 2)).toBe(Math.round(c.o.x + c.o.w / 2));
    expect(Math.round(c.top.y + c.top.h / 2)).toBe(Math.round(c.o.y + c.o.h / 2));
  });

  it("stacks several on top without them touching, and draws them after the first", () => {
    const { all, ui } = boxes("top-left", `  badge "New"\n  badge "Sale" tone=bad\n`);
    expect(all.length).toBe(3);
    expect(all[2]!.y).toBeGreaterThanOrEqual(all[1]!.y + all[1]!.h);
    const words = ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));
    expect(words.indexOf("Sale")).toBeGreaterThan(words.indexOf("Trail runner socks"));
  });

  it("grows to hold what's on top, and takes no room when empty", () => {
    const { o, all } = boxes("top-right", `  card\n    text "A much taller thing on top"\n    text "with more lines"\n    text "and more"\n    text "and more still"\n`);
    for (const b of all) expect(b.y + b.h).toBeLessThanOrEqual(o.y + o.h);
    expect((render(`overlap\n`, { width: 400 }).find({ type: "overlap" }).box as Box).h).toBe(0);
  });

  it("presses what's on top, not what's under it", () => {
    const ui = render(`state hit=''\noverlap at=center\n  card on=set:hit:'card'\n    text "Under"\n    text "More"\n    text "More"\n  button "Top" on=set:hit:'top'\n`, { width: 400 });
    ui.press({ type: "button" });
    expect(ui.state.hit).toBe("top");
  });
});

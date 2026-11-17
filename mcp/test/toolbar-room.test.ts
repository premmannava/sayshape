import { describe, expect, it } from "vitest";
import { render } from "../../src/testing";
import { needsToolbarRow } from "../src/ui/toolbar-room";
import { toolbarWidth } from "../src/ui/theme-selection";

const BAR = { w: toolbarWidth({ picker: false, copy: true, save: true, theme: "teal" }), h: 38 };
// Letters 7px wide: enough to tell a short title from a long line.
const measure = (t: string): number => t.length * 7;

function needs(spec: string, width = 400): boolean {
  const r = render(spec, { width, bareRootCard: true });
  return needsToolbarRow(r.sayshape.boxes, width, BAR, measure);
}

describe("needsToolbarRow", () => {
  it("gives the tools a row when a tabs row spans the width", () => {
    expect(needs('tabs\n  tab "One"\n    text "a"\n  tab "Two"\n    text "b"')).toBe(true);
  });
  it("keeps the overlay for a short title at the left", () => {
    expect(needs('column\n  text "Trip" style=title\n  text "Below the tools"')).toBe(false);
  });
  it("gives the tools a row for a title that runs under them", () => {
    expect(needs('text "A very long title that runs all the way across the top of the interface"')).toBe(true);
  });
  it("counts nested leaves inside a card at the corner", () => {
    expect(needs('card\n  column\n    tabs\n      tab "One"\n        text "a"')).toBe(true);
  });
  it("treats text as its whole box without a measurer", () => {
    const r = render('text "Trip"', { width: 400 });
    expect(needsToolbarRow(r.sayshape.boxes, 400, BAR)).toBe(true);
  });
  it("has nothing to avoid with no interface or a spacer", () => {
    expect(needs("spacer")).toBe(false);
    expect(needsToolbarRow(null, 400, BAR)).toBe(false);
  });
});

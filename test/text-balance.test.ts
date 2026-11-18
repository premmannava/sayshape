/** Headings (text style=title and display) wrap onto lines of even length. */
import { describe, expect, it } from "vitest";
import { balanceText, MAX_BALANCED_LINES, MonoMeasurer, wrapText } from "../src/text";
import { render } from "../src/testing";

const m = new MonoMeasurer();
const F = "600 20px sans-serif";
const HEADING = "Daily protein target of 128 g protein";

describe("balanceText", () => {
  it("never leaves one word alone on the last line when the greedy wrap would", () => {
    // Wide enough for all but the last word on line one.
    const width = m.width("Daily protein target of 128 g", F) + 2;
    expect(wrapText(HEADING, width, F, m).at(-1)).toBe("protein");
    const lines = balanceText(HEADING, width, F, m);
    expect(lines).toHaveLength(2);
    expect(lines.at(-1)!.split(" ").length).toBeGreaterThan(1);
    const widths = lines.map((l) => m.width(l, F));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(m.width("protein", F));
  });

  it("keeps the same number of lines, inside the width, without breaking words", () => {
    for (const width of [120, 180, 240, 320, 400]) {
      const greedy = wrapText(HEADING, width, F, m), even = balanceText(HEADING, width, F, m);
      expect(even).toHaveLength(greedy.length);
      for (const l of even) expect(m.width(l, F)).toBeLessThanOrEqual(width);
      expect(even.join(" ")).toBe(greedy.join(" "));
    }
  });

  it("leaves one line, separate paragraphs and long wraps as they are", () => {
    expect(balanceText("Short", 400, F, m)).toEqual(["Short"]);
    expect(balanceText("One two\nthree", 400, F, m)).toEqual(["One two", "three"]);
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    expect(wrapText(long, 120, F, m).length).toBeGreaterThan(MAX_BALANCED_LINES);
    expect(balanceText(long, 120, F, m)).toEqual(wrapText(long, 120, F, m));
  });
});

describe("text headings", () => {
  const lines = (style: string, width: number) => {
    const ui = render(`text "${HEADING}" style=${style}\n`, { width });
    const out = (ui.find("text").box!.data as { lines: string[] }).lines;
    ui.destroy();
    return out;
  };
  it("balances title and display, and leaves body text greedy", () => {
    for (const width of [240, 300, 360]) {
      for (const style of ["title", "display"]) {
        const l = lines(style, width);
        if (l.length > 1 && l.length <= MAX_BALANCED_LINES) expect(l.at(-1)!.includes(" "), `${style} at ${width}: ${JSON.stringify(l)}`).toBe(true);
      }
    }
    const body = lines("body", 300);
    const ui = render(`text "${HEADING}"\n`, { width: 300 });
    expect(body).toEqual((ui.find("text").box!.data as { lines: string[] }).lines);
    ui.destroy();
  });
});

import { describe, expect, it } from "vitest";
import { render } from "../src/testing";

const box = (ui: ReturnType<typeof render>, line: number) => ui.find({ line }).box!;

/** Two cards side by side: one short, one tall (four lines). */
const cards = (container: string) => `${container}
  card
    text "Short"
  card
    text "Tall"
    text "Second"
    text "Third"
    text "Fourth"`;

describe("cards side by side keep their own height unless stretch=true", () => {
  it("grid: natural heights, top-aligned; stretch=true shares the tallest", () => {
    const loose = render(cards("grid min=150"), { width: 600 });
    expect(box(loose, 2).y).toBe(box(loose, 4).y);
    expect(box(loose, 2).h).toBeLessThan(box(loose, 4).h);
    const even = render(cards("grid min=150 stretch=true"), { width: 600 });
    expect(box(even, 2).h).toBe(box(even, 4).h);
    expect(even.diagnostics).toEqual([]);
  });

  it("row: natural heights, top-aligned; stretch=true shares the tallest", () => {
    const loose = render(cards("row"), { width: 600 });
    expect(box(loose, 2).y).toBe(box(loose, 4).y);
    expect(box(loose, 2).h).toBeLessThan(box(loose, 4).h);
    const even = render(cards("row stretch=true"), { width: 600 });
    expect(box(even, 2).h).toBe(box(even, 4).h);
    expect(even.diagnostics).toEqual([]);
  });

  it("row: align= written still places a line of cards", () => {
    const bottom = render(cards("row align=bottom"), { width: 600 });
    const [s, t] = [box(bottom, 2), box(bottom, 4)];
    expect(s.y + s.h).toBeCloseTo(t.y + t.h, 5);
    expect(s.h).toBeLessThan(t.h);
    const center = render(cards("row align=center"), { width: 600 });
    const [c, d] = [box(center, 2), box(center, 4)];
    expect(c.y + c.h / 2).toBeCloseTo(d.y + d.h / 2, 5);
  });

  it("row fit=true follows the same rule", () => {
    const loose = render(cards("row fit=true"), { width: 600 });
    expect(box(loose, 2).h).toBeLessThan(box(loose, 4).h);
    expect(box(loose, 2).y).toBe(box(loose, 4).y);
    const even = render(cards("row fit=true stretch=true"), { width: 600 });
    expect(box(even, 2).h).toBe(box(even, 4).h);
  });
});

import { describe, expect, it } from "vitest";
import { ClickCounter, MULTI_CLICK_MS, wordBounds } from "../src/text-layer/gesture";

describe("click counting", () => {
  it("counts presses close in time and place, up to three, then starts over", () => {
    const c = new ClickCounter();
    expect([c.press(10, 10, 0, 0), c.press(11, 10, 100, 0), c.press(10, 11, 200, 0), c.press(10, 10, 300, 0)]).toEqual([1, 2, 3, 1]);
  });
  it("starts over after a pause, a move or another button", () => {
    const c = new ClickCounter();
    c.press(10, 10, 0, 0);
    expect(c.press(10, 10, MULTI_CLICK_MS + 1, 0)).toBe(1);
    expect(c.press(40, 10, MULTI_CLICK_MS + 50, 0)).toBe(1);
    expect(c.press(40, 10, MULTI_CLICK_MS + 80, 2)).toBe(1);
  });
});

describe("the word at an offset", () => {
  const word = (t: string, o: number) => { const w = wordBounds(t, o); return w ? t.slice(w[0], w[1]) : null; };
  it("finds the word the offset is in, or just after", () => {
    expect(word("Weekend plan", 2)).toBe("Weekend");
    expect(word("Weekend plan", 7)).toBe("Weekend");
    expect(word("Weekend plan", 9)).toBe("plan");
    expect(word("Weekend plan", 12)).toBe("plan");
  });
  it("keeps numbers and contractions whole", () => {
    expect(word("Total $1,200.00 today", 8)).toBe("1,200.00");
    expect(word("don't stop", 2)).toBe("don't");
    expect(word("well-known fact", 3)).toBe("well-known");
  });
  it("finds no word on spaces between words or punctuation alone", () => {
    expect(word("a   b", 2)).toBeNull();
    expect(word("— —", 1)).toBeNull();
    expect(word("", 0)).toBeNull();
  });
  it("counts offsets in UTF-16 units across emoji", () => {
    expect(word("😀 hello", 4)).toBe("hello");
  });
});

import { describe, expect, it } from "vitest";
import { GLASS_CACHE_MAX, GlassCache, glassAlpha, glassTheme, type ScratchCanvas } from "../src/glass";
import { darkTheme, forcedColorsTheme, lightTheme, studioDarkTheme, studioLightTheme, type Theme } from "../src/theme";
import { applyLook } from "../src/look";
import { blendOver } from "../src/scrim";
import { contrastRatio } from "../src/contrast";

type Call = { op: string; args: unknown[]; filter?: string };

/** A 2D context with just what glass reads: a filter, a canvas with pixels, and a transform. */
function fakeContext(scale: number, calls: Call[], size = { width: 1200, height: 800 }) {
  let filter = "none";
  let m = { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 };
  const g = {
    canvas: size,
    get filter() { return filter; },
    set filter(v: string) { filter = v; },
    getTransform: () => ({ ...m }),
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => { m = { a, b, c, d, e, f }; },
    save: () => calls.push({ op: "save", args: [] }),
    restore: () => { calls.push({ op: "restore", args: [] }); m = { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 }; },
    clip: () => calls.push({ op: "clip", args: [] }),
    drawImage: (...args: unknown[]) => calls.push({ op: "drawImage", args }),
  };
  return g as unknown as CanvasRenderingContext2D;
}

function scratchMaker(calls: Call[]) {
  const made: ScratchCanvas[] = [];
  const make = (): ScratchCanvas => {
    let filter = "none";
    const ctx = {
      setTransform: () => {},
      clearRect: () => {},
      get filter() { return filter; },
      set filter(v: string) { filter = v; },
      drawImage: (...args: unknown[]) => calls.push({ op: "copy", args, filter }),
    };
    const s = { width: 0, height: 0, getContext: () => ctx as unknown as CanvasRenderingContext2D };
    made.push(s);
    return s;
  };
  return { make, made };
}

const BOX = { x: 20, y: 30, w: 200, h: 100 };

describe("glass backdrop", () => {
  it("copies the right device rectangle at a pixel ratio of 2, blurred, and draws it back clipped", () => {
    const calls: Call[] = [];
    const { make } = scratchMaker(calls);
    const cache = new GlassCache(make);
    let traced = 0;
    expect(cache.draw(fakeContext(2, calls), "c1", BOX, 10, () => traced++, 1, true)).toBe(true);
    const copy = calls.find((c) => c.op === "copy")!;
    // (20, 30) to (220, 130) at 2x, padded by the blur (10 * 2) on every side.
    expect(copy.args.slice(1)).toEqual([20, 40, 440, 240, 0, 0, 440, 240]);
    expect(copy.filter).toBe("blur(20px)");
    expect(traced).toBe(1);
    const back = calls.find((c) => c.op === "drawImage")!;
    expect(back.args.slice(1)).toEqual([20, 40]);
    expect(calls.findIndex((c) => c.op === "clip")).toBeLessThan(calls.findIndex((c) => c.op === "drawImage"));
  });

  it("cuts the copy to the canvas", () => {
    const calls: Call[] = [];
    const cache = new GlassCache(scratchMaker(calls).make);
    cache.draw(fakeContext(1, calls, { width: 100, height: 100 }), "c1", { x: -50, y: 60, w: 300, h: 100 }, 10, () => {}, 1, true);
    expect(calls.find((c) => c.op === "copy")!.args.slice(1, 5)).toEqual([0, 50, 100, 50]);
  });

  it("blurs once while nothing changes, and again when the place or the generation does", () => {
    const calls: Call[] = [];
    const cache = new GlassCache(scratchMaker(calls).make);
    const g = fakeContext(2, calls);
    const copies = () => calls.filter((c) => c.op === "copy").length;
    cache.draw(g, "c1", BOX, 10, () => {}, 1, true);
    cache.draw(g, "c1", BOX, 10, () => {}, 1, true);
    expect(copies()).toBe(1);
    expect(calls.filter((c) => c.op === "drawImage")).toHaveLength(2);
    cache.draw(g, "c1", { ...BOX, y: 31 }, 10, () => {}, 1, true);
    expect(copies()).toBe(2);
    cache.draw(g, "c1", { ...BOX, y: 31 }, 10, () => {}, 2, true);
    expect(copies()).toBe(3);
    // Something earlier is animating: copied, and not kept for the next frame.
    cache.draw(g, "c1", { ...BOX, y: 31 }, 10, () => {}, 2, false);
    cache.draw(g, "c1", { ...BOX, y: 31 }, 10, () => {}, 2, true);
    expect(copies()).toBe(5);
    expect(cache.copies).toBe(5);
  });

  it(`keeps at most ${GLASS_CACHE_MAX} cards, the most recently used`, () => {
    const calls: Call[] = [];
    const cache = new GlassCache(scratchMaker(calls).make);
    const g = fakeContext(1, calls);
    for (let i = 0; i < GLASS_CACHE_MAX + 4; i++) cache.draw(g, `c${i}`, BOX, 10, () => {}, 1, true);
    expect(cache.size).toBe(GLASS_CACHE_MAX);
    // The newest is still kept; the first was let go and is copied again.
    cache.draw(g, `c${GLASS_CACHE_MAX + 3}`, BOX, 10, () => {}, 1, true);
    expect(cache.copies).toBe(GLASS_CACHE_MAX + 4);
    cache.draw(g, "c0", BOX, 10, () => {}, 1, true);
    expect(cache.copies).toBe(GLASS_CACHE_MAX + 5);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("says no, drawing nothing, without a filter, a canvas or a scratch canvas", () => {
    const calls: Call[] = [];
    const noFilter = { ...fakeContext(1, calls), filter: undefined } as unknown as CanvasRenderingContext2D;
    expect(new GlassCache(scratchMaker(calls).make).draw(noFilter, "c", BOX, 10, () => {}, 1, true)).toBe(false);
    const noCanvas = Object.assign(fakeContext(1, calls), { canvas: undefined }) as unknown as CanvasRenderingContext2D;
    expect(new GlassCache(scratchMaker(calls).make).draw(noCanvas, "c", BOX, 10, () => {}, 1, true)).toBe(false);
    expect(new GlassCache(() => null).draw(fakeContext(1, calls), "c", BOX, 10, () => {}, 1, true)).toBe(false);
    expect(calls).toEqual([]);
  });
});

const THEMES: Array<[string, Theme]> = [
  ["light", lightTheme], ["dark", darkTheme], ["studio light", studioLightTheme], ["studio dark", studioDarkTheme],
  ["bold light", applyLook(lightTheme, { mood: "bold" })], ["bold dark", applyLook(darkTheme, { mood: "bold" })],
];

describe("glass tint", () => {
  it("keeps ink and the other text colors at AA over a black and a white backdrop", () => {
    for (const [name, theme] of THEMES) {
      const inside = glassTheme(theme);
      const { blur, fallback } = glassAlpha(inside);
      expect(fallback, name).toBeGreaterThan(blur);
      for (const alpha of [blur, fallback]) {
        for (const level of [0, 255]) {
          const [r, g, b] = blendOver(inside.colors.raised, alpha, level);
          const bg = `rgb(${r}, ${g}, ${b})`;
          for (const key of ["ink", "muted", "accent", "good", "warn", "bad"] as const) {
            expect(contrastRatio(inside.colors[key], bg), `${name} ${key} over ${level} at ${alpha}`).toBeGreaterThanOrEqual(4.55);
          }
        }
      }
    }
  });

  it("is translucent, and the same theme in gives the same theme out", () => {
    for (const [name, theme] of THEMES) expect(glassAlpha(theme).blur, name).toBeLessThan(1);
    expect(glassTheme(lightTheme)).toBe(glassTheme(lightTheme));
  });

  it("leaves a forced-colors theme alone", () => {
    const forced = forcedColorsTheme(lightTheme, (s) => (s === "Canvas" ? "#000000" : "#FFFFFF"));
    expect(glassTheme(forced)).toBe(forced);
  });
});

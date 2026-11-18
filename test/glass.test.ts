import { describe, expect, it } from "vitest";
import { GLASS_CACHE_MAX, GlassCache, glassAlpha, glassTheme, type ScratchCanvas } from "../src/glass";
import { darkTheme, forcedColorsTheme, lightTheme, studioDarkTheme, studioLightTheme, type Theme } from "../src/theme";
import { applyLook } from "../src/look";
import { blendOver } from "../src/scrim";
import { contrastRatio } from "../src/contrast";
import { fillOf } from "../src/fills";
import { card } from "../src/components/layout";
import { coreComponents } from "../src/components";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { PropReader, type PaintContext } from "../src/component";
import { GLASS_BLUR } from "../src/glass";
import { createRecordingContext, render } from "../src/testing";
import type { Box } from "../src/types";

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

const DOCK = `image "Desert at dusk" src="https://images.unsplash.com/photo-1" ratio=16:9
  row
    card variant=glass
      text "Music" weight=semibold
      text "Playing" tone=muted
    card variant=glass
      text "Maps" weight=semibold
      text "12 min home" tone=muted`;

/** The alphas of the glass tint fills (raised, no gradient) the card draws. */
function tints(ui: ReturnType<typeof render>, raised: string): number[] {
  return ui.drawOps.filter((op) => op.op === "fill" && !op.gradientStops && op.fillStyle === raised).map((op) => op.globalAlpha);
}

describe("card variant=glass", () => {
  it.each([["light", lightTheme], ["dark", darkTheme]] as const)("falls back to a stronger tint with no blur on a canvas without filters (%s)", (_n, theme) => {
    const ui = render(`card variant=glass\n  text "Now playing" weight=semibold\n  text "Side A" tone=muted`, { theme });
    expect(ui.drawOps.some((op) => op.op === "drawImage")).toBe(false);
    expect(tints(ui, theme.colors.raised)).toEqual([glassAlpha(theme).fallback]);
    const inside = glassTheme(theme).colors;
    expect(ui.drawOps.find((op) => op.op === "fillText" && op.args[0] === "Side A")!.fillStyle).toBe(inside.muted);
    // No shadow: a shadow under a see-through card would darken what shows through.
    expect(ui.drawOps.filter((op) => op.op === "fill").length).toBe(1);
    ui.destroy();
  });

  it("draws a dock-style row of glass cards over a picture in light and dark", () => {
    for (const theme of [lightTheme, darkTheme]) {
      const ui = render(DOCK, { theme, imageHosts: ["images.unsplash.com"] });
      expect(ui.diagnostics ?? []).toEqual([]);
      expect(ui.text()).toEqual(expect.arrayContaining(["Music", "Playing", "Maps", "12 min home"]));
      ui.destroy();
    }
  });

  it("is solid for a person who prefers less transparency", () => {
    const ui = render(`card variant=glass\n  text "Hi"`, { theme: lightTheme, reducedTransparency: true });
    expect(tints(ui, lightTheme.colors.raised)).toEqual([1]);
    ui.destroy();
  });

  it("uses the lighter tint when the engine blurred the backdrop", () => {
    const reg = new Registry(coreComponents);
    const node = parse(`card variant=glass\n  text "Hi"`, reg).root.children[0]!;
    const { context, take } = createRecordingContext();
    const box: Box = { node, x: 0, y: 0, w: 300, h: 120, children: [] };
    let asked = 0;
    const ctx = {
      g: context, theme: lightTheme, scope: {}, now: 0,
      props: (n: typeof node) => new PropReader(n, {} as never),
      roundRect: () => {}, tween: () => 0, isHovered: () => false, isPressed: () => false, addHit: () => {},
      backdrop: (_b: Box, path: () => void, blur: number) => { asked = blur; path(); return true; },
    } as unknown as PaintContext;
    card.paint!(box, ctx);
    expect(asked).toBe(GLASS_BLUR);
    expect(take().filter((op) => op.op === "fill").map((op) => op.globalAlpha)).toEqual([glassAlpha(lightTheme).blur]);
  });

  it("warns when fill= and variant=glass are written together, and the fill wins", () => {
    const reg = new Registry(coreComponents);
    const r = parse(`card fill=sky variant=glass\n  text "Hi"`, reg);
    expect(r.diagnostics.find((d) => d.message.includes("variant=glass"))).toMatchObject({ line: 1, severity: "warning" });
    const ui = render(`card fill=sky variant=glass\n  text "Hi"`, { theme: lightTheme });
    expect(ui.drawOps.some((op) => op.gradientStops?.[0]?.color === fillOf(lightTheme, "sky")!.from)).toBe(true);
    ui.destroy();
  });

  it("warns for an unknown variant with its line", () => {
    const r = parse(`text "a"\ncard variant=frosted\n  text "Hi"`, new Registry(coreComponents));
    expect(r.diagnostics.find((d) => d.message.includes("variant"))).toMatchObject({ line: 2, severity: "warning" });
  });

  it("is a plain raised card in a forced-colors mode", () => {
    const forced = forcedColorsTheme(lightTheme, (s) => (s === "Canvas" ? "#FFFFFF" : "#000000"));
    const ui = render(`card variant=glass\n  text "Hi"`, { theme: forced });
    expect(tints(ui, forced.colors.raised).every((a) => a === 1)).toBe(true);
    ui.destroy();
  });
});

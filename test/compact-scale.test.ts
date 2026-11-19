import { describe, expect, it } from "vitest";
import { applyLook, compactPatch, lookKey, type AppliedLook } from "../src/look";
import { themeFromTokens } from "../src/host-tokens";
import { slideTheme } from "../src/components/slides/theme";
import { darkTheme, DEFAULT_SIZES, extendTheme, forcedColorsTheme, lightTheme, PHONE_WIDTH, sizesOf, smallControlOf, type Theme } from "../src/theme";
import { render } from "../src/testing";

const CHAT: AppliedLook = { density: "chat", surface: "lines" };
const PHONE: AppliedLook = { ...CHAT, screen: "phone" };

const DESKTOP_SIZES = {
  listPadX: 12, listPadY: 8, listIcon: 18, listIconGap: 10, accordionHeader: 36, statLabel: 12, pill: 18, badge: 20,
  label: 13, labelGap: 4, fieldPadX: 10, fieldText: 14, segmented: 32, segmentedPadX: 12, calloutAction: 28,
  calloutIcon: 16, emptyIcon: 32, emptyButton: 32, emptyPad: 12, plotMin: 144,
};
const PHONE_SIZES = { ...DESKTOP_SIZES, accordionHeader: 44, fieldText: 16, segmented: 34, emptyButton: 34, plotMin: 120 };

/** Resize a live engine, the way a host's container would, and lay it out again. */
function resize(ui: ReturnType<typeof render>, width: number): void {
  (ui.sayshape as unknown as { opts: { width?: number } }).opts.width = width;
  ui.sayshape.invalidate("layout");
  ui.sayshape.renderNow();
}

describe("the compact scale", () => {
  it.each([["light", lightTheme], ["dark", darkTheme]] as Array<[string, Theme]>)("gives the prototype's numbers on a desktop over the %s theme", (_n, base) => {
    const t = applyLook(base, CHAT);
    expect(t.text).toEqual({ caption: 12, body: 14, lead: 15, title: 18, display: 24 });
    expect(t.control).toEqual({ height: 32, small: 23 });
    expect(t.space).toEqual({ xs: 4, sm: 6, md: 10, lg: 12, xl: 18 });
    expect(t.radius).toEqual({ sm: 6, md: 8, lg: 10 });
    expect(t.gaps).toEqual({ column: 6, row: 8, grid: 8 });
    expect(t.listInline).toBe(true);
    expect(t.sizes).toEqual(DESKTOP_SIZES);
    expect(sizesOf(t)).toEqual(DESKTOP_SIZES);
    expect(t.scale).toBe("compact");
    expect(t.surfaces).toBe("lines");
    // Hairline: cards take the page's color.
    expect(t.colors.raised).toBe(base.colors.surface);
    // Everything else about the colors stays the host's.
    expect({ ...t.colors, raised: base.colors.raised }).toEqual(base.colors);
  });

  it.each([["light", lightTheme], ["dark", darkTheme]] as Array<[string, Theme]>)("gives the prototype's numbers on a phone over the %s theme", (_n, base) => {
    const t = applyLook(base, PHONE);
    expect(t.text).toEqual({ caption: 12, body: 14, lead: 15, title: 17, display: 22 });
    expect(t.control).toEqual({ height: 34, small: 24 });
    expect(t.space).toEqual({ xs: 4, sm: 6, md: 10, lg: 12, xl: 18 });
    expect(t.radius).toEqual({ sm: 6, md: 8, lg: 10 });
    expect(t.gaps).toEqual({ column: 6, row: 8, grid: 8 });
    expect(t.sizes).toEqual(PHONE_SIZES);
    expect(t.surfaces).toBe("lines");
  });

  it("scales from the host's own tokens", () => {
    const big = extendTheme(lightTheme, { text: { caption: 13, body: 16, lead: 18, title: 24, display: 36 }, control: { height: 48 } });
    const t = applyLook(big, CHAT);
    expect(t.text).toEqual({ caption: 13, body: 16, lead: 17, title: 22, display: 29 });
    expect(t.control).toEqual({ height: 38, small: 27 });
  });

  it("does nothing more when applied to a theme it already made", () => {
    const once = extendTheme(lightTheme, compactPatch(lightTheme));
    expect(compactPatch(once)).toEqual({ listInline: true, gaps: { column: 6, row: 8, grid: 8 } });
    const twice = extendTheme(once, compactPatch(once));
    expect(twice).toEqual(once);
    // A looked theme passed back in is traced to the host's, with or without a phone.
    for (const look of [CHAT, PHONE, { ...PHONE, type: "editorial" } as AppliedLook]) {
      const t = applyLook(lightTheme, look);
      expect(applyLook(t, look)).toBe(t);
      expect(applyLook(applyLook(lightTheme, PHONE), look)).toBe(t);
    }
  });

  it("keys a look by its surface and screen too", () => {
    expect(lookKey(PHONE)).toBe("density=chat surface=lines screen=phone");
    expect(lookKey({ screen: "phone" })).toBe("screen=phone");
  });

  it("leaves a theme without phone sizes alone on a phone", () => {
    expect(applyLook(lightTheme, { screen: "phone" })).toBe(lightTheme);
    const bold = applyLook(lightTheme, { mood: "bold" });
    expect(applyLook(lightTheme, { mood: "bold", screen: "phone" })).toBe(bold);
  });

  it("keeps editorial's larger headings on a phone", () => {
    const t = applyLook(lightTheme, { ...PHONE, type: "editorial" });
    expect(t.text.display).toBe(Math.round(22 * 1.2));
    expect(t.text.title).toBe(Math.round(17 * 1.1));
  });

  it("keeps surfaces and sizes in a forced-colors mode", () => {
    const system: Record<string, string> = { Canvas: "rgb(0, 0, 0)", CanvasText: "rgb(255, 255, 255)", Highlight: "rgb(26, 235, 255)", HighlightText: "rgb(0, 0, 0)", GrayText: "rgb(63, 242, 63)" };
    const looked = applyLook(lightTheme, PHONE);
    const forced = forcedColorsTheme(looked, (n) => system[n]!);
    expect(forced.surfaces).toBe("lines");
    expect(forced.sizes).toEqual(PHONE_SIZES);
    expect(forced.control).toEqual(looked.control);
    expect(forced.phone).toEqual(looked.phone);
    expect(forced.colors.line).toBe("rgb(255, 255, 255)");
    expect(forced.colors.control).toBe("rgb(255, 255, 255)");
  });

  it("isn't carried into slides, which keep their design sizes", () => {
    const s = slideTheme(applyLook(lightTheme, PHONE));
    expect(s.sizes).toBeUndefined();
    expect(s.phone).toBeUndefined();
    expect(s.scale).toBeUndefined();
    expect(s.gaps).toBeUndefined();
    expect(s.control.height).toBe(lightTheme.slide!.control.height);
    expect(s.text).toEqual(lightTheme.slide!.text);
  });
});

describe("theme sizes", () => {
  it("default to the sizes components drew with before", () => {
    expect(sizesOf(lightTheme)).toEqual(DEFAULT_SIZES);
    expect(sizesOf(lightTheme)).toBe(sizesOf(lightTheme));
    expect(sizesOf(extendTheme(lightTheme, { sizes: { badge: 30 } }))).toEqual({ ...DEFAULT_SIZES, badge: 30 });
    expect(smallControlOf(lightTheme)).toBe(32);
    expect(smallControlOf(applyLook(lightTheme, CHAT))).toBe(23);
  });
});

describe("the engine's phone switch", () => {
  it(`switches to the phone sizes below ${PHONE_WIDTH} px, and back`, () => {
    const ui = render(`text "Hi"`, { context: "chat", width: 600 });
    expect(ui.sayshape.theme.control.height).toBe(32);
    expect(ui.sayshape.theme.surfaces).toBe("lines");
    resize(ui, 599);
    expect(ui.sayshape.theme.control.height).toBe(34);
    expect(sizesOf(ui.sayshape.theme).fieldText).toBe(16);
    resize(ui, 600);
    expect(ui.sayshape.theme.control.height).toBe(32);
    expect(sizesOf(ui.sayshape.theme).fieldText).toBe(14);
    resize(ui, 375);
    expect(ui.sayshape.theme.text.display).toBe(22);
  });

  it("gives a host theme with its own phone group its phone sizes, root gap included", () => {
    const host = { ...lightTheme, phone: { space: { md: 6 } } };
    const spec = `text "One"\ntext "Two"`;
    const gap = (ui: ReturnType<typeof render>) => {
      const [a, b] = ui.sayshape.boxes!.children;
      return b!.y - (a!.y + a!.h);
    };
    const ui = render(spec, { theme: host, width: 1024 });
    expect(ui.sayshape.theme.space.md).toBe(14);
    expect(gap(ui)).toBe(14);
    resize(ui, 375);
    expect(ui.sayshape.theme.space.md).toBe(6);
    expect(gap(ui)).toBe(6);
    resize(ui, 1024);
    expect(gap(ui)).toBe(14);
  });

  it("keeps a default host exactly as it was at any width", () => {
    for (const width of [375, 1024]) {
      const ui = render(`text "Hi"`, { width });
      expect(ui.sayshape.theme).toBe(lightTheme);
    }
  });

  it("doesn't shrink a host-token theme again in a chat", () => {
    const own = themeFromTokens({ background: "#FAF9F5", text: "#141413", accent: "#ae5630" });
    expect(own.scale).toBe("compact");
    const desk = render(`text "Hi"`, { theme: own, context: "chat", width: 1024 }).sayshape.theme;
    expect([desk.control, desk.text, desk.space]).toEqual([own.control, own.text, own.space]);
    const phone = render(`text "Hi"`, { theme: own, context: "chat", width: 375 }).sayshape.theme;
    expect(phone.control).toEqual({ height: 34, small: 24 });
    expect(phone.text.display).toBe(22);
    expect(phone.space).toEqual(own.space);
    // Outside a chat it's the same theme, compact already.
    expect(render(`text "Hi"`, { theme: own, width: 1024 }).sayshape.theme.control).toEqual(own.control);
  });
});

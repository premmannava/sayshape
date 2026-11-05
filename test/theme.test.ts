import { describe, expect, it } from "vitest";
import { darkTheme, extendTheme, isDarkTheme, lightTheme, mixColors, parseColor, sliceColors, themeFromCSS } from "../src/theme";

const luma = (c: string) => { const [r, g, b] = parseColor(c)!; return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

describe("theme surfaces", () => {
  it("lift cards above the page in dark, and keep them flush in light", () => {
    expect(lightTheme.colors.raised).toBe(lightTheme.colors.surface);
    expect(luma(darkTheme.colors.raised)).toBeGreaterThan(luma(darkTheme.colors.surface));
    expect(isDarkTheme(darkTheme)).toBe(true);
    expect(isDarkTheme(lightTheme)).toBe(false);
  });

  it("make raised follow a new surface unless it's given too", () => {
    expect(extendTheme(darkTheme, { colors: { surface: "#000000", ink: "#ffffff" } }).colors.raised).toBe("#0b0b0b");
    expect(extendTheme(lightTheme, { colors: { surface: "#fafaf7" } }).colors.raised).toBe("#fafaf7");
    expect(extendTheme(darkTheme, { colors: { surface: "#000000", raised: "#123456" } }).colors.raised).toBe("#123456");
    // Other changes leave it alone.
    expect(extendTheme(darkTheme, { colors: { accent: "#ff0000" } }).colors.raised).toBe(darkTheme.colors.raised);
  });

  it("gives pies a coordinated muted palette in either theme", () => {
    expect(sliceColors(lightTheme).slice(0, 4)).toEqual(["#346167", "#74909d", "#95ada3", "#c0b1a0"]);
    expect(sliceColors(darkTheme).slice(0, 4)).toEqual(["#5ea199", "#9DB8C4", "#A6C4B1", "#CDBC9F"]);
    for (const theme of [lightTheme, darkTheme]) {
      const shades = sliceColors(theme);
      expect(shades).toHaveLength(6);
      expect(new Set(shades).size).toBe(6);
      expect(shades).not.toContain(theme.colors.accent); // accent is reserved for hover
      for (const shade of shades) expect(parseColor(shade)).not.toBeNull();
    }
  });

  it("keeps the chart palette customizable through existing series tokens", () => {
    const host = extendTheme(darkTheme, { colors: { surface: "#222428", ink: "#f5f4ee", accent: "#b8b1e9" } });
    expect(sliceColors(host)[0]).toBe(mixColors(host.colors.raised, host.colors.series1, 0.77));
    expect(sliceColors(host)).not.toEqual(sliceColors(darkTheme));
    const custom = extendTheme(lightTheme, { colors: { series2: "#576e98", series3: "#719276" } });
    expect(sliceColors(custom)[1]).not.toBe(sliceColors(lightTheme)[1]);
    expect(sliceColors(custom)[2]).not.toBe(sliceColors(lightTheme)[2]);
  });

  it("read the colors browsers hand back", () => {
    expect(parseColor("#abc")).toEqual([170, 187, 204, 1]);
    expect(parseColor("rgb(31, 31, 30)")).toEqual([31, 31, 30, 1]);
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30, 0.5]);
    expect(parseColor("rgb(10 20 30 / 50%)")).toEqual([10, 20, 30, 0.5]);
    expect(parseColor("color-mix(in srgb, red, blue)")).toBeNull();
    expect(mixColors("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixColors("rgba(0, 0, 0, 0.5)", "#ffffff", 0.5)).toBeNull();
  });

  it("take raised from CSS, or derive it from a CSS surface", () => {
    const el = {} as Element;
    const vars: Record<string, string> = { "--sayshape-surface": "#000000" };
    const g = globalThis as { getComputedStyle?: unknown };
    const before = g.getComputedStyle;
    g.getComputedStyle = () => ({ getPropertyValue: (n: string) => vars[n] ?? "" });
    try {
      expect(themeFromCSS(el, darkTheme).colors.raised).toBe(mixColors("#000000", darkTheme.colors.ink, 0.045));
      vars["--sayshape-raised"] = "#222222";
      expect(themeFromCSS(el, darkTheme).colors.raised).toBe("#222222");
    } finally {
      g.getComputedStyle = before;
    }
  });
});

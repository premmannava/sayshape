import { describe, expect, it } from "vitest";
import { darkTheme, extendTheme, forcedColorsTheme, isDarkTheme, lightTheme, mixColors, parseColor, seriesColors, sliceColors, studioDarkTheme, studioLightTheme, themeFromCSS } from "../src/theme";
import type { Theme } from "../src/theme";

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
    expect(sliceColors(lightTheme).slice(0, 3)).toEqual(["#186460", "#7b9ee0", "#956c2e"]);
    expect(sliceColors(darkTheme).slice(0, 3)).toEqual(["#81cbc1", "#6D8DE8", "#F5AE4B"]);
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
    expect(sliceColors(host)[0]).toBe(mixColors(host.colors.series1, host.colors.ink, 0.12));
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

// Palette rules, so a later edit can't quietly bring back five grey-blues.
const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toLinear = (c: string): [number, number, number] => { const [r, g, b] = parseColor(c)!; return [lin(r), lin(g), lin(b)]; };
const contrastOf = (a: string, b: string) => {
  const y = (c: string) => { const [r, g, b] = toLinear(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [hi, lo] = [y(a), y(b)].sort((p, q) => q - p);
  return (hi! + 0.05) / (lo! + 0.05);
};
/** Machado et al. (2009), full severity, applied to linear RGB. */
const SIM = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const;
type Vision = "normal" | keyof typeof SIM;
const oklab = (c: string, vision: Vision): [number, number, number] => {
  let rgb = toLinear(c);
  if (vision !== "normal") {
    const m = SIM[vision];
    rgb = m.map((row) => Math.min(1, Math.max(0, row[0]! * rgb[0] + row[1]! * rgb[1] + row[2]! * rgb[2]))) as [number, number, number];
  }
  const [r, g, b] = rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
/** Distance in OKLab, times 100 (about 2 is a just-noticeable difference). */
const apart = (a: string, b: string, vision: Vision) => {
  const x = oklab(a, vision), y = oklab(b, vision);
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
const hueOf = (c: string) => { const [, a, b] = oklab(c, "normal"); return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; };
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const minApart = (colors: string[], vision: Vision) => {
  let m = Infinity;
  colors.forEach((a, i) => colors.slice(i + 1).forEach((b) => { m = Math.min(m, apart(a, b, vision)); }));
  return m;
};

describe.each([["light", lightTheme], ["dark", darkTheme]] as Array<[string, Theme]>)("%s chart palette", (_name, theme) => {
  const series = seriesColors(theme);
  const c = theme.colors;

  it("keeps series 1 as the accent", () => {
    expect(c.series1).toBe(c.accent);
  });

  it("reaches 3:1 against the surface and the raised card", () => {
    for (const s of series) for (const bg of [c.surface, c.raised]) expect(contrastOf(s, bg), `${s} on ${bg}`).toBeGreaterThanOrEqual(3);
  });

  it("keeps series 2 to 6 clear of the good and bad hues", () => {
    for (const s of series.slice(1)) {
      for (const tone of [c.good, c.bad]) expect(hueGap(hueOf(s), hueOf(tone)), `${s} against ${tone}`).toBeGreaterThanOrEqual(25);
    }
  });

  it("keeps every pair of series apart, in normal vision and in three kinds of color blindness", () => {
    expect(minApart(series, "normal")).toBeGreaterThanOrEqual(10);
    for (const v of ["protanopia", "deuteranopia", "tritanopia"] as const) {
      expect(minApart(series, v), v).toBeGreaterThanOrEqual(6);
    }
  });

  it("keeps pie and donut slices apart too", () => {
    const slices = sliceColors(theme);
    expect(minApart(slices, "normal")).toBeGreaterThanOrEqual(10);
    for (const v of ["protanopia", "deuteranopia", "tritanopia"] as const) expect(minApart(slices, v), v).toBeGreaterThanOrEqual(6);
  });

  it("isn't a run of grey-blues: the series use several hues with real color in them", () => {
    const hues = series.slice(1).map(hueOf);
    for (let i = 0; i < hues.length; i++) for (let j = i + 1; j < hues.length; j++) expect(hueGap(hues[i]!, hues[j]!)).toBeGreaterThanOrEqual(20);
    for (const s of series.slice(1)) { const [, a, b] = oklab(s, "normal"); expect(Math.hypot(a, b)).toBeGreaterThanOrEqual(0.08); }
  });
});

describe("warnFill", () => {
  it("is a brighter warn for fills, in every theme", () => {
    for (const t of [lightTheme, darkTheme, studioLightTheme, studioDarkTheme]) {
      const { warn, warnFill, surface, raised } = t.colors;
      expect(warnFill, t.name).not.toBe(warn);
      for (const bg of [surface, raised]) expect(contrastOf(warnFill, bg), `${t.name} warnFill on ${bg}`).toBeGreaterThanOrEqual(isDarkTheme(t) ? 3 : 2.9);
    }
  });
  it("turns into a system color in forced-colors mode", () => {
    const system: Record<string, string> = { Canvas: "rgb(0, 0, 0)", CanvasText: "rgb(255, 255, 255)", Highlight: "rgb(26, 235, 255)", HighlightText: "rgb(0, 0, 0)", GrayText: "rgb(63, 242, 63)" };
    expect(forcedColorsTheme(lightTheme, (n) => system[n]!).colors.warnFill).toBe("rgb(255, 255, 255)");
  });
});

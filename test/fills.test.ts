import { describe, expect, it } from "vitest";
import { darkTheme, extendTheme, forcedColorsTheme, lightTheme, studioDarkTheme, studioLightTheme, type Theme } from "../src/theme";
import { applyLook } from "../src/look";
import { FILLS, fillGradient, fillOf, fillSamples, fillSource, onFillTheme } from "../src/fills";
import { worstContrast } from "../src/contrast";
import { createRecordingContext } from "../src/testing";

const brand = (t: Theme) => extendTheme(t, { colors: { accent: "#2F7FE0", accent2: "#5AB8F5" } });
const THEMES: Array<[string, Theme]> = [
  ["light", lightTheme], ["dark", darkTheme], ["studio light", studioLightTheme], ["studio dark", studioDarkTheme],
  ["bold light", applyLook(lightTheme, { mood: "bold" })], ["bold dark", applyLook(darkTheme, { mood: "bold" })],
  ["brand light", brand(lightTheme)], ["brand dark", brand(darkTheme)],
];

describe("named fills", () => {
  it("text colors read at AA on every part of every fill, in every theme", () => {
    for (const [name, theme] of THEMES) {
      for (const fill of FILLS) {
        const f = fillOf(theme, fill)!;
        expect(f, `${name} ${fill}`).not.toBeNull();
        const bgs = fillSamples(f.from, f.to);
        const c = onFillTheme(theme, fill).colors;
        for (const key of ["ink", "muted", "accent", "good", "warn", "bad"] as const) {
          expect(worstContrast(c[key], bgs), `${name} ${fill} ${key}`).toBeGreaterThanOrEqual(4.55);
        }
        for (const key of ["focus", "control", "series1", "series2"] as const) {
          expect(worstContrast(c[key], bgs), `${name} ${fill} ${key}`).toBeGreaterThanOrEqual(3);
        }
        expect(worstContrast(c.onAccent, [c.accent]), `${name} ${fill} onAccent`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("has a light and a dark value, and night is dark in both", () => {
    for (const fill of FILLS) expect(fillOf(lightTheme, fill), fill).not.toEqual(fillOf(darkTheme, fill));
    expect(onFillTheme(lightTheme, "night").colors.surface).not.toBe(lightTheme.colors.surface);
    expect(onFillTheme(lightTheme, "night").colors.ink).toBe(lightTheme.colors.surface);
    expect(onFillTheme(lightTheme, "sky").colors.ink).toBe(lightTheme.colors.ink);
  });

  it("gives the five fills distinct gradients", () => {
    for (const [name, theme] of THEMES) {
      const ends = FILLS.map((f) => `${fillOf(theme, f)!.from}-${fillOf(theme, f)!.to}`);
      expect(new Set(ends).size, name).toBe(FILLS.length);
    }
  });

  it("takes a host's own ends, and still picks readable text", () => {
    const host = extendTheme(lightTheme, { fills: { sky: { from: "#0B3D91", to: "#1E5BB8" } } });
    const f = fillOf(host, "sky")!;
    expect([f.from, f.to]).toEqual(["#0B3D91", "#1E5BB8"]);
    expect(f.text).toBe(lightTheme.colors.surface);
  });

  it("moves the ends away from the text when nothing reads on them", () => {
    // A mid gray: neither ink nor white holds AA until the ends move.
    const host = extendTheme(lightTheme, { fills: { sky: { from: "#808080", to: "#7A7A7A" } } });
    const f = fillOf(host, "sky")!;
    expect(f.from).not.toBe("#808080");
    expect(worstContrast(f.text, fillSamples(f.from, f.to))).toBeGreaterThanOrEqual(4.55);
  });

  it("leaves a forced-colors theme alone", () => {
    const forced = forcedColorsTheme(lightTheme, (s) => (s === "Canvas" ? "#000000" : "#FFFFFF"));
    for (const fill of FILLS) {
      expect(fillOf(forced, fill)).toBeNull();
      expect(onFillTheme(forced, fill)).toBe(forced);
    }
  });

  it("gives the same theme back for the same theme and fill, and traces it to its source", () => {
    const a = onFillTheme(lightTheme, "sunset");
    expect(onFillTheme(lightTheme, "sunset")).toBe(a);
    expect(fillSource(a)).toEqual({ base: lightTheme, name: "sunset" });
    expect(fillSource(lightTheme)).toBeUndefined();
  });

  it("fillGradient runs corner to corner through the box, from the fill's ends", () => {
    const { context } = createRecordingContext();
    const calls: number[][] = [];
    const g = new Proxy(context, {
      get(t, p) {
        if (p === "createLinearGradient") return (...a: number[]) => { calls.push(a); return (t as unknown as Record<string, (...x: number[]) => unknown>)[p]!(...a); };
        return (t as unknown as Record<string | symbol, unknown>)[p];
      },
    });
    const grad = fillGradient(g, lightTheme, "sky", { x: 0, y: 0, w: 100, h: 100 });
    expect(grad).not.toBeNull();
    const [x0, y0, x1, y1] = calls[0]!;
    expect(x0).toBeCloseTo(0); expect(y0).toBeCloseTo(0);
    expect(x1).toBeCloseTo(100); expect(y1).toBeCloseTo(100);
    const forced = forcedColorsTheme(lightTheme, () => "#000000");
    expect(fillGradient(g, forced, "sky", { x: 0, y: 0, w: 10, h: 10 })).toBeNull();
  });
});

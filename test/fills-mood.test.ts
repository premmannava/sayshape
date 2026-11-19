/**
 * Fills keep their mood: in a dark theme they stay colorful and apart from the page (night isn't
 * an empty card, sunset isn't brown), dusk is violet rather than a paler sky in a light theme, and
 * fill=accent is a gradient even when the theme has one brand color. Words still read at AA.
 */
import { describe, expect, it } from "vitest";
import { FILLS, fillOf, fillSamples } from "../src/fills";
import { contrastRatio, worstContrast } from "../src/contrast";
import { darkTheme, lightTheme, parseColor, type Theme } from "../src/theme";

const middle = (t: Theme, name: (typeof FILLS)[number]) => {
  const f = fillOf(t, name)!;
  return fillSamples(f.from, f.to)[8]!;
};

/** Hue in degrees and saturation (0 to 1) of a color. */
function hsl(color: string): { h: number; s: number } {
  const [r, g, b] = parseColor(color)!.slice(0, 3).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0 };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s };
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe("fills", () => {
  it.each([["light", lightTheme], ["dark", darkTheme]] as const)("keep their words at AA in %s", (_, theme) => {
    for (const name of FILLS) {
      const f = fillOf(theme, name)!;
      expect(worstContrast(f.text, fillSamples(f.from, f.to))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("stand apart from a dark page, night included", () => {
    for (const name of FILLS) expect(contrastRatio(middle(darkTheme, name), darkTheme.colors.surface)!).toBeGreaterThanOrEqual(1.4);
  });

  it("stay colorful in a dark theme: sky, sunset and dusk aren't grey or brown", () => {
    for (const name of ["sky", "sunset", "dusk"] as const) expect(hsl(middle(darkTheme, name)).s).toBeGreaterThanOrEqual(0.35); // the muddy ones were about 0.23
    // Sunset reads orange to rose: its warm end is a real orange, not a muddy tan.
    const sunset = fillOf(darkTheme, "sunset")!;
    expect(hsl(sunset.from).h).toBeGreaterThanOrEqual(15);
    expect(hsl(sunset.from).h).toBeLessThanOrEqual(45);
    expect(hsl(sunset.from).s).toBeGreaterThanOrEqual(0.5);
  });

  it("make dusk violet, well away from sky, in a light theme", () => {
    const dusk = hsl(fillOf(lightTheme, "dusk")!.from), sky = hsl(middle(lightTheme, "sky"));
    expect(hueGap(dusk.h, sky.h)).toBeGreaterThanOrEqual(60);
  });

  it.each([["light", lightTheme], ["dark", darkTheme]] as const)("make fill=accent a gradient in %s, even with one brand color", (_, theme) => {
    expect(theme.colors.accent2).toBe(theme.colors.accent);
    const f = fillOf(theme, "accent")!;
    const [a, b] = [parseColor(f.from)!, parseColor(f.to)!];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThanOrEqual(40);
  });
});

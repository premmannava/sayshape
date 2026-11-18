import { describe, expect, it } from "vitest";
import { darkTheme, extendTheme, lightTheme, studioDarkTheme, studioLightTheme, type Theme } from "../src";
import { applyLook } from "../src/look";
import { boldHeroTheme, HERO_BOLD_WASH } from "../src/components/layout";
import { contrastRatio } from "../src/scrim";
import { isDarkTheme, mixColors } from "../src/theme";
import { render } from "../src/testing";

// WS2: under look mood=bold a hero card shows the accent gradient (the docs say bold turns the
// accent into a gradient), instead of the faint wash that read as a flat tint.
const brand = (t: Theme) => extendTheme(t, { colors: { accent: "#2F7FE0", accent2: "#5AB8F5" } });
const THEMES: Array<[string, Theme]> = [
  ["light", lightTheme], ["dark", darkTheme], ["studio light", studioLightTheme], ["studio dark", studioDarkTheme],
  ["brand light", brand(lightTheme)], ["brand dark", brand(darkTheme)],
];
const SPEC = (mood: string) => `look mood=${mood}\ncard variant=hero\n  text "Today" style=title\n  text "Sunny, 72°" tone=muted`;

/** The alpha of every accent-colored gradient fill the hero card draws (wash and glow). */
function washAlphas(theme: Theme, mood: string): number[] {
  return accentFills(render(SPEC(mood), { theme }));
}
function accentFills(ui: ReturnType<typeof render>): number[] {
  const accent = ui.sayshape.theme.colors.accent;
  return ui.drawOps.filter((op) => op.op === "fill" && op.gradientStops?.[0]?.color === accent).map((op) => op.globalAlpha ?? 1);
}

describe("hero card under look mood=bold", () => {
  it("lays a stronger accent gradient than quiet or no look, in light and dark", () => {
    for (const [name, theme] of THEMES) {
      const bold = Math.max(...washAlphas(theme, "bold"));
      const plain = Math.max(...accentFills(render(`card variant=hero\n  text "Today"`, { theme })));
      expect(bold, name).toBeCloseTo(isDarkTheme(theme) ? HERO_BOLD_WASH.dark : HERO_BOLD_WASH.light, 5);
      expect(bold, name).toBeGreaterThan(plain);
    }
  });

  it("quiet keeps the faint, flat wash", () => {
    const ui = render(SPEC("quiet"), { theme: lightTheme });
    expect(ui.sayshape.theme.colors.accent2).toBe(ui.sayshape.theme.colors.accent);
    expect(ui.sayshape.theme.mood).toBe("quiet");
    expect(Math.max(...washAlphas(lightTheme, "quiet"))).toBeLessThan(HERO_BOLD_WASH.light);
  });

  it("muted words inside are drawn in the lifted color", () => {
    const ui = render(SPEC("bold"), { theme: lightTheme });
    const muted = ui.drawOps.find((op) => op.op === "fillText" && String(op.args[0]).includes("Sunny"))!.fillStyle;
    expect(muted).toBe(boldHeroTheme(ui.sayshape.theme).colors.muted);
  });

  it("text on the strongest part of the wash still reads at AA, ink and muted", () => {
    for (const [name, host] of THEMES) {
      const t = applyLook(host, { mood: "bold" });
      expect(t.mood).toBe("bold");
      const c = boldHeroTheme(t).colors;
      const wash = isDarkTheme(t) ? HERO_BOLD_WASH.dark : HERO_BOLD_WASH.light;
      // The wash's two ends over the card, plus the corner glow (at most ~0.24 more accent) at its start.
      const glow = isDarkTheme(t) ? 0.24 : 0.16;
      const ends = [c.accent, c.accent2].map((a) => mixColors(c.raised, a, wash)!);
      const corner = mixColors(ends[0]!, c.accent, glow)!;
      for (const bg of [...ends, corner]) {
        expect(contrastRatio(c.ink, bg)!, `${name} ink`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.muted, bg)!, `${name} muted`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { isHostTokens, seriesFromAccent, themeFromTokens, type HostTokens } from "../src/host-tokens";
import { resolveThemeInput } from "../src/element/sync";
import { contrastRatio } from "../src/scrim";
import { darkTheme, lightTheme, type Theme } from "../src/theme";
import { render } from "../src/testing";

/** A renewals portal's own tokens, as an Angular host would pass them to <say-shape [theme]>. */
const PORTAL: HostTokens = {
  background: "#f4f6f9",
  surface: "#ffffff",
  text: "#1b2533",
  textSecondary: "#5a6678",
  border: "#d5dbe3",
  accent: "#00695c",
  radius: 4,
  fontFamily: "'Source Sans 3', Arial, sans-serif",
  fontSize: 15,
};

const series = (t: Theme) => [t.colors.series1, t.colors.series2, t.colors.series3, t.colors.series4, t.colors.series5, t.colors.series6];

describe("host tokens become a theme", () => {
  it("maps a portal's colors, radius and font onto SayShape's tokens", () => {
    const t = themeFromTokens(PORTAL);
    expect(t.colors.surface).toBe("#f4f6f9");
    expect(t.colors.raised).toBe("#ffffff");
    expect(t.colors.ink).toBe("#1b2533");
    expect(t.colors.muted).toBe("#5a6678");
    expect(t.colors.line).toBe("#d5dbe3");
    expect(t.colors.accent).toBe("#00695c");
    expect(t.colors.focus).toBe("#00695c");
    expect(t.colors.onAccent).toBe("#ffffff");
    expect(t.radius).toEqual({ sm: 3, md: 4, lg: 6 });
    expect(t.font.family).toBe("'Source Sans 3', Arial, sans-serif");
    expect(t.text.body).toBe(15);
    expect(t.text.title).toBe(Math.round(20 * 15 / 14));
    // Everything not given stays SayShape's light theme.
    expect(t.colors.good).toBe(lightTheme.colors.good);
    expect(t.space).toEqual(lightTheme.space);
  });

  it("keeps text at AA and chart colors at 3:1 against the background", () => {
    const t = themeFromTokens({ background: "#ffffff", text: "#bbbbbb", textMuted: "#dddddd", accent: "#ffd54f" });
    expect(contrastRatio(t.colors.ink, t.colors.surface)!).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.colors.muted, t.colors.surface)!).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.colors.accent, t.colors.surface)!).toBeGreaterThanOrEqual(3);
    for (const c of series(t)) expect(contrastRatio(c, t.colors.surface)!).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(t.colors.onAccent, t.colors.accent)!).toBeGreaterThanOrEqual(4.5);
  });

  it("works out six distinct chart colors from the accent when the host has no palette", () => {
    const s = seriesFromAccent("#00695c", "#f4f6f9");
    expect(s).toHaveLength(6);
    expect(new Set(s).size).toBe(6);
    expect(s[0]).toBe("#00695c");
    // Neighbors differ clearly: not two near-identical colors in a row.
    for (let i = 1; i < s.length; i++) expect(s[i]).not.toBe(s[i - 1]);
    const t = themeFromTokens(PORTAL);
    expect(series(t)).toEqual(seriesFromAccent("#00695c", "#f4f6f9"));
  });

  it("takes a chart palette when the host gives one", () => {
    const t = themeFromTokens({ ...PORTAL, series: ["#123456", "#654321"] });
    expect(t.colors.series1).toBe("#123456");
    expect(t.colors.series2).toBe("#654321");
    expect(t.colors.series3).toBe(lightTheme.colors.series3);
  });

  it("reads light or dark from the background, and follows a switch", () => {
    const dark = themeFromTokens({ background: "#1e1f22", text: "#e8e8e8", accent: "#7aa2ff" });
    expect(dark.colors.good).toBe(darkTheme.colors.good);
    expect(contrastRatio(dark.colors.ink, dark.colors.surface)!).toBeGreaterThanOrEqual(4.5);
    expect(themeFromTokens({ dark: true }).colors.surface).toBe(darkTheme.colors.surface);
  });

  it("ignores values that aren't plain colors, lengths or font stacks", () => {
    const t = themeFromTokens({ background: "var(--x)", text: "url(x)", accent: "#00695c80", radius: Number.NaN, fontFamily: "x; font: url(evil)", fontSize: 400 });
    expect(t.colors.surface).toBe(lightTheme.colors.surface);
    expect(t.colors.ink).toBe(lightTheme.colors.ink);
    expect(t.colors.accent).toBe(lightTheme.colors.accent);
    expect(t.radius).toEqual(lightTheme.radius);
    expect(t.font.family).toBe(lightTheme.font.family);
    expect(t.text.body).toBe(20); // clamped to 20 px
  });

  it("the wrappers' theme input takes tokens as well as a Theme or a name", () => {
    expect(isHostTokens(PORTAL)).toBe(true);
    expect(isHostTokens(lightTheme)).toBe(false);
    const t = resolveThemeInput(PORTAL);
    expect(t).not.toBe("auto");
    expect((t as Theme).colors.accent).toBe("#00695c");
    expect(resolveThemeInput("dark")).toBe(darkTheme);
  });

  it("draws an interface in the host's font and colors", () => {
    const ui = render(`card\n  text "Renewals due" style=title\n  button "Review"`, { theme: themeFromTokens(PORTAL), width: 600 });
    const texts = ui.drawOps.filter((o) => o.op === "fillText");
    const title = texts.find((o) => o.args[0] === "Renewals due")!;
    expect(title.fillStyle).toBe("#1b2533");
    expect(String(title.font)).toContain("Source Sans 3");
  });
});

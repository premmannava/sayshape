import { describe, expect, it } from "vitest";
import { controlFor, isHostTokens, seriesFromAccent, themeFromTokens, type HostTokens } from "../src/host-tokens";
import { applyLook } from "../src/look";
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
    // Hairline surfaces: cards are outlined in the page's own color, not the host's card color.
    expect(t.colors.raised).toBe("#f4f6f9");
    expect(t.surfaces).toBe("lines");
    expect(t.colors.ink).toBe("#1b2533");
    expect(t.colors.muted).toBe("#5a6678");
    expect(t.colors.line).toBe("#d5dbe3");
    expect(t.colors.accent).toBe("#00695c");
    expect(t.colors.focus).toBe("#00695c");
    expect(t.colors.onAccent).toBe("#ffffff");
    // The compact scale over the host's own: its large corner 10/12 of 6.
    expect(t.radius).toEqual({ sm: 3, md: 4, lg: 5 });
    expect(t.font.family).toBe("'Source Sans 3', Arial, sans-serif");
    expect(t.text.body).toBe(15);
    expect(t.text.title).toBe(Math.round(Math.round(20 * 15 / 14) * 18 / 20));
    expect(t.control).toEqual({ height: 32, small: 23 });
    expect(t.scale).toBe("compact");
    // Everything not given stays SayShape's light theme, compact.
    expect(t.colors.good).toBe(lightTheme.colors.good);
    expect(t.space).toEqual(applyLook(lightTheme, { density: "chat" }).space);
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
    expect(t.radius).toEqual(applyLook(lightTheme, { density: "chat" }).radius);
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

  it("keeps text readable on cards as well as on the page", () => {
    const t = themeFromTokens({ background: "#ffffff", surface: "#222222", text: "#111111" });
    // Cards take the page's color, so text that reads on the page reads on them.
    expect(t.colors.raised).toBe(t.colors.surface);
    expect(contrastRatio(t.colors.ink, t.colors.raised)!).toBeGreaterThanOrEqual(4.5);
    const flipped = themeFromTokens({ background: "#ffffff", dark: true });
    expect(contrastRatio(flipped.colors.ink, flipped.colors.surface)!).toBeGreaterThanOrEqual(4.5);
  });
});

describe("control outlines on a host's page (WCAG 1.4.11)", () => {
  const PAGES: Array<[string, HostTokens]> = [
    ["portal light", { background: "#f4f5f7", text: "#1b2533", accent: "#00695c" }],
    ["portal dark", { background: "#12161c", text: "#e6e9ee", accent: "#5cc8b8" }],
    ["chat light", { background: "#FAF9F5", text: "#141413", accent: "#ae5630" }],
    ["chat dark", { background: "#262624", text: "#faf9f5", accent: "#d97757" }],
    ["page only, light", { background: "#f4f5f7" }],
    ["page only, dark", { background: "#262624" }],
    ["page only, a lighter dark", { background: "#30302e" }],
  ];
  it.each(PAGES)("show at 3:1 on the %s page and its cards", (_n, tokens) => {
    const t = themeFromTokens(tokens);
    expect(contrastRatio(t.colors.control, t.colors.surface)!).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(t.colors.control, t.colors.raised)!).toBeGreaterThanOrEqual(3);
  });

  it("lifts SayShape's own outline where it falls short", () => {
    // Under 3:1 as they come: SayShape's light outline on a portal's #f4f5f7, its dark one on #30302e.
    expect(contrastRatio(lightTheme.colors.control, "#f4f5f7")!).toBeLessThan(3);
    expect(contrastRatio(darkTheme.colors.control, "#30302e")!).toBeLessThan(3);
    for (const [colors, page] of [[lightTheme.colors, "#f4f5f7"], [darkTheme.colors, "#30302e"], [darkTheme.colors, "#262624"]] as const) {
      const c = controlFor({ control: colors.control, surface: page, raised: page });
      expect(contrastRatio(c, page)!).toBeGreaterThanOrEqual(3);
    }
    // One that already shows is kept.
    expect(controlFor(lightTheme.colors)).toBe(lightTheme.colors.control);
  });
});

describe("stretchCards, a host's opt-out from natural card heights", () => {
  const spec = `row\n  card\n    text "Short"\n  card\n    text "Tall"\n    text "More"\n    text "Even more"\n`;
  const heights = (ui: ReturnType<typeof render>) => ui.findAll({ type: "card" }).map((f) => Math.round(f.box!.h));
  it("cards keep their own heights by default, and share one with the theme's stretchCards", () => {
    const own = heights(render(spec, { width: 600 }));
    expect(own[0]).toBeLessThan(own[1]!);
    const shared = heights(render(spec, { width: 600, theme: { ...lightTheme, stretchCards: true } }));
    expect(shared[0]).toBe(shared[1]);
    // The spec still wins.
    const off = heights(render(spec.replace("row\n", "row stretch=false\n"), { width: 600, theme: { ...lightTheme, stretchCards: true } }));
    expect(off[0]).toBeLessThan(off[1]!);
  });
});

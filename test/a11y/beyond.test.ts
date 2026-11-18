import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { darkTheme, forcedColorsTheme, lightTheme, studioDarkTheme, studioLightTheme, type Theme } from "../../src";
import { parseColor, seriesColors, sliceColors } from "../../src/theme";
import { applyLook, LOOK_OPTIONS, LOOK_PROPS, type Look } from "../../src/look";
import { render } from "../../src/testing";

/** WCAG contrast ratio between two colors. */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = parseColor(c)!.map((v, i) => (i < 3 ? v / 255 : v)) as number[];
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(bl!);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const BASE_THEMES = [["light", lightTheme], ["dark", darkTheme], ["studio-light", studioLightTheme], ["studio-dark", studioDarkTheme]] as Array<[string, Theme]>;
/** Every look option on its own, and all the loudest together: a look line must keep every theme readable. */
const LOOKS: Look[] = [
  ...LOOK_PROPS.flatMap((p) => Object.keys(LOOK_OPTIONS[p]).map((o) => ({ [p]: o }) as Look)),
  { mood: "bold", type: "editorial", shape: "round", density: "airy" },
];
const THEMES: Array<[string, Theme]> = [
  ...BASE_THEMES,
  ...BASE_THEMES.flatMap(([name, t]) => LOOKS.map((l) => [`${name} + look ${Object.entries(l).map(([k, v]) => `${k}=${v}`).join(" ")}`, applyLook(t, l)] as [string, Theme])),
];

describe.each(THEMES)("%s theme contrast (WCAG 2.1 AA)", (_name, theme) => {
  const c = theme.colors;
  for (const bg of ["surface", "raised"] as const) {
    it(`text reads at 4.5:1 on ${bg}: ink, muted, accent, good, warn and bad`, () => {
      for (const fg of ["ink", "muted", "accent", "good", "warn", "bad"] as const) {
        expect(contrast(c[fg], c[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`the focus ring and chart series stand out at 3:1 on ${bg}`, () => {
      for (const fg of ["focus", "series1", "series2", "series3", "series4", "series5", "series6"] as const) {
        expect(contrast(c[fg], c[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
  it("text on the accent reads at 4.5:1, all along its gradient", () => {
    expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.onAccent, c.accent2), "on accent2").toBeGreaterThanOrEqual(4.5);
  });
  it("the accent's gradient end stands out at 3:1 on surface and raised", () => {
    for (const bg of ["surface", "raised"] as const) expect(contrast(c.accent2, c[bg]), bg).toBeGreaterThanOrEqual(3);
  });
});

/** Distance in OKLab, times 100: about 2 is just noticeable, 15 reads as another color at a glance. */
function apart(a: string, b: string): number {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lab = (c: string) => {
    const [r, g, b] = parseColor(c)!.slice(0, 3).map(lin) as [number, number, number];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const [x, y] = [lab(a), lab(b)];
  return 100 * Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
}

/** Neighbouring series must read apart at a glance, never as shades of one blue. */
const ADJACENT_APART = 15;

describe.each(THEMES)("%s theme: neighbouring chart series", (_name, theme) => {
  // Bars and legends put series k beside k+1; a pie also closes the ring, so its last slice touches its first.
  it(`series side by side are at least ${ADJACENT_APART} apart`, () => {
    const s = seriesColors(theme);
    for (let k = 0; k + 1 < s.length; k++) expect(apart(s[k]!, s[k + 1]!), `series${k + 1} and series${k + 2}`).toBeGreaterThanOrEqual(ADJACENT_APART);
  });
  it(`pie and donut slices side by side, round the ring, are at least ${ADJACENT_APART} apart`, () => {
    const s = sliceColors(theme);
    for (let k = 0; k < s.length; k++) expect(apart(s[k]!, s[(k + 1) % s.length]!), `slice ${k + 1} and ${(k + 1) % s.length + 1}`).toBeGreaterThanOrEqual(ADJACENT_APART);
  });
});

describe("forced-colors mode", () => {
  const system: Record<string, string> = { Canvas: "rgb(0, 0, 0)", CanvasText: "rgb(255, 255, 255)", Highlight: "rgb(26, 235, 255)", HighlightText: "rgb(0, 0, 0)", GrayText: "rgb(63, 242, 63)" };
  const t = forcedColorsTheme(lightTheme, (name) => system[name]!);

  it("draws everything in the person's system colors", () => {
    expect([t.colors.surface, t.colors.raised, t.colors.ink, t.colors.muted, t.colors.line]).toEqual(["rgb(0, 0, 0)", "rgb(0, 0, 0)", "rgb(255, 255, 255)", "rgb(255, 255, 255)", "rgb(255, 255, 255)"]);
    expect([t.colors.accent, t.colors.focus, t.colors.onAccent]).toEqual(["rgb(26, 235, 255)", "rgb(26, 235, 255)", "rgb(0, 0, 0)"]);
    expect(t.colors.shadow).toBe("transparent");
  });

  it("keeps everything else about the theme", () => {
    expect([t.space, t.radius, t.font, t.text]).toEqual([lightTheme.space, lightTheme.radius, lightTheme.font, lightTheme.text]);
  });

  it.each(LOOKS.map((l) => [Object.entries(l).map(([k, v]) => `${k}=${v}`).join(" "), l] as const))("wins over a look line (%s)", (_n, look) => {
    for (const [, base] of BASE_THEMES) {
      const forced = forcedColorsTheme(applyLook(base, look), (name) => system[name]!);
      expect(forced.colors).toEqual(forcedColorsTheme(base, (name) => system[name]!).colors);
    }
  });

  it("a look line in a forced-colors theme draws in the system colors", () => {
    const ui = render(`look mood=bold\nbutton "Go" variant=primary on=notify:Hi`, { theme: t });
    expect(ui.sayshape.theme.colors).toEqual(t.colors);
  });

  it("still renders an interface without colors of its own", () => {
    const ui = render(`button "Go" on=notify:Hi\ntext "Hello"`, { theme: t });
    expect(ui.text()).toEqual(["Go", "Hello"]);
  });
});

describe("notify: messages stay long enough to read", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }); });
  afterEach(() => vi.useRealTimers());

  it("a short message for 3 seconds, a long one longer", () => {
    const long = "Your order is placed and a receipt is on its way to your inbox now";
    const ui = render(`button "Short" on=notify:Saved\nbutton "Long" on="notify:'${long}'"`);
    ui.press({ type: "button", text: "Short" });
    vi.advanceTimersByTime(3100);
    expect(ui.sayshape.notification).toBeNull();
    ui.press({ type: "button", text: "Long" });
    vi.advanceTimersByTime(3100);
    expect(ui.sayshape.notification).toBe(long);
    vi.advanceTimersByTime(3000);
    expect(ui.sayshape.notification).toBeNull();
  });
});

describe("target size (WCAG 2.2, 2.5.8)", () => {
  it("makes a link and breadcrumb steps at least 24 pixels tall to press, without moving what's drawn", () => {
    const ui = render(`state at=""\nlink "Size guide" on=notify:x\nbreadcrumb "Home / Shoes / Trail" bind=at`, { width: 1024 });
    for (const h of ui.hits.filter((r) => r.focusable)) expect(h.box.h, `${h.box.node.type} ${String(h.detail)}`).toBeGreaterThanOrEqual(24);
    // The link is still pressed from where it's drawn.
    const link = ui.find("link").box!;
    ui.click(link.x + 5, link.y + link.h - 2);
    expect(ui.announcements.at(-1)?.text).toBe("x");
  });
});

describe.each(THEMES)("%s theme control outlines (WCAG 1.4.11)", (_name, theme) => {
  it("show where a control is at 3:1 on surface and raised", () => {
    for (const bg of ["surface", "raised"] as const) expect(contrast(theme.colors.control, theme.colors[bg]), bg).toBeGreaterThanOrEqual(3);
  });
});

describe("controls draw their outline in the control token", () => {
  it("an input's border, an unchecked box and radio, a switch that's off", () => {
    const ui = render(`state a="" b=false c=false d=x
input "Name" bind=a
check "Agree" bind=b
switch "Updates" bind=c
radio "Other" bind=d value=y`);
    const strokes = ui.drawOps.filter((op) => op.op === "stroke").map((op) => op.strokeStyle);
    expect(strokes.filter((s) => s === lightTheme.colors.control).length).toBeGreaterThanOrEqual(4);
  });
});

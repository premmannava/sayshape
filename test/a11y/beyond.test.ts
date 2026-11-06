import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { darkTheme, forcedColorsTheme, lightTheme, studioDarkTheme, studioLightTheme, type Theme } from "../../src";
import { parseColor } from "../../src/theme";
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

describe.each([["light", lightTheme], ["dark", darkTheme], ["studio-light", studioLightTheme], ["studio-dark", studioDarkTheme]] as Array<[string, Theme]>)("%s theme contrast (WCAG 2.1 AA)", (_name, theme) => {
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
  it("text on the accent reads at 4.5:1", () => {
    expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
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

describe.each([["light", lightTheme], ["dark", darkTheme], ["studio-light", studioLightTheme], ["studio-dark", studioDarkTheme]] as Array<[string, Theme]>)("%s theme control outlines (WCAG 1.4.11)", (_name, theme) => {
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

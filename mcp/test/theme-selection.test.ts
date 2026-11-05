import { describe, expect, it } from "vitest";
import { parse } from "../../src/parser";
import { Registry } from "../../src/registry";
import { coreComponents } from "../../src/components";
import { optionKey } from "../../src/components/select";
import { render } from "../../src/testing";
import { darkTheme, lightTheme, seriesColors } from "../../src/theme";
import { PRESETS } from "../../playground/appearance/presets";
import type { ReadVar } from "../src/ui/host-theme";
import { DEFAULT_PRESET, isPresetId, THEME_CONTROL_SPEC, themeForPreset } from "../src/ui/theme-selection";

const registry = new Registry();
for (const component of coreComponents) registry.register(component);

const hostReader = (variables: Record<string, string>): ReadVar => (name) => variables[name];

function drawnColors(drawOps: ReturnType<typeof render>["drawOps"]): string[] {
  return drawOps.flatMap((op) => [op.fillStyle, op.strokeStyle]).filter((color): color is string => typeof color === "string");
}

describe("MCP view theme selection", () => {
  it("provides a trusted Teal-default picker from the existing four presets", () => {
    expect(DEFAULT_PRESET).toBe("teal");
    expect(PRESETS.map(({ id }) => id)).toEqual(["teal", "purple", "blue", "neutral"]);
    expect(parse(THEME_CONTROL_SPEC, registry).diagnostics).toEqual([]);
    expect(THEME_CONTROL_SPEC).toContain('state preset="teal"');
    expect(isPresetId("purple")).toBe(true);
    expect(isPresetId("url(javascript:alert(1))")).toBe(false);
    expect(isPresetId({ accent: "red" })).toBe(false);

    const ui = render(THEME_CONTROL_SPEC);
    ui.press("select");
    const purple = ui.popup!.regions.find((region) => region.detail === `opt:${optionKey("purple")}`)!.box;
    ui.click(purple.x + purple.w / 2, purple.y + purple.h / 2);
    expect(ui.state.preset).toBe("purple");
    expect(ui.emitted).toEqual([{ name: "theme", value: "purple" }]);
    ui.destroy();
  });

  it("updates chart series through the existing accent and series tokens", () => {
    const ui = render(`state sales=[{month: "Jan", this_year: 10, last_year: 8}, {month: "Feb", this_year: 14, last_year: 9}]
chart "Sales" kind=line items=sales x=month y=this_year,last_year
`, { theme: themeForPreset("purple", "light") });
    const purple = themeForPreset("purple", "light");
    expect(drawnColors(ui.drawOps)).toEqual(expect.arrayContaining(seriesColors(purple).slice(0, 2)));

    ui.loom.setTheme(themeForPreset("blue", "light"));
    ui.loom.renderNow();
    const blue = themeForPreset("blue", "light");
    expect(drawnColors(ui.drawOps)).toEqual(expect.arrayContaining(seriesColors(blue).slice(0, 2)));
    expect(blue.colors.series1).toBe(blue.colors.accent);
    expect(blue.colors.series2).toBe(lightTheme.colors.series2);
    ui.destroy();
  });

  it("re-resolves the selected preset for host light and dark modes without losing host tokens", () => {
    const host = hostReader({
      "--color-background-primary": "rgb(31, 31, 30)",
      "--color-text-primary": "rgb(250, 249, 245)",
      "--font-sans": '"Host Sans", system-ui',
    });
    const light = themeForPreset("blue", "light", host);
    const dark = themeForPreset("blue", "dark", host);

    expect(light.colors.accent).toBe("#1d4ed8");
    expect(dark.colors.accent).toBe("#7aaefc");
    expect(light.colors.surface).toBe("rgb(31, 31, 30)");
    expect(dark.colors.surface).toBe("rgb(31, 31, 30)");
    expect(light.font.family).toBe('"Host Sans", system-ui');
    expect(dark.font.family).toBe('"Host Sans", system-ui');
    expect(seriesColors(light).slice(1)).toEqual(seriesColors(lightTheme).slice(1));
    expect(seriesColors(dark).slice(1)).toEqual(seriesColors(darkTheme).slice(1));
  });

  it("preserves interface state when the selected theme changes", () => {
    const ui = render(`state count=2
text "Count: {count}"
button "Add" on=inc:count
`);
    ui.set("count", 7);
    const before = ui.loom.state.snapshot();

    ui.loom.setTheme(themeForPreset("neutral", "dark"));
    ui.loom.renderNow();

    expect(ui.loom.state.snapshot()).toEqual(before);
    expect(ui.text()).toContain("Count: 7");
    ui.destroy();
  });
});

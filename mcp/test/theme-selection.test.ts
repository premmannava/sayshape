import { describe, expect, it } from "vitest";
import { parse } from "../../src/parser";
import { Registry } from "../../src/registry";
import { coreComponents } from "../../src/components";
import { optionKey } from "../../src/components/select";
import { render } from "../../src/testing";
import { darkTheme, lightTheme, seriesColors } from "../../src/theme";
import { PRESETS } from "../../playground/appearance/presets";
import type { ReadVar } from "../src/ui/host-theme";
import { COPY_ACTION, DEFAULT_PRESET, isPresetId, SAVE_ACTION, toolbarSpec, toolbarWidth, TOOLBAR_PADDING, themeForPreset } from "../src/ui/theme-selection";
import { toolButton } from "../src/ui/tool-button";

const registry = new Registry();
for (const component of [...coreComponents, toolButton]) registry.register(component);
const TOOLS = [...coreComponents, toolButton];
const PICKER_ONLY = toolbarSpec({ picker: true, save: false, copy: false, theme: DEFAULT_PRESET });
const BOTH = toolbarSpec({ picker: true, save: true, copy: false, theme: DEFAULT_PRESET });

const hostReader = (variables: Record<string, string>): ReadVar => (name) => variables[name];

function drawnColors(drawOps: ReturnType<typeof render>["drawOps"]): string[] {
  return drawOps.flatMap((op) => [op.fillStyle, op.strokeStyle]).filter((color): color is string => typeof color === "string");
}

describe("MCP view theme selection", () => {
  it("provides a trusted Teal-default picker from the existing four presets", () => {
    expect(DEFAULT_PRESET).toBe("teal");
    expect(PRESETS.map(({ id }) => id)).toEqual(["teal", "purple", "blue", "neutral", "studio"]);
    expect(parse(PICKER_ONLY, registry).diagnostics).toEqual([]);
    expect(PICKER_ONLY).toContain('state preset="teal"');
    expect(isPresetId("purple")).toBe(true);
    expect(isPresetId("url(javascript:alert(1))")).toBe(false);
    expect(isPresetId({ accent: "red" })).toBe(false);

    const ui = render(PICKER_ONLY);
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

    ui.sayshape.setTheme(themeForPreset("blue", "light"));
    ui.sayshape.renderNow();
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
    const before = ui.sayshape.state.snapshot();

    ui.sayshape.setTheme(themeForPreset("neutral", "dark"));
    ui.sayshape.renderNow();

    expect(ui.sayshape.state.snapshot()).toEqual(before);
    expect(ui.text()).toContain("Count: 7");
    ui.destroy();
  });
});

describe("MCP view toolbar", () => {
  it("is one slim strip with no label: the selector, then the download icon at the right", () => {
    expect(parse(BOTH, registry).diagnostics).toEqual([]);
    expect(BOTH).not.toContain('select "Theme"');
    const width = toolbarWidth({ picker: true, save: true, copy: false, theme: DEFAULT_PRESET });
    const ui = render(BOTH, { components: TOOLS, width, padding: TOOLBAR_PADDING });
    // "Theme" names the selector for screen readers but is never drawn.
    expect(ui.text().join(" ")).not.toContain("Theme");
    const select = ui.find("select").box!;
    const save = ui.hits.find((h) => h.box.node.type === "tool-button")!.box;
    expect(save.x).toBeGreaterThan(select.x + select.w);
    expect(save.x + save.w).toBeCloseTo(width - TOOLBAR_PADDING, 0);
    // A control's height plus the strip's padding: far less than a labelled row.
    expect(ui.sayshape.boxes!.h).toBeLessThanOrEqual(40 + 2 * TOOLBAR_PADDING);
    // The download button is smaller than the selector: a utility, not a primary control.
    expect(save.w).toBe(30);
    expect(save.h).toBe(30);
    ui.destroy();
  });

  it("shows only the tools that are on, and nothing at all when none are", () => {
    expect(toolbarSpec({ picker: false, save: false, copy: false, theme: "teal" })).toBe("");
    expect(toolbarWidth({ picker: false, save: false, copy: false, theme: "teal" })).toBe(2 * TOOLBAR_PADDING);
    const saveOnly = toolbarSpec({ picker: false, save: true, copy: false, theme: "teal" });
    expect(saveOnly).not.toContain("select");
    expect(parse(PICKER_ONLY, registry).diagnostics).toEqual([]);
    expect(PICKER_ONLY).not.toContain("tool-button");
    const ui = render(saveOnly, { components: TOOLS, width: toolbarWidth({ picker: false, save: true, copy: false, theme: "teal" }), padding: TOOLBAR_PADDING });
    expect(ui.hits.map((h) => h.box.node.type)).toEqual(["tool-button"]);
    ui.destroy();
  });

  it("starts the selector on the theme the server was started with", () => {
    const ui = render(toolbarSpec({ picker: true, save: false, copy: false, theme: "blue" }));
    expect(ui.state.preset).toBe("blue");
    ui.destroy();
  });

  it("sends the view's own save action from the download icon, never a message for the model", () => {
    const ui = render(BOTH, { components: TOOLS, width: toolbarWidth({ picker: true, save: true, copy: false, theme: "teal" }), padding: TOOLBAR_PADDING });
    ui.press({ type: "tool-button" });
    expect(ui.emitted).toEqual([{ name: SAVE_ACTION, value: undefined }]);
    expect(ui.state.preset).toBe(DEFAULT_PRESET);
    ui.destroy();
  });

  it("reads to a screen reader as the theme selector and a Save image button", () => {
    const ui = render(BOTH, { components: TOOLS, width: toolbarWidth({ picker: true, save: true, copy: false, theme: "teal" }), padding: TOOLBAR_PADDING });
    const nodes = ui.accessibility().children!;
    expect(nodes.at(-1)).toEqual({ role: "button", name: "Save image", state: ["focusable"] });
    expect(nodes[0]).toMatchObject({ role: "group", children: [{ role: "combobox", name: "Theme", state: ["not expanded", "value Teal", "focusable"] }] });
    // A screen reader's activation saves, like a press.
    ui.mirror.activate(ui.mirror.keyOf("tool-button"));
    expect(ui.emitted).toEqual([{ name: SAVE_ACTION, value: undefined }]);
    ui.destroy();
  });

  it("puts Copy text just before Save image, both icons at the right end", () => {
    const all = { picker: true, save: true, copy: true, theme: DEFAULT_PRESET } as const;
    const spec = toolbarSpec(all);
    expect(parse(spec, registry).diagnostics).toEqual([]);
    const width = toolbarWidth(all);
    expect(width).toBe(120 + 8 + 30 + 8 + 30 + 2 * TOOLBAR_PADDING);
    const ui = render(spec, { components: TOOLS, width, padding: TOOLBAR_PADDING });
    const select = ui.find("select").box!;
    const [copy, save] = ui.hits.filter((h) => h.box.node.type === "tool-button").map((h) => h.box);
    expect(copy!.x).toBeGreaterThan(select.x + select.w);
    expect(save!.x).toBeGreaterThan(copy!.x + copy!.w);
    expect(save!.x + save!.w).toBeCloseTo(width - TOOLBAR_PADDING, 0);
    expect(ui.accessibility().children!.slice(-2)).toEqual([
      { role: "button", name: "Copy text", state: ["focusable"] },
      { role: "button", name: "Save image", state: ["focusable"] },
    ]);
    ui.destroy();
  });

  it("sends the view's own copy action from the copy icon, never a message for the model", () => {
    const tools = { picker: false, save: false, copy: true, theme: "teal" } as const;
    expect(toolbarWidth(tools)).toBe(30 + 2 * TOOLBAR_PADDING);
    const ui = render(toolbarSpec(tools), { components: TOOLS, width: toolbarWidth(tools), padding: TOOLBAR_PADDING });
    ui.press({ type: "tool-button" });
    expect(ui.emitted).toEqual([{ name: COPY_ACTION, value: undefined }]);
    ui.destroy();
  });

  it("keeps the tool button out of what models can write", () => {
    const models = new Registry(coreComponents);
    expect(models.has("tool-button")).toBe(false);
    expect(parse(`tool-button "Save" icon=download\n`, models).diagnostics[0]?.message).toMatch(/tool-button/);
  });
});

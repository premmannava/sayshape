import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { choroplethColor, choroplethStops, mapVisual } from "../src/components/map/visual";
import { darkTheme, extendTheme, lightTheme } from "../src/theme";
import { render } from "../src/testing";

const components = [...coreComponents, ...mapComponents];
const choropleth = `state countries=[{country:"United States",revenue:100},{country:"Brazil",revenue:300},{country:"Japan",revenue:200}]
map kind=choropleth items=countries region=country value=revenue legendTitle="Revenue"
`;
const bubble = `state selected="" projects=[{name:"Mesa school",lat:33.4152,lon:-111.8315,budget:1000},{name:"Mesa clinic",lat:33.4152,lon:-111.8315,budget:250},{name:"Phoenix library",lat:33.4484,lon:-112.074,budget:100}]
map kind=bubble items=projects lat=lat lon=lon label=name value=budget fit=pins controls=true bind=selected
`;

describe("theme-reactive Canvas map visual language", () => {
  it.each([["light", lightTheme], ["dark", darkTheme]] as const)(
    "uses the %s theme's semantic palette and mode-specific emphasis", (name, theme) => {
      const visual = mapVisual(theme);
      expect(visual.dark).toBe(name === "dark");
      expect(visual.ocean).toBe(theme.colors.surface);
      expect(visual.bubbleFill).toBe(theme.colors.accent);
      expect(visual.tooltip).toBe(theme.colors.raised);
      expect(visual.outline).toBe(theme.colors.line);
      expect(visual.label).toBe(theme.colors.ink);
      expect(choroplethStops(theme)[2]).toBe(theme.colors.accent);
      expect(choroplethColor(theme, 0)).toBe(choroplethStops(theme)[0]);
      expect(choroplethColor(theme, 0.5)).toBe(choroplethStops(theme)[1]);
      expect(choroplethColor(theme, 1)).toBe(theme.colors.accent);
      expect(choroplethColor(theme, 0.25)).not.toBe(choroplethColor(theme, 0.75));
    },
  );

  it("recomputes the entire color scale for a host-chosen accent in either mode", () => {
    for (const base of [lightTheme, darkTheme]) {
      const custom = extendTheme(base, { colors: { accent: "#895BCC" } });
      expect(choroplethColor(custom, 1)).toBe("#895BCC");
      expect(choroplethColor(custom, 0.5)).not.toBe(choroplethColor(base, 0.5));
      expect(mapVisual(custom).ocean).toBe(base.colors.surface);
      expect(mapVisual(custom).bubbleFill).toBe("#895BCC");
    }
  });

  it.each([["light", lightTheme], ["dark", darkTheme]] as const)(
    "renders identical data with %s-native ocean, legend and bubble colors", (_name, theme) => {
      const a = render(choropleth, { components, theme });
      expect(a.diagnostics).toEqual([]);
      const ops = a.drawOps;
      expect(ops.some((o) => o.op === "fillRect" && o.fillStyle === theme.colors.surface)).toBe(true);
      const gradient = ops.find((o) => o.gradientStops?.length === 3);
      expect(gradient?.gradientStops?.map((x) => x.color)).toEqual([...choroplethStops(theme)]);
      const fills = ops.filter((o) => o.op === "fill").map((o) => o.fillStyle);
      expect(fills).toContain(choroplethColor(theme, 0));
      expect(fills).toContain(choroplethColor(theme, 1));
      a.destroy();

      const b = render(bubble, { components, theme });
      expect(b.diagnostics).toEqual([]);
      const bubbleOps = b.drawOps;
      expect(bubbleOps.some((o) => o.op === "fill" && o.fillStyle === theme.colors.accent && o.globalAlpha < 1)).toBe(true);
      expect(bubbleOps.some((o) => o.op === "stroke" && o.strokeStyle === theme.colors.raised)).toBe(true);
      expect(bubbleOps.some((o) => o.op === "fillRect" && o.fillStyle === theme.colors.surface)).toBe(true);
      b.destroy();
    },
  );

  it("changes paint colors when a host switches theme without changing the map spec", () => {
    const ui = render(choropleth, { components, theme: lightTheme });
    const before = (ui.find("map").box!.data as { regions: { values: Map<string, number> } }).regions.values;
    ui.sayshape.setTheme(darkTheme);
    ui.sayshape.renderNow();
    const ops = ui.drawOps;
    expect(ops.some((o) => o.op === "fillRect" && o.fillStyle === darkTheme.colors.surface)).toBe(true);
    expect(ops.some((o) => o.op === "fill" && o.fillStyle === darkTheme.colors.accent)).toBe(true);
    const after = (ui.find("map").box!.data as { regions: { values: Map<string, number> } }).regions.values;
    expect([...after]).toEqual([...before]);
    ui.destroy();
  });
});

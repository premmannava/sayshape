import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { bubbleRadius, bubbleValues, mixedColor, regionKey, regionValues } from "../src/components/map/analytics";
import { render } from "../src/testing";
import { toData } from "../src/data";
import { lightTheme } from "../src/theme";

const components = [...coreComponents, ...mapComponents];

describe("choropleth aggregation and country matching", () => {
  it("normalizes country aliases and accents without guessing unrelated regions", () => {
    expect(regionKey("U.S.A.")).toBe(regionKey("United States of America"));
    expect(regionKey("UK")).toBe(regionKey("United Kingdom"));
    expect(regionKey("Côte d’Ivoire")).toBe(regionKey("Cote dIvoire"));
    expect(regionKey("Japan")).not.toBe(regionKey("Jamaica"));
  });

  it("sums duplicate countries and ignores unknown and invalid rows", () => {
    const summary = regionValues(toData([
      { country: "US", revenue: 10 },
      { country: "United States", revenue: 12 },
      { country: "Brazil", revenue: 0 },
      { country: "Atlantis", revenue: 100 },
      { country: "Japan", revenue: "missing" },
    ]), "country", "revenue", ["United States of America", "Brazil", "Japan"]);
    expect(summary.values.get("United States of America")).toBe(22);
    expect(summary.values.get("Brazil")).toBe(0);
    expect(summary.values.size).toBe(2);
    expect(summary.min).toBe(0);
    expect(summary.max).toBe(22);
    expect(summary.ignored).toBe(2);
    expect(summary.unmatched).toEqual(["Atlantis"]);
  });

  it("creates concrete Canvas colors from light and host rgb theme tokens", () => {
    expect(mixedColor("#000000", "#ffffff", 0.5)).toBe("rgb(128, 128, 128)");
    expect(mixedColor("rgb(12, 30, 90)", "rgb(112, 130, 190)", 1)).toBe("rgb(112, 130, 190)");
    expect(mixedColor("invalid", "#12ab34", 0.5)).toBe("#12ab34");
  });
});

describe("proportional bubble sizing", () => {
  it("uses sqrt scale so bubble area encodes numeric values", () => {
    expect(bubbleRadius(100, 0, 100)).toBe(22);
    expect(bubbleRadius(0, 0, 100)).toBe(5);
    expect(bubbleRadius(25, 0, 100)).toBeCloseTo(13.5);
  });

  it("rejects invalid coordinates and values while preserving zero", () => {
    const result = bubbleValues(toData([
      { city: "A", lat: 33, lon: -112, revenue: 10 },
      { city: "B", lat: 34, lon: -111, revenue: 0 },
      { city: "bad", lat: 120, lon: -111, revenue: 100 },
      { city: "negative", lat: 32, lon: -111, revenue: -1 },
    ]), "lat", "lon", "revenue", "city");
    expect(result.points.map((p) => p.label)).toEqual(["A", "B"]);
    expect(result.min).toBe(0);
    expect(result.max).toBe(10);
    expect(result.ignored).toBe(2);
  });
});

describe("data-first Canvas map components", () => {
  it("renders country-valued choropleth with a legend and correct selected country tooltip", () => {
    const ui = render(`state selected="" regions=[{country:"USA",revenue:150},{country:"Brazil",revenue:50},{country:"Japan",revenue:75}]
map kind=choropleth items=regions region=country value=revenue bind=selected legendTitle="Revenue"
`, { components });
    expect(ui.diagnostics).toEqual([]);
    const box = ui.find("map").box!;
    const data = box.data as { regions: { values: Map<string, number>; min: number; max: number }; kind: string; legend: boolean };
    expect(data.kind).toBe("choropleth");
    expect(data.legend).toBe(true);
    expect(data.regions.values.get("United States of America")).toBe(150);
    expect(data.regions.values.get("Brazil")).toBe(50);
    expect(data.regions.min).toBe(50);
    expect(data.regions.max).toBe(150);
    expect(ui.text()).toContain("Revenue");
    const countryColor = ui.drawOps.filter((op) => op.op === "fill").map((op) => op.fillStyle);
    expect(countryColor.some((c) => c.startsWith("rgb("))).toBe(true);
    ui.sayshape.hover = { node: box.node, box, detail: "Japan" };
    ui.sayshape.pointer = { x: box.x + 200, y: box.y + 100 };
    ui.sayshape.invalidate("paint");
    ui.sayshape.renderNow();
    expect(ui.text()).toContain("Japan");
    expect(ui.text()).toContain("Revenue: 75");
    ui.destroy();
  });

  it("renders bubble values from data columns, with three reference legend values", () => {
    const ui = render(`state locations=[{city:"Phoenix",lat:33.4484,lon:-112.074,value:100},{city:"Tucson",lat:32.2226,lon:-110.9747,value:25}]
map kind=bubble items=locations lat=lat lon=lon label=city value=value fit=pins legendTitle="Project value"
`, { components });
    expect(ui.diagnostics).toEqual([]);
    const box = ui.find("map").box!;
    const data = box.data as { pins: Array<{ label: string; size: number; value: number }>; view: { zoom: number }; legend: boolean };
    expect(data.pins.map((p) => [p.label, p.size, p.value])).toEqual([
      ["Phoenix", 22, 100],
      ["Tucson", 13.5, 25],
    ]);
    expect(data.view.zoom).toBeGreaterThan(1);
    expect(data.legend).toBe(true);
    expect(ui.text()).toContain("Project value");
    expect(ui.text()).toContain("Phoenix");
    expect(ui.text()).toContain("Tucson");
    ui.destroy();
  });

  it("keeps legacy maps unaffected and supports hiding analytic legends", () => {
    const ui = render(`map
  pin "Phoenix" lat=33.4484 lon=-112.074 tone=good size=8
`, { components, theme: lightTheme });
    const data = ui.find("map").box!.data as { legend: boolean; kind: string };
    expect(data.kind).toBe("markers");
    expect(data.legend).toBe(false);
    expect(ui.diagnostics).toEqual([]);
    ui.destroy();

    const noLegend = render(`state data=[{country:"Japan",revenue:20}]
map kind=choropleth items=data region=country value=revenue legend=false
`, { components });
    expect(noLegend.text()).not.toContain("Country value");
    noLegend.destroy();
  });

  it("warns AI models about missing field names in an analytic map spec", () => {
    const ui = render("map kind=bubble items=points lat=lat lon=lon", { components });
    expect(ui.diagnostics.map((d) => d.message).join(" ")).toContain("bubble map needs value=");
    expect(ui.diagnostics.map((d) => d.message).join(" ")).toContain("bubble map needs label=");
    ui.destroy();
  });
});

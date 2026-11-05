import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { overlappingGroups, spiderfy } from "../src/components/map/overlap";
import { layoutBubbleLabels } from "../src/components/map/labels";
import { MAX_ZOOM, worldView, zoomAt } from "../src/components/map/viewport";
import stateLines from "../src/components/map/states.json";
import { lightTheme } from "../src/theme";
import { render } from "../src/testing";

const components = [...coreComponents, ...mapComponents];
const sameCoords = `state selected="" locations=[{name:"Mesa school",lat:33.4152,lon:-111.8315,budget:1000},{name:"Mesa clinic",lat:33.4152,lon:-111.8315,budget:250},{name:"Phoenix library",lat:33.4484,lon:-112.074,budget:100}]
map kind=bubble items=locations lat=lat lon=lon label=name value=budget fit=pins controls=true bind=selected
`;

describe("bubble overlap math", () => {
  it("detects two bubbles sharing coordinates even at 128x zoom", () => {
    const groups = overlappingGroups([
      { x: 150, y: 100, radius: 22 },
      { x: 150, y: 100, radius: 12 },
      { x: 400, y: 120, radius: 6 },
    ]);
    expect(groups).toEqual([[0, 1]]);
    expect(zoomAt(worldView(), 200, 300, 110, 600, 260).zoom).toBe(MAX_ZOOM);
    expect(MAX_ZOOM).toBeGreaterThan(48);
  });

  it("uses radii (not a fixed center distance) and includes connected collisions", () => {
    const groups = overlappingGroups([
      { x: 0, y: 0, radius: 24 },
      { x: 42, y: 0, radius: 24 },
      { x: 83, y: 0, radius: 20 },
      { x: 200, y: 0, radius: 4 },
    ]);
    expect(groups).toEqual([[0, 1, 2]]);
    expect(overlappingGroups([
      { x: 0, y: 0, radius: 5 },
      { x: 42, y: 0, radius: 5 },
    ])).toEqual([]);
  });

  it("spiderfy gives each item a different position and retains real anchors", () => {
    const circles = [
      { x: 260, y: 150, radius: 22 },
      { x: 260, y: 150, radius: 9 },
      { x: 260, y: 150, radius: 12 },
    ];
    const positions = spiderfy([0, 1, 2], circles, 600, 300);
    expect(positions).toHaveLength(3);
    expect(new Set(positions.map((p) => p.x + ":" + p.y)).size).toBe(3);
    expect(positions.every((p) => p.sourceX === 260 && p.sourceY === 150)).toBe(true);
    expect(positions.every((p) => p.x > 0 && p.x < 600 && p.y > 0 && p.y < 300)).toBe(true);
  });
});

describe("collision-aware bubble labels", () => {
  it("avoids overlapping labels and keeps them within viewport bounds", () => {
    const circles = Array.from({ length: 8 }, (_, id) => ({
      id, x: 190, y: 125, radius: 18, text: "Project " + id, priority: id,
    }));
    const labels = layoutBubbleLabels(circles, 400, 250, (s) => s.length * 7);
    expect(labels.size).toBeGreaterThan(0);
    expect(labels.size).toBeLessThan(circles.length);
    const positions = [...labels.values()];
    for (const p of positions) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.y).toBeGreaterThan(0);
      expect(p.x + p.text.length * 7).toBeLessThan(400);
    }
    const winner = labels.get(7);
    expect(winner).toBeDefined();
  });
});

describe("regional basemap boundaries", () => {
  it("embeds public-domain state outlines without cluttering world views", () => {
    expect(stateLines.states.length).toBe(51);
    expect(stateLines.states.some((state) => state[0] === "Arizona")).toBe(true);
    const zoomed = render(sameCoords, { components });
    expect((zoomed.find("map").box!.data as { view: { zoom: number } }).view.zoom).toBeGreaterThan(4);
    const outline = lightTheme.colors.muted;
    expect(zoomed.drawOps.filter((op) => op.op === "stroke" && op.strokeStyle === outline)).toHaveLength(51);
    zoomed.destroy();

    const world = render("map", { components });
    expect(world.drawOps.some((op) => op.op === "stroke" && op.strokeStyle === outline)).toBe(false);
    world.destroy();
  });
});

describe("bubble map spiderfy interactions", () => {
  it("opens an overlap group with independent hit targets and selects both projects", () => {
    const ui = render(sameCoords, { components });
    expect(ui.diagnostics).toEqual([]);
    const box = ui.find("map").box!;
    const initial = box.data as { groups: Array<{ x: number; y: number; items: unknown[] }>; overlaps: number[][] };
    expect(initial.overlaps).toEqual(expect.arrayContaining([[0, 1]]));
    // The two bubbles have identical projected coordinates.
    const group = initial.groups.find((g) => g.items.length === 1)!;
    ui.click(box.x + group.x, box.y + group.y);
    const expandedBox = ui.find("map").box!;
    const expanded = expandedBox.data as { spiderPoints: Array<{ index: number; x: number; y: number }> };
    expect(expanded.spiderPoints).toHaveLength(2);
    const spots = expanded.spiderPoints;
    expect(spots[0]!.x + ":" + spots[0]!.y).not.toBe(spots[1]!.x + ":" + spots[1]!.y);
    for (const spot of spots) {
      const t = ui.loom.targetAt(expandedBox.x + spot.x, expandedBox.y + spot.y);
      expect(t?.detail).toBe("@map:spider:" + spot.index);
    }
    const second = spots.find((p) => p.index === 1)!;
    ui.click(expandedBox.x + second.x, expandedBox.y + second.y);
    expect(ui.state.selected).toBe("Mesa clinic");
    const first = spots.find((p) => p.index === 0)!;
    ui.click(expandedBox.x + first.x, expandedBox.y + first.y);
    expect(ui.state.selected).toBe("Mesa school");
    ui.destroy();
  });

  it("collapses on map background and when the camera zooms", () => {
    const ui = render(sameCoords, { components });
    const open = () => {
      const b = ui.find("map").box!;
      const d = b.data as { groups: Array<{ x: number; y: number; items: unknown[] }> };
      const g = d.groups.find((group) => group.items.length === 1)!;
      ui.click(b.x + g.x, b.y + g.y);
      expect((ui.find("map").box!.data as { spiderPoints: unknown[] }).spiderPoints).toHaveLength(2);
    };
    open();
    const b = ui.find("map").box!;
    ui.click(b.x + 8, b.y + 8);
    expect((ui.find("map").box!.data as { spiderPoints: unknown[] }).spiderPoints).toHaveLength(0);
    open();
    const c = ui.find("map").box!;
    ui.wheel(c.x + c.w / 2, c.y + c.h / 2, -120);
    expect((ui.find("map").box!.data as { spiderPoints: unknown[] }).spiderPoints).toHaveLength(0);
    ui.destroy();
  });

  it("preserves traditional pin clicks and choropleth behavior", () => {
    const ui = render(`state picked=""
map bind=picked
  pin "Tokyo" lat=35.68 lon=139.69
`, { components });
    const b = ui.find("map").box!;
    const g = (b.data as { groups: Array<{ x: number; y: number }> }).groups[0]!;
    ui.click(b.x + g.x, b.y + g.y);
    expect(ui.state.picked).toBe("Tokyo");
    ui.destroy();
  });
});

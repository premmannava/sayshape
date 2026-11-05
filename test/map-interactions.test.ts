import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents, project } from "../src/components/map";
import { clusterPoints } from "../src/components/map/clustering";
import { constrain, fitPins, panBy, zoomAt, worldView } from "../src/components/map/viewport";
import { render } from "../src/testing";

const components = [...coreComponents, ...mapComponents];
const spec = `state selected=""
map bind=selected fit=pins cluster=true controls=true
  pin "Phoenix" lat=33.4484 lon=-112.074 tone=bad size=9 detail="Status: delayed | Contract: 120000"
  pin "Tucson" lat=32.2226 lon=-110.9747 tone=good size=5 detail="Status: complete | Contract: 45000"
`;

describe("Canvas map viewport geometry", () => {
  it("zooms around the pointer without moving the underlying projected point", () => {
    const initial = { zoom: 2, dx: -120, dy: -80 };
    const pointer = { x: 180, y: 150 };
    const before = { x: (pointer.x - initial.dx) / initial.zoom, y: (pointer.y - initial.dy) / initial.zoom };
    const after = zoomAt(initial, 1.7, pointer.x, pointer.y, 600, 300);
    expect(after.zoom).toBeCloseTo(3.4);
    expect((pointer.x - after.dx) / after.zoom).toBeCloseTo(before.x);
    expect((pointer.y - after.dy) / after.zoom).toBeCloseTo(before.y);
  });

  it("constrains panning to the map bounds and zoom to at least one", () => {
    expect(constrain({ zoom: 0.3, dx: -50, dy: -100 }, 600, 300)).toEqual(worldView());
    expect(panBy({ zoom: 2, dx: -100, dy: -100 }, 1000, -1000, 600, 300))
      .toEqual({ zoom: 2, dx: 0, dy: -300 });
  });

  it("auto-fits a region, and falls back to world when no pins are present", () => {
    expect(fitPins([], 600, 300, 900)).toEqual(worldView());
    const fitted = fitPins([{ x: 370, y: 180 }, { x: 380, y: 188 }], 600, 300, 900);
    expect(fitted.zoom).toBeGreaterThan(1);
    for (const p of [{ x: 370, y: 180 }, { x: 380, y: 188 }]) {
      const x = fitted.dx + p.x * (600 / 900) * fitted.zoom;
      const y = fitted.dy + p.y * (600 / 900) * fitted.zoom;
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(600);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(300);
    }
  });
});

describe("Canvas marker clustering", () => {
  it("groups neighboring screen points across grid boundaries", () => {
    const groups = clusterPoints([
      { item: "A", x: 40, y: 10 },
      { item: "B", x: 43, y: 11 },
      { item: "C", x: 200, y: 100 },
    ]);
    expect(groups.map((g) => g.items)).toEqual([["A", "B"], ["C"]]);
  });

  it("preserves point order and keeps far-away pins separate", () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ item: i, x: i * 100, y: 40 }));
    expect(clusterPoints(points)).toHaveLength(points.length);
    expect(clusterPoints(points, 0)).toHaveLength(points.length);
  });
});

describe("interactive Canvas maps", () => {
  it("auto-fits points and draws the optional Canvas toolbar", () => {
    const ui = render(spec, { components });
    expect(ui.diagnostics).toEqual([]);
    const box = ui.find("map").box!;
    const data = box.data as { view: { zoom: number }; groups: Array<{ items: unknown[] }> };
    expect(data.view.zoom).toBeGreaterThan(1);
    expect(ui.text()).toEqual(expect.arrayContaining(["+", "−", "⌂"]));
    expect(data.groups.length).toBeGreaterThan(0);
  });

  it("wheel-zooms, pans and resets without losing map binding", () => {
    const ui = render(`state selected=""
map bind=selected controls=true
  pin "Phoenix" lat=33.4484 lon=-112.074
`, { components });
    const before = ui.find("map").box!;
    const x = before.x + before.w / 2, y = before.y + before.h / 2;
    ui.wheel(x, y, -300);
    const afterZoom = ui.find("map").box!;
    const zoomed = (afterZoom.data as { view: { zoom: number; dx: number } }).view;
    expect(zoomed.zoom).toBeGreaterThan(1);
    ui.drag("map", x + 60, y + 40);
    const afterDrag = ui.find("map").box!;
    const dragged = (afterDrag.data as { view: { zoom: number; dx: number } }).view;
    expect(dragged.dx).not.toBe(zoomed.dx);
    expect(dragged.zoom).toBe(zoomed.zoom);
    const reset = { x: afterDrag.x + afterDrag.w - 21, y: afterDrag.y + 8 + 32 * 2 + 13 };
    ui.click(reset.x, reset.y);
    expect((ui.find("map").box!.data as { view: { zoom: number } }).view.zoom).toBe(1);
  });

  it("keeps existing pin clicks working with drag-to-pan enabled", () => {
    const ui = render(`state selected=""
map bind=selected
  pin "Phoenix" lat=33.4484 lon=-112.074
`, { components });
    const box = ui.find("map").box!;
    const data = box.data as { scale: number };
    const [x, y] = project(-112.074, 33.4484);
    ui.click(box.x + x * data.scale, box.y + y * data.scale);
    expect(ui.state.selected).toBe("Phoenix");
  });

  it("clusters nearby pins; clicking the cluster zooms into it", () => {
    const ui = render(`map cluster=true
  pin "Phoenix" lat=33.4484 lon=-112.074
  pin "Tucson" lat=32.2226 lon=-110.9747
`, { components });
    const box = ui.find("map").box!;
    const data = box.data as { view: { zoom: number }; groups: Array<{ items: unknown[]; x: number; y: number }> };
    const cluster = data.groups.find((g) => g.items.length === 2)!;
    expect(cluster).toBeDefined();
    ui.click(box.x + cluster.x, box.y + cluster.y);
    expect((ui.find("map").box!.data as { view: { zoom: number } }).view.zoom).toBeGreaterThan(data.view.zoom);
  });

  it("renders details on hover, including fields interpolated by the spec", () => {
    const ui = render(`state status="Delayed"
map
  pin "Phoenix" lat=33.4484 lon=-112.074 detail="Status: {status} | Contract: 120000"
`, { components });
    const box = ui.find("map").box!;
    const [x, y] = project(-112.074, 33.4484);
    const scale = (box.data as { scale: number }).scale;
    ui.canvas.dispatch("pointermove", { clientX: box.x + x * scale, clientY: box.y + y * scale, pointerId: 1 });
    ui.loom.renderNow();
    expect(ui.text()).toContain("Status: Delayed");
    expect(ui.text()).toContain("Contract: 120000");
  });

  it("does not zoom a noninteractive map", () => {
    const ui = render("map interactive=false", { components });
    const b = ui.find("map").box!;
    const x = b.x + b.w / 2, y = b.y + b.h / 2;
    expect(ui.canvas.dispatch("wheel", { clientX: x, clientY: y, deltaY: -100 })).toBe(false);
    ui.loom.renderNow();
    expect((ui.find("map").box!.data as { view: { zoom: number } }).view.zoom).toBe(1);
  });
});

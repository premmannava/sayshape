import { describe, expect, it } from "vitest";
import { chartHoverAt, morphPieSlices, smoothLineControls, type PieSlice, type ChartGeometry } from "../src/components/chart";
import { MotionValues } from "../src/motion";
import { render } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";

type Point = { x: number; y: number };
const TWO_PI = Math.PI * 2;

function makeSlices(rows: Array<[string, number]>): PieSlice[] {
  const total = rows.reduce((sum, [, value]) => sum + value, 0);
  let start = 0;
  return rows.map(([label, value], i) => {
    const share = value / total;
    const end = i === rows.length - 1 ? TWO_PI : start + share * TWO_PI;
    const item = { label, value, share, start, end, color: i };
    start = end;
    return item;
  });
}

function checkRing(slices: readonly PieSlice[]): void {
  expect(slices[0]?.start).toBeCloseTo(0, 9);
  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i]!;
    expect(slice.end).toBeGreaterThanOrEqual(slice.start);
    if (i) expect(slice.start).toBeCloseTo(slices[i - 1]!.end, 9);
  }
  expect(slices.at(-1)?.end).toBeCloseTo(TWO_PI, 9);
}

function cubic(p0: number, c1: number, c2: number, p1: number, t: number): number {
  const a = 1 - t;
  return a * a * a * p0 + 3 * a * a * t * c1 + 3 * a * t * t * c2 + t * t * t * p1;
}

describe("premium line curve geometry", () => {
  it("draws through actual data points using ordered x controls", () => {
    const points: Point[] = [
      { x: 0, y: 80 }, { x: 25, y: 30 }, { x: 50, y: 60 }, { x: 75, y: 40 }, { x: 100, y: 65 },
    ];
    const path = smoothLineControls(points);
    expect(path).toHaveLength(points.length - 1);
    path.forEach((segment, i) => {
      expect(segment.x).toBe(points[i + 1]!.x);
      expect(segment.y).toBe(points[i + 1]!.y);
      expect(segment.cx1).toBeGreaterThan(points[i]!.x);
      expect(segment.cx1).toBeLessThan(segment.cx2);
      expect(segment.cx2).toBeLessThan(points[i + 1]!.x);
    });
  });

  it("does not invent peaks or dips between real measurements", () => {
    for (const values of [
      [80, 20, 45, 10, 70],
      [30, 50, 70, 90, 100],
      [100, 100, 100, 100],
      [30, 32, 80, 81, 98],
      [90, 80, 80, 50, 10],
    ]) {
      const points = values.map((y, i) => ({ x: i * (i % 2 ? 24 : 35) + i * 20, y }));
      const path = smoothLineControls(points);
      for (let i = 0; i < path.length; i++) {
        const p0 = points[i]!, p1 = points[i + 1]!, c = path[i]!;
        const min = Math.min(p0.y, p1.y), max = Math.max(p0.y, p1.y);
        for (let t = 0; t <= 1; t += 0.05) {
          const y = cubic(p0.y, c.cy1, c.cy2, p1.y, t);
          expect(y).toBeGreaterThanOrEqual(min - 0.00001);
          expect(y).toBeLessThanOrEqual(max + 0.00001);
        }
      }
    }
  });

  it("handles empty, single point, two points and repeated x safely", () => {
    expect(smoothLineControls([])).toEqual([]);
    expect(smoothLineControls([{ x: 0, y: 1 }])).toEqual([]);
    expect(smoothLineControls([{ x: 0, y: 0 }, { x: 20, y: 20 }])).toHaveLength(1);
    const repeated = smoothLineControls([{ x: 1, y: 10 }, { x: 1, y: 20 }]);
    expect(repeated).toHaveLength(1);
    expect(Object.values(repeated[0]!).every(Number.isFinite)).toBe(true);
  });
});

describe("morphing pie/donut geometry", () => {
  it("follows interpolated weights while keeping the ring perfectly closed", () => {
    const before = makeSlices([["A", 5], ["B", 3], ["C", 2]]);
    const after = makeSlices([["A", 8], ["B", 1], ["C", 1]]);
    const motion = new MotionValues(), node = {}, frame = () => {};
    let at = 0;
    const paint = (slices: PieSlice[]) =>
      morphPieSlices(slices, (key, target) => motion.value(node, key, target, at, 520, true, frame));
    checkRing(paint(before));
    at = 20;
    checkRing(paint(after));
    at = 280;
    const middle = paint(after);
    checkRing(middle);
    const share = middle[0]!.end / TWO_PI;
    expect(share).toBeGreaterThan(before[0]!.share);
    expect(share).toBeLessThan(after[0]!.share);
    at = 540;
    const finished = paint(after);
    checkRing(finished);
    expect(finished[0]!.end).toBeCloseTo(after[0]!.end);
    // Neither original data array is mutated by visual interpolation.
    expect(before[0]!.share).toBe(0.5);
    expect(after[0]!.share).toBe(0.8);
  });

  it("reverses an interrupted animation without a jump", () => {
    const before = makeSlices([["A", 2], ["B", 8]]);
    const after = makeSlices([["A", 8], ["B", 2]]);
    const motion = new MotionValues(), node = {}, frame = () => {};
    let at = 0;
    const paint = (slices: PieSlice[]) =>
      morphPieSlices(slices, (key, target) => motion.value(node, key, target, at, 520, true, frame));
    paint(before);
    at = 20; paint(after);
    at = 280;
    const halfway = paint(after)[0]!.end;
    expect(paint(before)[0]!.end).toBeCloseTo(halfway);
    at = 800;
    expect(paint(before)[0]!.end).toBeCloseTo(before[0]!.end);
  });

  it("stays contiguous when categories are added and snaps for reduced motion", () => {
    const before = makeSlices([["A", 8], ["B", 2]]);
    const after = makeSlices([["A", 5], ["B", 2], ["C", 3]]);
    const motion = new MotionValues(), node = {}, frame = () => {};
    morphPieSlices(before, (key, value) => motion.value(node, key, value, 0, 520, true, frame));
    const entered = morphPieSlices(after, (key, value) => motion.value(node, key, value, 10, 520, true, frame));
    checkRing(entered);
    const snapped = morphPieSlices(after, (key, value) => motion.value(node, key, value, 100, 520, false, frame));
    checkRing(snapped);
    expect(snapped[2]!.end - snapped[2]!.start).toBeCloseTo(after[2]!.end - after[2]!.start);
  });

  it("keeps hover hit-testing tied to visibly morphed arcs", () => {
    const ui = render('state rows=[{k:"A",v:5},{k:"B",v:3},{k:"C",v:2}]\nchart kind=donut items=rows x=k y=v');
    const geom = ui.find("chart").box!.data as ChartGeometry;
    const slices = morphPieSlices(geom.pie!.slices, (_key, target) => target);
    const visible = { ...geom, pie: { ...geom.pie!, slices } };
    const p = visible.pie!, angle = (slices[1]!.start + slices[1]!.end) / 2 - Math.PI / 2;
    const radius = (p.inner + p.r) / 2;
    expect(chartHoverAt(visible, p.cx + Math.cos(angle) * radius, p.cy + Math.sin(angle) * radius)).toEqual({ kind: "slice", index: 1 });
    ui.destroy();
  });
});

describe("premium canvas chart treatments", () => {
  it.each([lightTheme, darkTheme].map((t) => [t.name, t] as const))("uses a subtle theme-derived gradient in %s", (_mode, theme) => {
    const ui = render('state rows=[{k:"Jan",v:20},{k:"Feb",v:35},{k:"Mar",v:26}]\nchart kind=line items=rows x=k y=v', { theme });
    const fills = ui.drawOps.filter((op) => op.op === "fill" && op.gradientStops?.length === 2);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills[0]!.gradientStops).toEqual([
      { offset: 0, color: theme.colors.accent },
      { offset: 1, color: theme.colors.raised },
    ]);
    expect(fills[0]!.globalAlpha).toBeLessThan(0.2);
    expect(ui.drawOps.some((op) => op.op === "stroke" && op.strokeStyle === theme.colors.accent)).toBe(true);
    ui.destroy();
  });

  it("keeps three-series comparison charts free from overlapping gradient washes", () => {
    const ui = render('state rows=[{k:"Jan",a:3,b:5,c:6},{k:"Feb",a:7,b:2,c:4}]\nchart kind=line items=rows x=k y=a,b,c');
    expect(ui.drawOps.some((op) => op.gradientStops?.length)).toBe(false);
    ui.destroy();
  });

  it.each(["pie", "donut"] as const)("keeps %s legends and slices in the existing theme palette", (kind) => {
    const ui = render('state rows=[{k:"A",v:5},{k:"B",v:3},{k:"C",v:2}]\nchart kind=' + kind + ' items=rows x=k y=v');
    expect(ui.diagnostics).toEqual([]);
    const fillColors = new Set(ui.drawOps.filter((op) => op.op === "fill").map((op) => op.fillStyle));
    expect(fillColors.size).toBeGreaterThan(2);
    ui.destroy();
  });
});

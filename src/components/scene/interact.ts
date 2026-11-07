/**
 * Pressable shapes in a scene: where they are, what's under a point, and how
 * hover, focus and selection look.
 *
 * Shapes have no boxes of their own, so a scene records the pressable ones
 * while it draws them (a shape, group or use with on=): each is a region with
 * a stable key, its exact outlines in canvas pixels (through every move, turn
 * and scale on the way), and the scope it was drawn with, so its actions see
 * the scene's each items. The scene then registers one hit region per key
 * with the engine (an upright box around it), refines hits exactly in
 * hitTest, runs on= in press, and lists them as parts for screen readers.
 *
 * All of it is rebuilt every frame, so regions follow animation. Nothing here
 * touches app state: hover and focus come from the engine.
 */
import type { Scope } from "../../expr";
import type { Rect, SayShapeNode } from "../../types";

/** An affine transform [a, b, c, d, e, f], as canvas setTransform takes it. */
export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const translate = (m: Matrix, x: number, y: number): Matrix => mul(m, [1, 0, 0, 1, x, y]);
export const rotate = (m: Matrix, rad: number): Matrix => mul(m, [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]);
export const scale = (m: Matrix, sx: number, sy: number): Matrix => mul(m, [sx, 0, 0, sy, 0, 0]);
export const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** The inverse transform, or null when it squashes everything flat (scale 0). */
export function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

/** One drawn outline of a pressable region, in its own coordinates, with the transform to canvas pixels. */
export type Geom =
  | { kind: "rect"; m: Matrix; x: number; y: number; w: number; h: number }
  | { kind: "ellipse"; m: Matrix; x: number; y: number; rx: number; ry: number }
  | { kind: "poly"; m: Matrix; pts: ReadonlyArray<readonly [number, number]> }
  | { kind: "line"; m: Matrix; x1: number; y1: number; x2: number; y2: number; width: number };

/** A pressable shape, group or use, as drawn this frame. */
export interface SceneRegion {
  /** Stable across frames: the line's id, plus which each copy and which use it's in. */
  key: string;
  node: SayShapeNode;
  /** The scope its props were read with (t, the scene's each items, a use's args), for its actions. */
  scope: Scope;
  on: string;
  tip?: string;
  name?: string;
  selected?: boolean;
  geoms: Geom[];
  /** Words of the labels drawn inside it, for its name. */
  words: string[];
}

/** How close to a line, in canvas pixels, still presses it. */
export const LINE_SLOP = 6;

/** The outline of a geometry in canvas pixels; closed unless it's a line. */
export function outline(g: Geom): Array<[number, number]> {
  switch (g.kind) {
    case "rect":
      return [apply(g.m, g.x, g.y), apply(g.m, g.x + g.w, g.y), apply(g.m, g.x + g.w, g.y + g.h), apply(g.m, g.x, g.y + g.h)];
    case "ellipse": {
      const out: Array<[number, number]> = [];
      for (let k = 0; k < 32; k++) {
        const a = (k * Math.PI) / 16;
        out.push(apply(g.m, g.x + g.rx * Math.cos(a), g.y + g.ry * Math.sin(a)));
      }
      return out;
    }
    case "poly":
      return g.pts.map(([x, y]) => apply(g.m, x, y));
    case "line":
      return [apply(g.m, g.x1, g.y1), apply(g.m, g.x2, g.y2)];
  }
}

export function boundsOf(pts: ReadonlyArray<readonly [number, number]>, pad = 0): Rect | null {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x0 > x1) return null;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

/** The upright box around a region's outlines, in canvas pixels. */
export function regionBounds(r: SceneRegion): Rect | null {
  let out: Rect | null = null;
  for (const g of r.geoms) {
    const b = boundsOf(outline(g), g.kind === "line" ? Math.max(LINE_SLOP, lineWidthOnScreen(g) / 2) : 0);
    if (!b) continue;
    out = out ? union(out, b) : b;
  }
  return out;
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

export const intersect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};

/** How wide a line is drawn on screen: its width times the transform's average stretch. */
function lineWidthOnScreen(g: Extract<Geom, { kind: "line" }>): number {
  return g.width * Math.sqrt(Math.abs(g.m[0] * g.m[3] - g.m[1] * g.m[2]));
}

/** Whether a canvas-pixel point is on this geometry: inside its outline, or near its line. */
export function geomHit(g: Geom, px: number, py: number): boolean {
  if (g.kind === "line") {
    const [[x1, y1], [x2, y2]] = outline(g) as [[number, number], [number, number]];
    return distToSegment(px, py, x1, y1, x2, y2) <= Math.max(LINE_SLOP, lineWidthOnScreen(g) / 2);
  }
  const inv = invert(g.m);
  if (!inv) return false;
  const [x, y] = apply(inv, px, py);
  switch (g.kind) {
    case "rect":
      return x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h;
    case "ellipse": {
      if (g.rx <= 0 || g.ry <= 0) return false;
      const dx = (x - g.x) / g.rx, dy = (y - g.y) / g.ry;
      return dx * dx + dy * dy <= 1;
    }
    case "poly":
      return inPolygon(x, y, g.pts);
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const u = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
  return Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy));
}

/** Even-odd: a point is inside when a ray from it crosses the outline an odd number of times. */
function inPolygon(x: number, y: number, pts: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** What a scene drew last frame: its box, and its pressable regions by key, in drawing order. */
export interface SceneLive {
  box: Rect;
  regions: Map<string, SceneRegion>;
}

/**
 * The latest frame of each scene element, kept weakly by its node so a scene
 * that's gone takes its regions with it.
 */
const live = new WeakMap<SayShapeNode, SceneLive>();

export function setLive(node: SayShapeNode, value: SceneLive): void {
  live.set(node, value);
}
export function liveOf(node: SayShapeNode): SceneLive | undefined {
  return live.get(node);
}

/** Whether a canvas-pixel point presses this region of a scene: inside the scene, and on one of its shapes. */
export function regionHit(scene: SceneLive, key: unknown, x: number, y: number): boolean {
  const b = scene.box;
  if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) return false;
  const r = typeof key === "string" ? scene.regions.get(key) : undefined;
  return !!r && r.geoms.some((g) => geomHit(g, x, y));
}

/** What a screen reader calls a region: its name=, else the words inside it, else its tip. */
export function regionName(r: SceneRegion): string {
  return (r.name?.trim() || r.words.join(" ").trim() || r.tip?.trim() || "Shape").slice(0, 200);
}

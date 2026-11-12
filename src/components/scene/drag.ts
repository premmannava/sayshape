/**
 * Dragging shapes in a scene (behavior on, `drag=true`). The shape's own x=
 * and y= say what it moves (src/drag-axis.ts): x={px} moves px; x={clamp(u,
 * 40, 560)} moves u between 40 and 560; any other formula holds that axis
 * still. The drag writes the pointer's place in the shape's parent
 * coordinates (through every group's move, turn and scale), less where it was
 * grabbed, kept inside the picture and clamp()'s bounds, rounded to a step
 * that fits the range. Arrow keys move it by a fiftieth of each range.
 *
 * Writes go through the engine like bind= (PressContext.set with the scope and
 * locate the shape was drawn with), so items of a scene's each can be dragged.
 */
import type { DragContext, PressContext } from "../../component";
import { evaluate, type Scope } from "../../expr";
import { dragAxis } from "../../drag-axis";
import { apply, invert, type Matrix, type SceneRegion } from "./interact";
import { SCENE_FUNCTIONS } from "./functions";
import type { Value } from "../../types";

/** The most draggable shapes one scene registers; past that they're drawn but can't be dragged. */
export const MAX_DRAGGABLE = 50;
/** How far the pointer moves before a press becomes a drag (a press that doesn't move presses on=). */
const DRAG_SLOP = 4;
/** Arrow keys move a fiftieth of the range; Page keys a tenth. */
const KEY_STEPS = 50;
const PAGE_STEPS = 10;
/** Drags write values rounded to about a five-hundredth of the range. */
const ROUND_STEPS = 500;

export interface DragAxis {
  /** The state name or item path it moves. */
  path: string;
  lo?: number;
  hi?: number;
}

export interface DragInfo {
  x?: DragAxis;
  y?: DragAxis;
  /** Where the shape's x and y are now, in its parent's coordinates. */
  ax: number;
  ay: number;
  /** The parent's coordinates to canvas pixels, and the scene's. */
  parent: Matrix;
  scene: Matrix;
  /** The scene's own size. */
  w: number;
  h: number;
}

const num = (v: Value | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function axisOf(raw: string | undefined, scope: Scope): DragAxis | undefined {
  const a = dragAxis(raw);
  if (!a) return undefined;
  const bound = (e: string | undefined) => {
    if (e === undefined) return undefined;
    const r = evaluate(e, scope, SCENE_FUNCTIONS);
    return r.ok ? num(r.value) : undefined;
  };
  const lo = bound(a.lo), hi = bound(a.hi);
  return { path: a.path, ...(lo !== undefined ? { lo } : {}), ...(hi !== undefined ? { hi } : {}) };
}

/** What a drag=true line moves, or undefined when neither axis can move. */
export function dragInfoOf(props: Readonly<Record<string, string>>, scope: Scope, ax: number, ay: number, parent: Matrix, scene: Matrix, w: number, h: number): DragInfo | undefined {
  const x = axisOf(props.x, scope), y = axisOf(props.y, scope);
  if (!x && !y) return undefined;
  return { ...(x ? { x } : {}), ...(y ? { y } : {}), ax, ay, parent, scene, w, h };
}

/** Keep an anchor inside the picture, then within each axis's clamp() bounds. */
export function limit(d: DragInfo, ax: number, ay: number): [number, number] {
  const sceneInv = invert(d.scene), parentInv = invert(d.parent);
  if (sceneInv && parentInv) {
    const [cx, cy] = apply(d.parent, ax, ay);
    const [sx, sy] = apply(sceneInv, cx, cy);
    const [kx, ky] = apply(d.scene, clamp(sx, 0, d.w), clamp(sy, 0, d.h));
    [ax, ay] = apply(parentInv, kx, ky);
  }
  if (d.x) ax = clamp(ax, d.x.lo ?? -Infinity, d.x.hi ?? Infinity);
  if (d.y) ay = clamp(ay, d.y.lo ?? -Infinity, d.y.hi ?? Infinity);
  return [ax, ay];
}

/** The lowest and highest an axis can go, in its own units. */
export function rangeOf(d: DragInfo, axis: "x" | "y"): { lo: number; hi: number } {
  const far = 1e9;
  const lo = axis === "x" ? limit(d, -far, d.ay)[0] : limit(d, d.ax, -far)[1];
  const hi = axis === "x" ? limit(d, far, d.ay)[0] : limit(d, d.ax, far)[1];
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

/** Round to a power of ten no larger than a five-hundredth of the range, without float noise. */
function rounded(v: number, range: number): number {
  if (!(range > 0)) return v;
  const exp = Math.floor(Math.log10(range / ROUND_STEPS));
  const step = Math.pow(10, exp);
  const r = Math.round(v / step) * step;
  return exp < 0 ? Number(r.toFixed(-exp)) : r;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Write a new anchor for the axes that move. */
function writeAnchor(ctx: PressContext, r: SceneRegion, d: DragInfo, ax: number, ay: number): void {
  [ax, ay] = limit(d, ax, ay);
  const own = { scope: r.scope, locate: r.locate };
  if (d.x) { const g = rangeOf(d, "x"); ctx.set(d.x.path, rounded(ax, g.hi - g.lo), own); }
  if (d.y) { const g = rangeOf(d, "y"); ctx.set(d.y.path, rounded(ay, g.hi - g.lo), own); }
}

/** Per scene element: the drag in progress. Kept by node, gone with it. */
interface Held {
  key: string;
  grabX: number;
  grabY: number;
  downX: number;
  downY: number;
  moved: boolean;
  /** The values when it started, to put back if the browser cancels the gesture. */
  start: Array<{ path: string; value: Value | undefined }>;
}
const held = new WeakMap<object, Held>();

/** The pointer side of a drag: start, move, end. regionOf finds the shape by key in the latest frame. */
export function dragShape(ctx: DragContext, regionOf: (key: string) => SceneRegion | undefined): void {
  const key = String(ctx.target.detail);
  const r = regionOf(key);
  const d = r?.drag;
  const node = ctx.target.node;
  if (ctx.phase === "start") {
    if (!r || !d) { held.delete(node); return; }
    const inv = invert(d.parent);
    const [px, py] = inv ? apply(inv, ctx.x, ctx.y) : [d.ax, d.ay];
    const read = (p: string) => { const v = evaluate(p, r.scope, SCENE_FUNCTIONS); return v.ok ? v.value : undefined; };
    held.set(node, {
      key, grabX: px - d.ax, grabY: py - d.ay, downX: ctx.x, downY: ctx.y, moved: false,
      start: [d.x, d.y].filter((a): a is DragAxis => !!a).map((a) => ({ path: a.path, value: read(a.path) })),
    });
    return;
  }
  const h = held.get(node);
  if (!h || h.key !== key) return;
  if (ctx.phase === "move") {
    if (!r || !d) return;
    if (!h.moved && Math.hypot(ctx.x - h.downX, ctx.y - h.downY) < DRAG_SLOP) return;
    h.moved = true;
    const inv = invert(d.parent);
    if (!inv) return;
    const [px, py] = apply(inv, ctx.x, ctx.y);
    writeAnchor(ctx, r, d, px - h.grabX, py - h.grabY);
    return;
  }
  held.delete(node);
  // The browser took the gesture over (a page scroll): put it back where it was.
  if (ctx.cancelled) {
    if (r && h.moved) for (const s of h.start) if (s.value !== undefined) ctx.set(s.path, s.value, { scope: r.scope, locate: r.locate });
    return;
  }
  // A press that didn't move presses it.
  if (!h.moved && r?.on) ctx.run(r.on, { scope: r.scope, locate: r.locate, functions: SCENE_FUNCTIONS });
}

/** Arrow keys, Page Up and Down, and (one axis) Home and End. Returns whether the key was used. */
export function keyShape(ctx: PressContext, r: SceneRegion | undefined, key: string): boolean {
  const d = r?.drag;
  if (!r || !d) return false;
  const gx = d.x ? rangeOf(d, "x") : null, gy = d.y ? rangeOf(d, "y") : null;
  const big = key === "PageUp" || key === "PageDown";
  const stepX = gx ? (gx.hi - gx.lo) / (big ? PAGE_STEPS : KEY_STEPS) : 0;
  const stepY = gy ? (gy.hi - gy.lo) / (big ? PAGE_STEPS : KEY_STEPS) : 0;
  let ax = d.ax, ay = d.ay;
  const oneAxis = !d.x !== !d.y;
  switch (key) {
    case "ArrowLeft": if (d.x) ax -= stepX; else if (d.y) ay += stepY; else return false; break;
    case "ArrowRight": if (d.x) ax += stepX; else if (d.y) ay -= stepY; else return false; break;
    // Up moves it up the screen (y gets smaller); on a sideways one it moves right, as on a slider.
    case "ArrowUp": if (d.y) ay -= stepY; else ax += stepX; break;
    case "ArrowDown": if (d.y) ay += stepY; else ax -= stepX; break;
    case "PageUp": if (d.y) ay -= stepY; else ax += stepX; break;
    case "PageDown": if (d.y) ay += stepY; else ax -= stepX; break;
    case "Home": if (!oneAxis) return false; if (gx) ax = gx.lo; if (gy) ay = gy.lo; break;
    case "End": if (!oneAxis) return false; if (gx) ax = gx.hi; if (gy) ay = gy.hi; break;
    default: return false;
  }
  writeAnchor(ctx, r, d, ax, ay);
  return true;
}

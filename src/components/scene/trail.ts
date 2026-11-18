/**
 * trail= in a scene: fading, shrinking copies of a line left behind as it moves.
 *
 * Stateless: nothing is remembered between frames. A copy is the same line
 * drawn again at an earlier scene time (f.time set back, drawn, put back), so
 * every formula of t, let and each item places it where the line really was.
 * That keeps trails deterministic, right with rate= (scene time, not real
 * time) and seamless across a loop's restart. Copies are drawn oldest first,
 * just before the line itself, so the line sits on top of its trail (and its
 * trail sorts with it under z=).
 *
 * Copies are only pictures: never pressable, never told to the drawing check
 * (f.press and f.onNode are off while they draw), and a trail inside a copy
 * is drawn plain. They draw only while the scene moves (the scene paint sets
 * f.trails only with motion on and a duration), so reduced motion, animate
 * off, stills and reviewScenes never draw them. They have their own budget
 * (MAX_TRAIL_DRAWS shapes a frame), outside the scene's shape and step
 * limits, so a heavy trail never stops the lines after it from drawing; when
 * a frame asks for more, every trail is thinned evenly the next frame.
 *
 * It takes the drawing and prop reading from draw.ts as arguments, so the two
 * modules don't import each other.
 */
import type { Scope } from "../../expr";
import type { SayShapeNode } from "../../types";
import type { Frame } from "./draw";
import { mul, type Matrix } from "./interact";
import { points } from "./path";

/** The most shapes trail copies draw in one frame, all trails together. */
export const MAX_TRAIL_DRAWS = 600;
/** The most copies one trail draws (trail-count=). */
export const MAX_TRAIL_COUNT = 24;
/** The longest trail, in scene seconds. */
export const MAX_TRAIL_SECONDS = 5;
const DEFAULT_TRAIL_COUNT = 12;
/** The newest copy's opacity; older ones fade from there. */
const TRAIL_ALPHA = 0.55;
/** How much the oldest copy has shrunk. */
const TRAIL_SHRINK = 0.6;

/** One frame's trails, set by the scene paint while it moves. */
export interface TrailState {
  /** Shapes copies may still draw this frame. */
  left: number;
  /** Lines copies may still work through this frame (the steps they don't take from the scene). */
  steps: number;
  /** Shapes every trail would have drawn this frame unthinned: next frame's thinning. */
  demand: number;
  /** Last frame's demand. */
  last: number;
  /** True while a copy draws: trails inside it are drawn plain. */
  inCopy: boolean;
  duration: number;
  loop: boolean;
  /** The longest trail drawn this frame, in seconds: how long after a non-looping end its tail still fades. */
  tail: number;
}

type Leaf = (node: SayShapeNode, scope: Scope, f: Frame) => void;

/** What drawing a trail needs from draw.ts. */
export interface TrailHooks {
  /** Draw one line as it is, without recording or trailing it (drawShape). */
  draw: Leaf;
  num: (node: SayShapeNode, key: string, scope: Scope, fallback?: number) => number;
  str: (node: SayShapeNode, key: string, scope: Scope) => string | undefined;
  /** The scene's own limits, which copies borrow with their own counts in them. */
  maxShapes: number;
  maxSteps: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The scene time a copy back seconds behind the line shows, or null when
 * nothing was on screen then.
 *
 * Looping: wraps, so right after a restart the copies are the end of the last
 * loop (what was really on screen a moment ago), except on the first play,
 * before which there was nothing. Not looping: played time minus back, and
 * once it has ended only the copies older than the end, so the tail fades out
 * and then nothing is left.
 */
export function sampleTime(back: number, t: number, played: number, duration: number, loop: boolean): number | null {
  if (!(duration > 0)) return null;
  if (loop) {
    if (back > played) return null;
    return (((t - back) % duration) + duration) % duration;
  }
  const at = Math.min(duration, played - back);
  if (at < 0) return null;
  if (t >= duration && at >= t) return null;
  return at;
}

/** The props a line's pivot is worked out from. */
const PLACE: Record<string, readonly string[]> = {
  group: ["x", "y"], use: ["x", "y"], circle: ["x", "y"], ellipse: ["x", "y"], label: ["x", "y"],
  rect: ["x", "y", "w", "h"], line: ["x1", "y1", "x2", "y2"],
};

/**
 * Where a copy shrinks around, at the copy's own time (a path has none: it
 * only fades), and the line with the props that took worked out, so drawing
 * the copy doesn't work them out again.
 */
export function pivotOf(node: SayShapeNode, scope: Scope, h: Pick<TrailHooks, "num" | "str">): { at: [number, number]; node: SayShapeNode } | null {
  if (node.type === "polygon") {
    const raw = h.str(node, "points", scope) ?? "";
    const pts = points(raw);
    if (!pts.length) return null;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { at: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], node: settled(node, { points: raw }) };
  }
  const keys = PLACE[node.type];
  if (!keys) return null;
  const v: Record<string, number> = {};
  for (const k of keys) v[k] = h.num(node, k, scope, 0);
  const at: [number, number] = node.type === "rect" ? [v.x! + v.w! / 2, v.y! + v.h! / 2]
    : node.type === "line" ? [(v.x1! + v.x2!) / 2, (v.y1! + v.y2!) / 2]
    : [v.x!, v.y!];
  return { at, node: settled(node, Object.fromEntries(keys.filter((k) => node.props[k] !== undefined).map((k) => [k, String(v[k])]))) };
}

/** The line with these props written as plain values (same id, children and everything else). */
function settled(node: SayShapeNode, props: Record<string, string>): SayShapeNode {
  return Object.keys(props).length ? { ...node, props: { ...node.props, ...props } } : node;
}

/** Draw a line's trail: its copies at earlier scene times, oldest and faintest first. */
export function drawTrail(node: SayShapeNode, scope: Scope, f: Frame, hooks: TrailHooks): void {
  const tr = f.trails;
  if (!tr || tr.inCopy) return;
  const seconds = clamp(hooks.num(node, "trail", scope, 0), 0, MAX_TRAIL_SECONDS);
  if (!(seconds > 0)) return;
  const n = node.props["trail-count"] === undefined
    ? DEFAULT_TRAIL_COUNT
    : clamp(Math.round(hooks.num(node, "trail-count", scope, DEFAULT_TRAIL_COUNT)), 1, MAX_TRAIL_COUNT);
  tr.tail = Math.max(tr.tail, seconds);
  const step = seconds / n;
  // Last frame asked for more than the budget: draw every trail with fewer, evenly spaced copies.
  const kept = Math.max(1, Math.floor(n * Math.min(1, tr.last > 0 ? MAX_TRAIL_DRAWS / tr.last : 1)));
  const g = f.g;
  const time = f.time, played = f.played ?? f.time;
  const press = f.press, onNode = f.onNode, shapes = f.shapes, steps = f.steps, m = f.m;
  f.press = undefined;
  f.onNode = undefined;
  tr.inCopy = true;
  let drawn = 0, copies = 0;
  try {
    for (let j = kept; j >= 1; j--) {
      if (tr.left <= 0 || tr.steps <= 0) break;
      const k = (j * n) / kept;
      const at = sampleTime(k * step, time, played, tr.duration, tr.loop);
      if (at === null) continue;
      f.time = at;
      const u = k / (n + 1);
      const s = 1 - TRAIL_SHRINK * u;
      const pivot = pivotOf(node, scope, hooks);
      // The copy counts against the trail budget through the scene's own limits, which stop its lines when it runs out.
      const shapesFrom = hooks.maxShapes - tr.left, stepsFrom = hooks.maxSteps - tr.steps;
      f.shapes = shapesFrom;
      f.steps = stepsFrom;
      f.m = m;
      g.save();
      if (pivot) {
        // Shrink around the pivot: translate(p), scale(s), translate(-p) in one call.
        const shrink: Matrix = [s, 0, 0, s, pivot.at[0] * (1 - s), pivot.at[1] * (1 - s)];
        g.transform(...shrink);
        f.m = mul(m, shrink);
      }
      g.globalAlpha *= TRAIL_ALPHA * Math.pow(1 - u, 1.5);
      hooks.draw(pivot?.node ?? node, scope, f);
      g.restore();
      const used = f.shapes - shapesFrom;
      tr.left -= used;
      tr.steps -= Math.max(0, f.steps - stepsFrom);
      drawn += used;
      copies++;
    }
  } finally {
    f.time = time; f.press = press; f.onNode = onNode; f.shapes = shapes; f.steps = steps; f.m = m;
    tr.inCopy = false;
  }
  // What the whole trail would cost, at what one copy of this line costs.
  tr.demand += n * (copies ? drawn / copies : 1);
}

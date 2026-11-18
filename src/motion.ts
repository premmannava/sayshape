/**
 * Scalar motion for the SayShape canvas renderer.
 *
 * Components share this clock instead of owning timers. Weak ownership means
 * old parsed screens are released automatically. A first render is already
 * at its real value; only subsequent changes animate.
 */
import { easeOut } from "./ghost";

interface Track { from: number; to: number; start: number; duration: number }

function sample(s: Track, at: number): number {
  if (s.duration <= 0) return s.to;
  const t = Math.max(0, Math.min(1, (at - s.start) / s.duration));
  return s.from + (s.to - s.from) * easeOut(t);
}

export class MotionValues {
  private nodes = new WeakMap<object, Map<string, Track>>();

  value(node: object, key: string, target: number, at: number, duration: number, enabled: boolean, frame: () => void): number {
    if (!Number.isFinite(target)) return 0;
    let values = this.nodes.get(node);
    if (!values) { values = new Map(); this.nodes.set(node, values); }
    const previous = values.get(key);
    if (!enabled || !Number.isFinite(at) || !Number.isFinite(duration) || duration <= 0) {
      values.set(key, { from: target, to: target, start: at, duration: 0 });
      return target;
    }
    if (!previous) {
      values.set(key, { from: target, to: target, start: at, duration });
      return target;
    }
    if (previous.to !== target) {
      const current = sample(previous, at);
      values.set(key, { from: current, to: target, start: at, duration });
      if (current !== target) frame();
      return current;
    }
    const current = sample(previous, at);
    if (current !== target && at < previous.start + previous.duration) frame();
    return current;
  }
}

/** The entrances a spec can ask for with enter=. */
export const ENTER_ROLES = ["fade", "rise", "scale"] as const;
export type EnterRole = (typeof ENTER_ROLES)[number];

/** How long an entrance takes. */
export const ENTER_MS = 520;
/** How long the plain fade-in of a new element (with no enter=) takes. */
export const APPEAR_MS = 240;
/** The wait between one child's entrance and the next under stagger=true. */
export const STAGGER_MS = 80;
/** Children past this many in one frame start with the last step, so a long list doesn't take seconds. */
export const MAX_STAGGER_STEPS = 10;
/** scale starts at this size of the element's own. */
export const ENTER_SCALE = 0.94;
/** How much of an element (in CSS pixels, or all of it when smaller) must be in sight before it enters. */
export const SIGHT_PX = 24;

/** Where an entrance is, for one frame: how opaque, how far down and how large. */
export interface EnterPose { alpha: number; dy: number; scale: number }

/** The pose of an entrance at progress p (0..1, before easing): rise moves up by `rise` pixels, scale grows from ENTER_SCALE. */
export function enterPose(role: EnterRole, p: number, rise: number): EnterPose {
  const e = easeOut(Math.max(0, Math.min(1, p)));
  return {
    alpha: e,
    dy: role === "rise" ? (1 - e) * rise : 0,
    scale: role === "scale" ? ENTER_SCALE + (1 - ENTER_SCALE) * e : 1,
  };
}

/**
 * When each element began something that plays once (its fade-in, its
 * entrance, a component's long-running motion), by element id and name.
 * Ids are the element's line and type, so these carry across re-parses and
 * streamed lines: an element already shown never plays again. A spec edit
 * that moves lines up or down moves these with them (remap).
 */
export class MotionStarts {
  private at = new Map<string, number>();

  get(id: string, name: string): number | undefined {
    return this.at.get(`${name}\u0000${id}`);
  }

  set(id: string, name: string, t: number): void {
    this.at.set(`${name}\u0000${id}`, t);
  }

  clear(): void {
    this.at.clear();
  }

  /**
   * Move every start along with its element's line after a spec edit: `line`
   * gives an old line's new number, or null when that line was changed or
   * removed (what it held is new, so it plays as new).
   */
  remap(line: (old: number) => number | null): void {
    const next = new Map<string, number>();
    for (const [key, t] of this.at) {
      const cut = key.indexOf("\u0000");
      const id = key.slice(cut + 1);
      const m = /^(\d+):/.exec(id);
      if (!m) { next.set(key, t); continue; }
      const to = line(Number(m[1]));
      if (to !== null) next.set(`${key.slice(0, cut)}\u0000${to}${id.slice(m[1]!.length)}`, t);
    }
    this.at = next;
  }
}

/**
 * Where each line of an old spec is in a new one, from the lines the two
 * share at the start and at the end: a model's edit (a line inserted,
 * replaced or deleted) leaves the rest where it was, shifted. Lines in
 * between changed, so they map to null. Lines count from 1.
 */
export function lineShift(before: string, after: string): (old: number) => number | null {
  if (before === after) return (n) => n;
  const a = before.split("\n"), b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const shift = b.length - a.length;
  return (n) => (n <= head ? n : n > a.length - tail ? n + shift : null);
}

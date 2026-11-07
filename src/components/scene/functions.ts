/**
 * The math a scene's lines can call, on top of the built-in functions. Only
 * lines inside a scene see these (ComponentDef.provides): everywhere else they
 * are unknown functions, so the language outside scenes doesn't change.
 *
 * Each is a pure function of its arguments: no state, no clock, no host
 * objects. random() is repeatable for a seed, so a frame is the same every
 * time it's drawn, and so is a saved picture.
 */
import { isList, makeList, toNumber } from "../../data";
import { expressionFunctions, type ExpressionFunctions } from "../../expr";
import type { Value } from "../../types";

/** The most items range() makes, so a formula can't ask for millions. */
export const MAX_RANGE = 500;

const n = (v: Value | undefined): number => (v === undefined ? NaN : toNumber(v));
const unit = (x: number) => Math.min(1, Math.max(0, x));

export const SCENE_FUNCTIONS: ExpressionFunctions = expressionFunctions({
  sin: (x) => Math.sin(n(x)),
  cos: (x) => Math.cos(n(x)),
  tan: (x) => Math.tan(n(x)),
  atan2: (y, x) => Math.atan2(n(y), n(x)),
  sqrt: (x) => Math.sqrt(n(x)),
  /** clamp(x, low, high) */
  clamp: (x, a, b) => Math.min(n(b), Math.max(n(a), n(x))),
  /** lerp(a, b, u): from a (u = 0) to b (u = 1). */
  lerp: (a, b, u) => n(a) + (n(b) - n(a)) * n(u),
  /** ease(t, start, end): 0 before start, 1 after end, eased out between them. */
  ease: (t, a, b) => {
    const start = n(a), end = n(b);
    const u = unit((n(t) - start) / (end - start || 1));
    return 1 - Math.pow(1 - u, 3);
  },
  /** wave(t, seconds): 0 → 1 → 0 smoothly, once every period. */
  wave: (t, p) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n(t)) / (n(p) || 1)),
  /** random(seed): the same number in [0, 1) every time for the same seed. */
  random: (seed) => {
    const x = Math.sin(n(seed) * 12.9898 + 78.233) * 43758.5453;
    return Number.isFinite(x) ? x - Math.floor(x) : 0;
  },
  /** range(n): [0, 1, …, n - 1], at most MAX_RANGE items. */
  range: (count) => {
    const c = Math.max(0, Math.min(MAX_RANGE, Math.floor(n(count)) || 0));
    return makeList(Array.from({ length: c }, (_, i) => i));
  },
  /** pick(list, i): item i, wrapping around, so pick(colors, i) cycles through them. */
  pick: (list, i) => {
    if (!isList(list) || !list.length) return null;
    const k = Math.floor(n(i)) || 0;
    return list[((k % list.length) + list.length) % list.length] ?? null;
  },
});

/** Names a scene fills in for its lines. */
export const SCENE_NAMES = ["t", "PI"] as const;

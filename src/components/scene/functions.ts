/**
 * The math a scene's lines can call, on top of the built-in functions. Only
 * lines inside a scene see these (ComponentDef.provides): everywhere else they
 * are unknown functions, so the language outside scenes doesn't change.
 *
 * Each is a pure function of its arguments: no state, no clock, no host
 * objects. random() is repeatable for a seed, so a frame is the same every
 * time it's drawn, and so is a saved picture.
 */
import { isList, toNumber } from "../../data";
import { counting, expressionFunctions, type ExpressionFunctions } from "../../expr";
import { PURE_MATH } from "../../math";
import type { Value } from "../../types";

/** The most items range() makes, so a formula can't ask for millions. */
export const MAX_RANGE = 500;

const n = (v: Value | undefined): number => (v === undefined ? NaN : toNumber(v));
const unit = (x: number) => Math.min(1, Math.max(0, x));

export const SCENE_FUNCTIONS: ExpressionFunctions = expressionFunctions({
  ...PURE_MATH,
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
  /**
   * range(n): [0, 1, …, n - 1], and range(from, to) up to, not including, to, like the built-in
   * range(), but cut to MAX_RANGE items rather than an error, and empty for what isn't a number,
   * so a drawing never stops over it. The one built-in a scene replaces (REPLACEABLE in expr.ts).
   */
  range: (a, b) => {
    const from = b === undefined ? 0 : Math.floor(n(a)) || 0;
    const to = Math.floor(n(b === undefined ? a : b)) || 0;
    return counting(from, Math.min(MAX_RANGE, to - from));
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

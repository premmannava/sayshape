/**
 * Pure math shared by the opt-in features that move things: a scene's lines
 * and, with behavior on, a rule's do= and if=. Each is a function of its
 * arguments only: no state, no clock, no host objects.
 *
 * They're not core expression functions: outside a scene, and outside rules,
 * they stay unknown, so the language with both features off doesn't change.
 */
import { toNumber } from "./data";
import { expressionFunctions, type ExpressionFunctions, type Fn } from "./expr";
import type { Value } from "./types";

export const num = (v: Value | undefined): number => (v === undefined ? NaN : toNumber(v));

export const PURE_MATH: Readonly<Record<string, Fn>> = {
  sin: (x: Value) => Math.sin(num(x)),
  cos: (x: Value) => Math.cos(num(x)),
  tan: (x: Value) => Math.tan(num(x)),
  atan2: (y: Value, x: Value) => Math.atan2(num(y), num(x)),
  sqrt: (x: Value) => Math.sqrt(num(x)),
  /** clamp(x, low, high) */
  clamp: (x: Value, a: Value, b: Value) => Math.min(num(b), Math.max(num(a), num(x))),
  /** lerp(a, b, u): from a (u = 0) to b (u = 1). */
  lerp: (a: Value, b: Value, u: Value) => num(a) + (num(b) - num(a)) * num(u),
};

/** What a rule's do= and if= may call beyond the built-in functions. */
export const RULE_FUNCTIONS: ExpressionFunctions = expressionFunctions({ ...PURE_MATH });

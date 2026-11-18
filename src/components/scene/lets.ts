/**
 * let a={…} in a scene: a named value for the lines below it in its block.
 *
 * The scene draws a block's lines in order with one scope; a let line wraps
 * that scope, so the lines after it (and the blocks inside them) read the name
 * and the lines before it don't. A let is worked out in the scope above it,
 * so it can read t, the item, state and earlier lets, and a let can shadow a
 * name from further out (let a={a*2}).
 *
 * It's worked out when first read and kept for the rest of the moment
 * (f.time): once per frame however many shapes read it, and again when a
 * drawing is redrawn at another moment (trails set f.time).
 */
import { evaluate, wholeExpression, type Scope } from "../../expr";
import type { SayShapeNode, Value } from "../../types";
import { SCENE_FUNCTIONS } from "./functions";

/** The scope after a let line: its name reads its value at f.time, every other name reads outer. */
export function letScope(node: SayShapeNode, outer: Scope, f: { time: number }): Scope {
  const name = node.props.name ?? "";
  const raw = node.props.value ?? "";
  const expr = wholeExpression(raw);
  let at = NaN;
  let value: Value | undefined;
  const memo = (): Value | undefined => {
    if (at === f.time) return value;
    at = f.time;
    if (expr === null) {
      const n = Number(raw);
      value = raw.trim() !== "" && Number.isFinite(n) ? n : undefined;
    } else {
      const r = evaluate(expr, outer, SCENE_FUNCTIONS);
      value = r.ok ? r.value : undefined;
    }
    return value;
  };
  return (n) => (n === name ? memo() : outer(n));
}

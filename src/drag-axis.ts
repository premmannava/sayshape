/**
 * Which state a dragged shape's x= or y= moves (behavior's drag=true in a
 * scene). An axis moves when it's written as exactly a name or path,
 * x={px} or x={p.x}, or as one clamped, x={clamp(u, 40, 560)}; any other
 * formula holds that axis still. The drawing is made from the value the drag
 * writes, so the two can't disagree.
 *
 * Shared by the parser (checks) and the scene (dragging), so both read an
 * axis the same way.
 */
import { wholeExpression } from "./expr";

export interface AxisTarget {
  /** The state name or item path the axis moves, like px or p.x. */
  path: string;
  /** clamp()'s bounds, as expressions. */
  lo?: string;
  hi?: string;
}

const PATH_RE = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
const WORDS = new Set(["true", "false", "null", "t", "PI"]);

/** The target of one axis's prop as written, or null when that axis doesn't move. */
export function dragAxis(raw: string | undefined): AxisTarget | null {
  if (raw === undefined) return null;
  const expr = (wholeExpression(raw) ?? raw).trim();
  if (PATH_RE.test(expr)) return WORDS.has(expr) ? null : { path: expr };
  const m = /^clamp\s*\((.*)\)$/s.exec(expr);
  if (!m) return null;
  const args = splitArgs(m[1]!);
  if (args.length !== 3) return null;
  const path = args[0]!.trim();
  if (!PATH_RE.test(path) || WORDS.has(path)) return null;
  return { path, lo: args[1]!.trim(), hi: args[2]!.trim() };
}

/** The names and paths an expression reads (not the functions it calls, not words in quotes). */
export function readPaths(expr: string): string[] {
  const plain = expr.replace(/'[^']*'|"[^"]*"/g, " ");
  const out = new Set<string>();
  for (const m of plain.matchAll(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\b(?!\s*\()/g)) {
    if (!WORDS.has(m[1]!)) out.add(m[1]!);
  }
  return [...out];
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, buf = "", quote = "";
  for (const c of s) {
    if (quote) { if (c === quote) quote = ""; }
    else if (c === "'" || c === '"') quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0 && !quote) { out.push(buf); buf = ""; } else buf += c;
  }
  out.push(buf);
  return out;
}

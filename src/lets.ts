/**
 * A scene's let lines, as the parser reads them: let a={t*2} names one value
 * for the lines below it in its block (the scene, a group, an each copy, an
 * if block, a drawing). The scene works them out as it draws
 * (components/scene/lets.ts); here they're checked: the line's shape, which
 * lets each line can see, and lets that need themselves.
 */
import { checkSyntax, wholeExpression, type ExpressionFunctions } from "./expr";
import type { Diagnostic, SayShapeNode } from "./types";

/** Names a scene fills in itself, which a let can't take. */
const SCENE_OWN: Record<string, string> = {
  t: "t is the scene's time, so a let can't take that name. This line was skipped; call it something else, like let t2={…}",
  PI: "PI is the scene's π, so a let can't take that name. This line was skipped; call it something else, like let p2={…}",
};

const NAME = /^[A-Za-z_]\w*$/;

/**
 * Why a let line inside a scene can't be used, or null with its name and
 * formula. One name, its formula in braces (or a plain number), nothing else.
 */
export function readLet(
  tok: { text?: string; props: Record<string, string>; quoted: ReadonlySet<string>; problems: readonly string[] },
  fns?: ExpressionFunctions,
): { error: string } | { name: string; value: string } {
  const entries = Object.entries(tok.props);
  const shape = { error: "A let line names one value with a formula in braces, like let a={t*2}. This line was skipped" };
  if (tok.problems.length || tok.text !== undefined || entries.length !== 1) return shape;
  const [name, raw] = entries[0]!;
  if (!NAME.test(name)) return shape;
  const own = Object.hasOwn(SCENE_OWN, name) ? SCENE_OWN[name] : undefined;
  if (own) return { error: own };
  const expr = tok.quoted.has(name) ? null : wholeExpression(raw);
  if (expr === null && (tok.quoted.has(name) || raw.trim() === "" || !Number.isFinite(Number(raw)))) {
    return { error: `let ${name} needs its formula in braces, like let ${name}={t*2}; for text or a color, quote it inside: let c={'#E63946'}. This line was skipped` };
  }
  if (expr !== null) {
    const err = checkSyntax(expr, fns);
    if (err) return { error: `let ${name}: ${err}. This line was skipped` };
  }
  return { name, value: raw };
}

/** The most let lines a spec may have: past it they're skipped, so checking which lets a line sees stays cheap. */
export const MAX_LETS = 200;

const NONE: ReadonlyMap<string, SayShapeNode> = new Map();

/**
 * The lets a line can see: those above it in its block and in every block around it, nearest first by name.
 * letsOf holds each block's let lines as they're read, so a block of thousands of shapes isn't walked per line.
 */
export function visibleLets(stack: readonly SayShapeNode[], letsOf?: WeakMap<SayShapeNode, SayShapeNode[]>): ReadonlyMap<string, SayShapeNode> {
  if (letsOf) {
    let out: Map<string, SayShapeNode> | null = null;
    for (const n of stack) {
      const own = letsOf.get(n);
      if (!own) continue;
      out ??= new Map();
      for (const c of own) if (c.props.name) out.set(c.props.name, c);
    }
    return out ?? NONE;
  }
  const out = new Map<string, SayShapeNode>();
  // Every child of an open block is above the line being read; inner blocks come later and win.
  for (const n of stack) for (const c of n.children) if (c.type === "let" && c.props.name) out.set(c.props.name, c);
  return out;
}

/** A let line as parsed: where it is, what it reads and what it could see. */
export interface LetLine {
  node: SayShapeNode;
  parent: SayShapeNode;
  reads: readonly string[];
  /** The lets above it (visibleLets). */
  lets: ReadonlyMap<string, SayShapeNode>;
  /** Every name it can read without state: loop variables, t and PI, lets above it. */
  scope: ReadonlySet<string>;
}

/**
 * Once every line is known: lets that need themselves (a → b → a, through a
 * let further down that it can't see yet) are reported and taken out of the
 * tree; then a line that reads a let it can't see is told where that let is,
 * instead of being told the name doesn't exist. Returns the uses still to
 * check as ordinary names.
 */
export function checkLets(
  lets: readonly LetLine[],
  defined: ReadonlySet<string>,
  uses: ReadonlyArray<{ line: number; names: string[] }>,
  diags: Diagnostic[],
): Array<{ line: number; names: string[] }> {
  if (!lets.length) return [...uses];
  const byNode = new Map(lets.map((l) => [l.node, l]));
  const needs = new Map<SayShapeNode, SayShapeNode[]>();
  for (const l of lets) {
    const out: SayShapeNode[] = [];
    for (const r of l.reads) {
      const seen = l.lets.get(r);
      if (seen) { out.push(seen); continue; }
      if (l.scope.has(r) || defined.has(r)) continue;
      // Not seen from here: a let of that name at or below this one in the same block would make a loop.
      const sibs = l.parent.children;
      const later = sibs.slice(sibs.indexOf(l.node)).find((c) => c.type === "let" && c.props.name === r);
      if (later) out.push(later);
    }
    needs.set(l.node, out);
  }
  const cyclic = new Set<SayShapeNode>();
  const state = new Map<SayShapeNode, "visiting" | "done">();
  const path: SayShapeNode[] = [];
  const visit = (n: SayShapeNode): void => {
    const s = state.get(n);
    if (s === "done") return;
    if (s === "visiting") {
      const loop = path.slice(path.indexOf(n));
      const fresh = loop.filter((x) => !cyclic.has(x));
      loop.forEach((x) => cyclic.add(x));
      if (fresh.length) {
        const first = loop.reduce((a, b) => (b.line < a.line ? b : a));
        const at = loop.indexOf(first);
        const names = [...loop.slice(at), ...loop.slice(0, at), first].map((x) => x.props.name);
        const what = loop.length > 1 ? "none of these are worked out and their lines were skipped" : "it isn't worked out and the line was skipped";
        diags.push({ line: first.line, severity: "error", message: `let ${names[0]} depends on itself (${names.join(" → ")}), so ${what}. A let sees only the lets above it: work one of them out from t, the item or state` });
      }
      return;
    }
    if (!byNode.has(n)) return;
    state.set(n, "visiting");
    path.push(n);
    for (const m of needs.get(n) ?? []) visit(m);
    path.pop();
    state.set(n, "done");
  };
  for (const l of lets) visit(l.node);
  for (const n of cyclic) {
    const l = byNode.get(n)!;
    const i = l.parent.children.indexOf(n);
    if (i >= 0) l.parent.children.splice(i, 1);
  }
  const skipped = new Set([...cyclic].map((n) => n.line));
  const all = lets.filter((l) => !cyclic.has(l.node)).map((l) => l.node);
  const out: Array<{ line: number; names: string[] }> = [];
  for (const u of uses) {
    if (skipped.has(u.line)) continue;
    const names: string[] = [];
    for (const name of u.names) {
      const named = defined.has(name) ? [] : all.filter((n) => n.props.name === name);
      if (!named.length) { names.push(name); continue; }
      // The nearest let of that name, most likely the one meant.
      const near = named.reduce((a, b) => (Math.abs(b.line - u.line) < Math.abs(a.line - u.line) ? b : a));
      diags.push({ line: u.line, severity: "warning", message: `"${name}" is named by the let on line ${near.line}, which doesn't reach this line: a let counts only for the lines below it in its own block. Move it above this line, or out into the block around both` });
    }
    if (names.length) out.push({ line: u.line, names });
  }
  return out;
}

/**
 * Headless layout: turns a node tree into positioned boxes using only a
 * TextMeasurer, so it runs (and is tested) without a canvas.
 */
import { localToday } from "./dates";
import { PropReader, type ChildTransform, type ElementView, type LayoutContext } from "./component";
import { eachInstances, MAX_EACH_ELEMENTS, scopeOf, type EachBudget } from "./each";
import { bareExpression, evaluate, type Scope } from "./expr";
import type { Registry } from "./registry";
import type { TextMeasurer } from "./text";
import type { Theme } from "./theme";
import type { Box, SayShapeNode } from "./types";

/** Whether a node is shown: its `if=` passes and, given a registry, its component's visible() agrees. */
export function isVisible(node: SayShapeNode, base: Scope, registry?: Registry): boolean {
  const scope = scopeOf(node, base);
  const own = registry?.get(node.type)?.visible;
  if (own && !own(node, scope)) return false;
  const raw = node.props.if;
  if (raw === undefined) return true;
  const expr = bareExpression(raw);
  const r = evaluate(expr, scope);
  return r.ok && !!r.value;
}

export function shiftBox(box: Box, dx: number, dy: number): void {
  box.x += dx;
  box.y += dy;
  for (const k of box.children) shiftBox(k, dx, dy);
}

/**
 * A node's children as they should be laid out: hidden ones (`if=`) left out,
 * and every `each` replaced by its copies, one set per item.
 */
export function shownChildren(node: SayShapeNode, scope: Scope, registry?: Registry, warn?: (message: string) => void, budget?: EachBudget): SayShapeNode[] {
  const out: SayShapeNode[] = [];
  const add = (kids: readonly SayShapeNode[]) => {
    for (const c of kids) {
      // An each's if= is worked out per item, with the item in scope (see eachInstances).
      if (c.type === "each") { add(eachInstances(c, scopeOf(c, scope), warn, budget)); continue; }
      if (!isVisible(c, scope, registry)) continue;
      // A passing if= block stands for the lines under it.
      if (c.type === "if") add(c.children);
      else out.push(c);
    }
  };
  add(node.children);
  return out;
}

export function createLayoutContext(
  registry: Registry, theme: Theme, measure: TextMeasurer, scope: Scope, warn?: (message: string) => void, today: () => string = localToday,
  isLoading?: (node: SayShapeNode) => boolean,
  view?: (node: SayShapeNode) => ElementView,
): LayoutContext {
  const readers = new WeakMap<SayShapeNode, PropReader>();
  // Containers may ask more than once per layout; copies must stay the same objects.
  const kids = new WeakMap<SayShapeNode, SayShapeNode[]>();
  const budget: EachBudget = { left: MAX_EACH_ELEMENTS };
  // Rows ask for their children's minimum widths, which may ask in turn; work each out once per layout.
  const mins = new WeakMap<SayShapeNode, number>();
  // The first layout call is the whole screen's.
  let screen = -1;
  const overlays: SayShapeNode[] = [];
  /** Overlays set aside from each element's children, collected once that element is laid out. */
  const setAside = new Map<SayShapeNode, SayShapeNode[]>();
  /** The elements being laid out, innermost last. */
  const laying: SayShapeNode[] = [];
  const ctx: LayoutContext = {
    theme,
    measure,
    scope,
    overlays,
    ...(view ? { view } : {}),
    props(node) {
      let r = readers.get(node);
      if (!r) readers.set(node, (r = new PropReader(node, scopeOf(node, scope))));
      return r;
    },
    layout(node, x, y, width) {
      return layoutIn(ctx, node, x, y, width);
    },
    visibleChildren(node) {
      let k = kids.get(node);
      if (!k) {
        // Overlays (a dialog) take no room where they're written: set aside for the engine.
        const all = shownChildren(node, scope, registry, warn, budget);
        k = all.filter((c) => !registry.get(c.type)?.overlay);
        const aside = all.filter((c) => registry.get(c.type)?.overlay);
        if (aside.length) setAside.set(node, aside);
        kids.set(node, k);
      }
      // Only overlays among children an element's own layout asks for count: not those in a
      // closed accordion or an unselected tab, which are looked at for widths but never laid out.
      const aside = laying[laying.length - 1] === node ? setAside.get(node) : undefined;
      if (aside?.some((c) => !overlays.includes(c))) {
        for (const c of aside) if (!overlays.includes(c)) overlays.push(c);
        // Spec order, so "the first open one written" holds however deep each sits.
        overlays.sort((a, b) => a.line - b.line);
      }
      return k;
    },
    minWidth(node) {
      return minWidthIn(ctx, node);
    },
    screenWidth: () => Math.max(0, screen),
    shift: shiftBox,
    warn,
    today,
    ...(isLoading ? { isLoading } : {}),
  };
  /** The context an element and what's inside it work in: its own theme, when it has one (a slide's). */
  const themed = new WeakMap<Theme, LayoutContext>();
  const within = (c: LayoutContext, node: SayShapeNode): LayoutContext => {
    const own = registry.get(node.type)?.theme;
    if (!own) return c;
    const t = own(c.theme);
    if (t === c.theme) return c;
    let d = themed.get(t);
    if (!d) {
      const inner: LayoutContext = { ...c, theme: t, layout: (n, x, y, w) => layoutIn(inner, n, x, y, w), minWidth: (n) => minWidthIn(inner, n) };
      themed.set(t, (d = inner));
    }
    return d;
  };
  function layoutIn(outer: LayoutContext, node: SayShapeNode, x: number, y: number, width: number): Box {
    if (screen < 0) screen = Math.max(0, width);
    const box: Box = { node, x, y, w: Math.max(0, width), h: 0, children: [] };
    const def = registry.get(node.type);
    laying.push(node);
    try {
      if (def) def.layout(box, within(outer, node));
    } finally {
      laying.pop();
    }
    return box;
  }
  function minWidthIn(outer: LayoutContext, node: SayShapeNode): number {
      const ctx = within(outer, node);
      let w = mins.get(node);
      if (w === undefined) {
        const def = registry.get(node.type);
        if (def?.minWidth) w = def.minWidth(node, ctx);
        else if (def?.children) {
          // Containers: their widest child, plus padding on both sides when they have a pad prop.
          const padDef = def.props.pad?.default;
          const pad = def.props.pad ? ctx.props(node).num("pad", typeof padDef === "number" ? padDef : 0) : 0;
          w = Math.max(0, ...ctx.visibleChildren(node).map((k) => ctx.minWidth(k))) + pad * 2;
        } else w = 0;
        w = Number.isFinite(w) && w > 0 ? w : 0;
        mins.set(node, w);
      }
      return w;
  }
  return ctx;
}

/** A point or rect through a ChildTransform, from where it was laid out to the screen. */
export function applyTransform<R extends { x: number; y: number; w: number; h: number }>(r: R, t: ChildTransform): R {
  return { ...r, x: r.x * t.scale + t.dx, y: r.y * t.scale + t.dy, w: r.w * t.scale, h: r.h * t.scale };
}

/** T applied after inner: a child's transform inside its parent's. */
export function composeTransform(outer: ChildTransform, inner: ChildTransform): ChildTransform {
  return { scale: outer.scale * inner.scale, dx: inner.dx * outer.scale + outer.dx, dy: inner.dy * outer.scale + outer.dy };
}

export const IDENTITY: ChildTransform = { scale: 1, dx: 0, dy: 0 };

/**
 * The box tree as it sits on the screen: the same tree when no element draws
 * its children through a transform (ComponentDef.childTransform, a slide's),
 * otherwise a copy with those children's rects mapped to where they're drawn.
 * Each copy keeps its node and data, so it's matched to regions by node id.
 */
export function screenBoxes(root: Box, registry: Registry): Box {
  let any = false;
  walkBoxes(root, (b) => { if (!any && registry.get(b.node.type)?.childTransform?.(b)) any = true; });
  if (!any) return root;
  const map = (b: Box, t: ChildTransform | null): Box => {
    const own = registry.get(b.node.type)?.childTransform?.(b) ?? null;
    const inner = own ? (t ? composeTransform(t, own) : own) : t;
    const placed = t ? applyTransform(b, t) : { ...b };
    placed.children = b.children.map((k) => map(k, inner));
    return placed;
  };
  return map(root, null);
}

/** Lay out a whole tree. */
export function layoutTree(root: SayShapeNode, width: number, registry: Registry, theme: Theme, measure: TextMeasurer, scope: Scope, warn?: (message: string) => void): Box {
  return createLayoutContext(registry, theme, measure, scope, warn).layout(root, 0, 0, width);
}

/** Find the deepest box containing a point. */
export function boxAt(box: Box, x: number, y: number): Box | null {
  if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) return null;
  for (let i = box.children.length - 1; i >= 0; i--) {
    const hit = boxAt(box.children[i]!, x, y);
    if (hit) return hit;
  }
  return box;
}

/** Walk every box in paint order. */
export function walkBoxes(box: Box, fn: (b: Box, depth: number) => void, depth = 0): void {
  fn(box, depth);
  for (const k of box.children) walkBoxes(k, fn, depth + 1);
}

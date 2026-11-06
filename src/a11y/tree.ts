/**
 * Building the accessibility tree from a laid-out, painted frame: each
 * shown element's semantics (ComponentDef.semantics), with the hit regions
 * painted for it, in reading order. Headless: boxes and hits in, plain
 * objects out.
 */
import { PropReader } from "../component";
import { scopeOf } from "../each";
import { interpolate, type Scope } from "../expr";
import type { Registry } from "../registry";
import type { Box, HitRegion, SayShapeNode } from "../types";
import { accessibleKey, type AccessibleNode, type ElementSemantics, type Role, type SemanticsContext, type SemanticsResult } from "./semantics";

export interface TreeInput {
  root: Box;
  /** The screen's hit regions from the latest frame, in paint order. */
  hits: readonly HitRegion[];
  registry: Registry;
  scope: Scope;
  /** What the whole interface is called (the canvas's label). */
  label: string;
  /** The element whose popup is open, if any. */
  popupOwner?: string;
  today(): string;
}

/**
 * Roles whose content is read as their name, not as separate nodes. Things
 * inside them that can be focused on their own (a button in a pressable
 * card) are kept, just after them.
 */
const NAMED_FROM_CONTENT = new Set<Role>([
  "button", "link", "checkbox", "switch", "radio", "tab", "option", "img", "text", "heading",
  "slider", "spinbutton", "textbox", "searchbox", "combobox", "progressbar", "meter", "separator", "code",
]);

export function buildAccessibilityTree(input: TreeInput): AccessibleNode {
  const { root, hits, registry, scope } = input;
  const regionsOf = new Map<string, HitRegion[]>();
  for (const h of hits) {
    const id = h.box.node.id;
    let list = regionsOf.get(id);
    if (!list) regionsOf.set(id, (list = []));
    list.push(h);
  }
  const readers = new Map<SayShapeNode, PropReader>();
  const props = (node: SayShapeNode): PropReader => {
    let r = readers.get(node);
    if (!r) readers.set(node, (r = new PropReader(node, scopeOf(node, scope))));
    return r;
  };
  const text = (node: SayShapeNode): string | undefined =>
    node.text === undefined ? undefined : interpolate(node.text, scopeOf(node, scope)).trim();
  const textWithin = (box: Box): string => {
    const words: string[] = [];
    const walk = (b: Box) => {
      const t = text(b.node);
      if (t) words.push(t);
      b.children.forEach(walk);
    };
    walk(box);
    return words.join(" ");
  };

  const build = (box: Box): AccessibleNode[] => {
    const node = box.node;
    const regions = regionsOf.get(node.id) ?? [];
    const def = registry.get(node.type);
    const ctx: SemanticsContext = { props, text, textWithin, regions, popupOpen: input.popupOwner === node.id, today: input.today };
    const result: SemanticsResult = def?.semantics ? def.semantics(box, ctx) : fallback(box, ctx);
    if (result === false) return [];
    const inner = box.children.flatMap(build);
    if (result === null) return inner;

    const own = toNode(node, box, result, regions);
    if (NAMED_FROM_CONTENT.has(result.role)) return [own, ...inner.flatMap(focusableWithin)];
    own.children.push(...inner);
    return [own];
  };

  return {
    key: "root",
    role: "group",
    name: input.label,
    rect: { x: root.x, y: root.y, w: root.w, h: root.h },
    focusable: false,
    node: root.node,
    children: root.children.flatMap(build),
  };
}

function toNode(node: SayShapeNode, box: Box, s: ElementSemantics, regions: readonly HitRegion[]): AccessibleNode {
  const { parts, detail, ...own } = s;
  const whole = regions.find((r) => sameDetail(r.detail, detail));
  const out: AccessibleNode = {
    ...clean(own),
    key: accessibleKey(node, detail),
    rect: { x: box.x, y: box.y, w: box.w, h: box.h },
    focusable: !!whole?.focusable,
    node,
    children: [],
  };
  if (detail !== undefined) out.detail = detail;
  for (const part of parts ?? []) {
    const { detail, ...sem } = part;
    const region = regions.find((r) => sameDetail(r.detail, detail));
    const b = region?.box ?? box;
    out.children.push({
      ...clean(sem),
      key: accessibleKey(node, detail),
      rect: { x: b.x, y: b.y, w: b.w, h: b.h },
      focusable: !!region?.focusable,
      node,
      detail,
      children: [],
    });
  }
  return out;
}

/** What an element without its own semantics is: a button for each region it paints, text for quoted text, else nothing. */
function fallback(box: Box, ctx: SemanticsContext): SemanticsResult {
  const name = ctx.text(box.node) || undefined;
  if (ctx.regions.length) {
    // One region, with or without a detail, is the element itself.
    if (ctx.regions.length === 1) return { role: "button", name: name ?? (ctx.textWithin(box) || box.node.type), detail: ctx.regions[0]!.detail };
    return {
      role: "group",
      name,
      parts: ctx.regions.filter((r) => r.detail !== undefined).map((r) => ({ role: "button" as const, name: String(r.detail), detail: r.detail })),
    };
  }
  if (name && !box.children.length) return { role: "text", name };
  return null;
}

/** The nodes keyboard focus can land on, inside one whose content is its name. */
function focusableWithin(n: AccessibleNode): AccessibleNode[] {
  return n.focusable ? [n] : n.children.flatMap(focusableWithin);
}

function sameDetail(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/** Drop unset fields, so trees compare and print cleanly. */
function clean<T extends object>(s: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== "") (out as Record<string, unknown>)[k] = v;
  return out;
}

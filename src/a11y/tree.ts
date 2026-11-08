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
import type { Rect } from "../types";
import type { PopupState } from "../popup";

export interface TreeInput {
  root: Box;
  /** The screen's hit regions from the latest frame, in paint order. */
  hits: readonly HitRegion[];
  registry: Registry;
  scope: Scope;
  /** What the whole interface is called (the canvas's label). */
  label: string;
  /** The element whose popup is open, if any, and the popup's state. */
  popupOwner?: string;
  popupState?: Readonly<PopupState>;
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

  /** Groups that consecutive siblings asked to be wrapped in (radios sharing a bind=), by node. */
  const groups = new WeakMap<AccessibleNode, NonNullable<ElementSemantics["group"]>>();

  const build = (box: Box, prev: Box | undefined): AccessibleNode[] => {
    const node = box.node;
    const regions = regionsOf.get(node.id) ?? [];
    const def = registry.get(node.type);
    const textBefore = () => (prev?.node.type === "text" ? text(prev.node) || undefined : undefined);
    const popupOpen = input.popupOwner === node.id;
    const ctx: SemanticsContext = { props, text, textWithin, textBefore, regions, popupOpen, popup: popupOpen ? input.popupState ?? null : null, today: input.today };
    const result: SemanticsResult = def?.semantics ? def.semantics(box, ctx) : fallback(box, ctx);
    // tip= is read after the element's name; an element pressable only for its tip is the node Tab lands on.
    const tip = node.props.tip !== undefined ? props(node).str("tip", "").trim() : "";
    const tipRegion = tip ? regions.find((r) => r.detail === TIP_DETAIL) : undefined;
    if (result === false && !tipRegion) return [];
    const inner = result === false ? [] : buildAll(box.children);
    if (result === null || result === false) {
      if (!tipRegion) return inner;
      // Layout or decoration (an icon) with a tip: a node of its own, named by its words or the tip.
      const named = textWithin(box);
      return [{ role: "group", name: named || tip, ...(named ? { description: tip } : {}), key: accessibleKey(node, TIP_DETAIL), rect: { x: box.x, y: box.y, w: box.w, h: box.h }, focusable: true, node, detail: TIP_DETAIL, children: inner }];
    }

    const own = toNode(node, box, result, regions);
    if (tip) own.description = own.description ? `${own.description}. ${tip}` : tip;
    if (tipRegion && result.detail === undefined && !own.focusable) {
      own.key = accessibleKey(node, TIP_DETAIL);
      own.detail = TIP_DETAIL;
      own.focusable = true;
    }
    if (result.group) groups.set(own, { ...result.group, name: result.group.name ?? textBefore() });
    if (NAMED_FROM_CONTENT.has(result.role)) return [own, ...inner.flatMap(focusableWithin)];
    if (result.contentAfter) return [own, ...inner];
    own.children.push(...inner);
    return [own];
  };

  /** Siblings in order, with neighbours that share a group wrapped in it. */
  const buildAll = (boxes: Box[]): AccessibleNode[] => {
    const out: AccessibleNode[] = [];
    let open: { key: string; node: AccessibleNode } | null = null;
    boxes.forEach((b, i) => {
      for (const n of build(b, boxes[i - 1])) {
        const g = groups.get(n);
        if (g && open?.key === g.key) {
          open.node.children.push(n);
          open.node.rect = union(open.node.rect, n.rect);
          continue;
        }
        open = null;
        if (g) {
          const wrap: AccessibleNode = { role: g.role, ...(g.name ? { name: g.name } : {}), key: `group:${g.key}@${n.key}`, rect: { ...n.rect }, focusable: false, node: n.node, children: [n] };
          open = { key: g.key, node: wrap };
          out.push(wrap);
        } else out.push(n);
      }
    });
    return out;
  };

  return {
    key: "root",
    role: "group",
    name: input.label,
    rect: { x: root.x, y: root.y, w: root.w, h: root.h },
    focusable: false,
    node: root.node,
    children: buildAll(root.children),
  };
}

/** The detail of the region an element gets when it's pressable only for its tip (the engine's TIP). */
const TIP_DETAIL = "tip";

function toNode(node: SayShapeNode, box: Box, s: ElementSemantics, regions: readonly HitRegion[]): AccessibleNode {
  const { parts, detail, group: _group, contentAfter: _after, active, ...own } = s;
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
  if (active !== undefined) out.activeDescendant = accessibleKey(node, active);
  // Parts go inside the element, or inside another part they name with within.
  const made: Array<{ detail: unknown; node: AccessibleNode; within: unknown }> = [];
  for (const part of parts ?? []) {
    const { detail, within, controls, active, rect, ...sem } = part;
    const region = regions.find((r) => sameDetail(r.detail, detail));
    const b = region?.box ?? rect ?? box;
    const n: AccessibleNode = {
      ...clean(sem),
      key: accessibleKey(node, detail),
      rect: { x: b.x, y: b.y, w: b.w, h: b.h },
      focusable: !!region?.focusable,
      node,
      detail,
      children: [],
    };
    if (controls !== undefined) n.controls = accessibleKey(node, controls);
    if (active !== undefined) n.activeDescendant = accessibleKey(node, active);
    made.push({ detail, node: n, within });
  }
  for (const m of made) {
    const parent = m.within === undefined ? undefined : made.find((o) => sameDetail(o.detail, m.within))?.node;
    (parent ?? out).children.push(m.node);
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

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
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

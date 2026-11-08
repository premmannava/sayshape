/**
 * tree: a hierarchy you can open and close. Org charts, folders, budgets by
 * department, category drill-downs.
 *
 *   tree items=people id=id parent=manager label=name detail=role
 *   tree "Northwind Mutual" items=people parent=manager label=name detail=role kind=org
 *
 * The model gives a flat list where each record names its parent; the tree
 * is built here. kind=list (the default) draws indented rows that open and
 * close, the open branches kept as engine-held view state (ctx.view), read in
 * layout because they change the height. kind=org draws a top-down chart with
 * a tidy layout worked out here (each subtree as wide as its children need,
 * a parent centred over them, elbow lines), scrolling sideways when wide.
 *
 * Bad data never throws: an item whose parent isn't in the list, and items in
 * a loop of parents, are shown at the top with a warning.
 */
import type { ComponentDef, LayoutContext, PaintContext, PressContext } from "../component";
import type { PartSemantics } from "../a11y/semantics";
import { fieldOf, isList, isRecord, toNumber } from "../data";
import { ellipsize, fitLines } from "../text";
import type { Box, Value } from "../types";
import { chevron, fillTint, onProp, partBox, runOn, themeFont } from "./util";

/** The most items one tree draws; more shows a message. */
export const MAX_TREE_NODES = 300;
/** The most levels; deeper items are shown at this level's indent. */
const MAX_INDENT_LEVELS = 12;
const KINDS = ["list", "org"] as const;
const FORMATS = ["text", "number", "money"] as const;
type Format = (typeof FORMATS)[number];
const SCROLL_AREA = "scroll:area";
const DRAG_SLOP = 4;
const ARROW_STEP = 60;

interface TNode {
  /** Index into items. */
  index: number;
  id: string;
  /** The id as written (a number stays a number), for bind=. */
  key: string | number;
  label: string;
  detail: string;
  value: string;
  children: TNode[];
  parent: TNode | null;
  depth: number;
}

interface Row {
  node: TNode;
  /** The value as drawn: cut to at most 40% of the row, so the label always has room. */
  value: string;
  /** Relative to the box. */
  y: number;
  h: number;
  open: boolean;
  lines: string[];
}

interface OrgBox {
  node: TNode;
  /** Relative to the box; x within the scrolled content. */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  detail: string;
}

export interface TreeGeometry {
  kind: "list" | "org";
  title: string[];
  titleLH: number;
  top: number;
  message?: string;
  rows: Row[];
  boxes: OrgBox[];
  /** Org: lines from each parent to its children, within the content. */
  links: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  contentW: number;
  viewW: number;
  bodyH: number;
  bar: number;
  pressable: boolean;
  rowH: number;
  indent: number;
  /** How many levels get their own indent here: fewer on a narrow screen, so deep rows stay inside. */
  levels: number;
  fonts: { label: string; small: string; value: string; title: string };
  /** Org: how far it was scrolled when last painted, for where screen-reader items are. */
  scrolled?: number;
  /** Every node, in pre-order, for screen readers when nothing is closed (org). */
  all: TNode[];
}

const textOf = (v: Value | undefined): string =>
  v === undefined || v === null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

function shownValue(v: Value | undefined, format: Format): string {
  if (format === "text") return textOf(v);
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? toNumber(v) : NaN;
  if (!isFinite(n)) return textOf(v);
  try {
    return new Intl.NumberFormat("en-US", { ...(format === "money" ? { style: "currency", currency: "USD" } : {}), maximumFractionDigits: Number.isInteger(n) ? 0 : 2, minimumFractionDigits: format === "money" && !Number.isInteger(n) ? 2 : 0 }).format(n);
  } catch {
    return String(n);
  }
}

/**
 * The hierarchy from a flat list: roots in list order, children in list order.
 * Items whose parent is missing, and loops of parents, become roots; their
 * labels are returned so the caller can warn.
 */
export function buildTree(items: readonly Value[], f: { id: string; parent: string; label: string; detail: string; value: string; format: Format }): { roots: TNode[]; all: TNode[]; orphans: string[]; loops: string[]; duplicates: number } {
  const byId = new Map<string, TNode>();
  const nodes: TNode[] = [];
  const parentOf = new Map<TNode, string>();
  let duplicates = 0;
  items.forEach((it, index) => {
    if (!isRecord(it)) return;
    const raw = fieldOf(it, f.id);
    const id = textOf(raw);
    if (!id) return;
    if (byId.has(id)) { duplicates++; return; }
    const node: TNode = {
      index, id, key: typeof raw === "number" ? raw : id,
      label: textOf(fieldOf(it, f.label)) || id,
      detail: f.detail ? textOf(fieldOf(it, f.detail)) : "",
      value: f.value ? shownValue(fieldOf(it, f.value), f.format) : "",
      children: [], parent: null, depth: 0,
    };
    byId.set(id, node);
    nodes.push(node);
    parentOf.set(node, textOf(fieldOf(it, f.parent)));
  });
  const orphans: string[] = [];
  for (const n of nodes) {
    const pid = parentOf.get(n)!;
    if (!pid) continue;
    if (pid === n.id) { orphans.push(n.label); continue; }
    const p = byId.get(pid);
    if (p) n.parent = p;
    else orphans.push(n.label);
  }
  // Loops: walk up from each node; a node met twice is in a loop. Cut each loop at its first item in the list.
  const loops: string[] = [];
  const settled = new Set<TNode>();
  for (const n of nodes) {
    const path: TNode[] = [];
    const onPath = new Set<TNode>();
    let cur: TNode | null = n;
    while (cur && !settled.has(cur)) {
      if (onPath.has(cur)) {
        const loop = path.slice(path.indexOf(cur));
        const cut = loop.reduce((a, b) => (a.index <= b.index ? a : b));
        cut.parent = null;
        loops.push(loop.map((x) => x.label).join(" → "));
        break;
      }
      onPath.add(cur);
      path.push(cur);
      cur = cur.parent;
    }
    path.forEach((x) => settled.add(x));
  }
  for (const n of nodes) n.parent?.children.push(n);
  const roots = nodes.filter((n) => !n.parent);
  const all: TNode[] = [];
  const walk = (n: TNode, depth: number) => { n.depth = depth; all.push(n); n.children.forEach((c) => walk(c, depth + 1)); };
  roots.forEach((r) => walk(r, 0));
  return { roots, all, orphans, loops, duplicates };
}

/** Whether a branch is open: what the person chose, else open down to the open= depth. */
const isOpen = (v: Record<string, number> | undefined, n: TNode, openDepth: number) => {
  const chosen = v?.[`o:${n.id}`];
  return chosen === undefined ? n.depth < openDepth : chosen === 1;
};

// ---------------------------------------------------------------- layout

type LayoutCtx = Pick<LayoutContext, "theme" | "measure" | "warn" | "props" | "isLoading" | "view">;

export function treeLayout(box: Box, ctx: LayoutCtx): TreeGeometry {
  const p = ctx.props(box.node);
  const t = ctx.theme, m = ctx.measure;
  const warn = (msg: string) => ctx.warn?.(`tree on line ${box.node.line}: ${msg}`);
  const kind = p.oneOf("kind", KINDS, "list");
  const fonts = {
    title: themeFont(t, 600, t.text.body),
    label: themeFont(t, 600, t.text.body),
    small: themeFont(t, 400, t.text.caption + 1),
    value: themeFont(t, 600, t.text.caption + 1),
  };
  const titleLH = Math.round(t.text.body * 1.4);
  const title = p.text() ? fitLines(p.text(), box.w, fonts.title, m, 3) : [];
  const top = title.length ? title.length * titleLH + t.space.sm : 0;
  const pressable = p.has("bind") || p.has("on");
  const rowH = t.control.height;
  const indent = t.space.lg;
  const base: TreeGeometry = {
    kind, title, titleLH, top, rows: [], boxes: [], links: [], contentW: box.w, viewW: box.w, bodyH: 0, bar: 0,
    pressable, rowH, indent, fonts, all: [],
    levels: Math.max(0, Math.min(MAX_INDENT_LEVELS, Math.floor((box.w - 140) / indent) - 1)),
  };
  const say = (message: string): TreeGeometry => ({ ...base, message, bodyH: Math.max(t.control.height * 2, 72) });

  const loading = !!ctx.isLoading?.(box.node);
  const raw = loading ? undefined : p.expr("items");
  if (!loading && p.has("items") && !isList(raw)) warn("items is not a list. Use a list of records, each naming its parent, like items=people");
  const items: readonly Value[] = isList(raw) ? raw : [];
  if (items.length > MAX_TREE_NODES) {
    warn(`${items.length} items is more than the ${MAX_TREE_NODES} a tree draws. Filter the list or show one branch`);
    return say(`Too many items to draw: ${items.length}, at most ${MAX_TREE_NODES}`);
  }
  const field = (name: string, def: string) => p.str(name, def) || def;
  const f = {
    id: field("id", "id"), parent: field("parent", "parent"), label: field("label", "name"),
    detail: p.has("detail") ? p.str("detail") : "", value: p.has("value") ? p.str("value") : "",
    format: p.oneOf("format", FORMATS, "text"),
  };
  const built = buildTree(items, f);
  if (!loading) {
    if (built.orphans.length) warn(`${built.orphans.length} ${built.orphans.length === 1 ? "item names a parent" : "items name a parent"} that isn't in the list, or itself (${built.orphans.slice(0, 3).join(", ")}${built.orphans.length > 3 ? ", …" : ""}), so ${built.orphans.length === 1 ? "it's" : "they're"} shown at the top. Check ${f.parent} against ${f.id}`);
    if (built.loops.length) warn(`Parents go round in a loop (${built.loops[0]}), so the first of them is shown at the top. Give one of them an empty ${f.parent}`);
    if (built.duplicates) warn(`${built.duplicates} ${built.duplicates === 1 ? "item repeats" : "items repeat"} a value of the ${f.id} field already used, so only the first is shown. Give each item its own ${f.id}`);
    if (items.length && !built.all.length) warn(`No item has the ${f.id} field. Set id= to the field that identifies each item`);
  }
  if (!built.all.length) return loading ? { ...base, bodyH: rowH * 4 } : say("Nothing to show yet");
  base.all = built.all;
  return kind === "org" ? orgLayout(box, ctx, base, built.roots) : listLayout(box, ctx, base, built.roots, Math.max(0, Math.round(p.num("open", 1))));
}

function listLayout(box: Box, ctx: LayoutCtx, base: TreeGeometry, roots: TNode[], openDepth: number): TreeGeometry {
  const t = ctx.theme, m = ctx.measure;
  const v = ctx.view?.(box.node);
  const rows: Row[] = [];
  // The selected item shows, even in a branch that starts closed (unless someone closed it).
  const bound = ctx.props(box.node).bound();
  const chosen = bound === undefined || bound === null ? undefined : base.all.find((n) => n.key === bound || n.id === String(bound));
  const reveal = new Set<TNode>();
  for (let a = chosen?.parent ?? null; a; a = a.parent) reveal.add(a);
  let y = base.top;
  const lineH = Math.round(t.text.body * 1.35);
  const visit = (n: TNode) => {
    const open = n.children.length > 0 && (isOpen(v, n, openDepth) || (v?.[`o:${n.id}`] === undefined && reveal.has(n)));
    const x = Math.min(n.depth, base.levels) * base.indent + base.indent;
    const value = n.value ? ellipsize(n.value, box.w * 0.4, base.fonts.value, m) : "";
    const valueW = value ? m.width(value, base.fonts.value) + t.space.md : 0;
    const textW = Math.max(40, box.w - x - t.space.sm - valueW);
    const lines = fitLines(n.label, textW, base.fonts.label, m, 2);
    const h = Math.max(base.rowH, lines.length * lineH + (n.detail ? Math.round((t.text.caption + 1) * 1.4) : 0) + 2 * t.space.sm);
    rows.push({ node: n, value, y, h, open, lines });
    y += h;
    if (open) n.children.forEach(visit);
  };
  roots.forEach(visit);
  return { ...base, rows, bodyH: y - base.top };
}

function orgLayout(box: Box, ctx: LayoutCtx, base: TreeGeometry, roots: TNode[]): TreeGeometry {
  const t = ctx.theme, m = ctx.measure;
  // Boxes as wide as their longest words need, within reason, so a title like "Chief Operating Officer" fits.
  const padX = t.space.sm + 2;
  const widest = Math.max(...base.all.map((n) => Math.max(m.width(n.label, base.fonts.label), m.width([n.detail, n.value].filter(Boolean).join(" · "), base.fonts.small))));
  const boxW = Math.max(132, Math.min(widest + 2 * padX + 4, 220, Math.max(132, box.w * 0.45))), gapX = t.space.md, gapY = t.space.xl;
  const labelLH = Math.round(t.text.body * 1.35), smallLH = Math.round((t.text.caption + 1) * 1.4);
  const hasDetail = base.all.some((n) => n.detail || n.value);
  const boxH = 2 * t.space.sm + 2 + labelLH + (hasDetail ? smallLH : 0);
  // Each subtree's width: its own box, or its children side by side, whichever is wider.
  const widthOf = new Map<TNode, number>();
  const measureW = (n: TNode): number => {
    const kids = n.children.reduce((s, c, i) => s + measureW(c) + (i ? gapX : 0), 0);
    const w = Math.max(boxW, kids);
    widthOf.set(n, w);
    return w;
  };
  const totalW = roots.reduce((s, r, i) => s + measureW(r) + (i ? gapX : 0), 0);
  const viewW = box.w;
  const contentW = Math.max(totalW, viewW);
  const startX = (contentW - totalW) / 2;
  const boxes: OrgBox[] = [];
  const links: TreeGeometry["links"] = [];
  let maxY = 0;
  const place = (n: TNode, left: number, depth: number) => {
    const w = widthOf.get(n)!;
    const x = left + (w - boxW) / 2, y = base.top + depth * (boxH + gapY);
    maxY = Math.max(maxY, y + boxH);
    const pad = t.space.sm + 2;
    const label = ellipsize(n.label, boxW - 2 * pad, base.fonts.label, m);
    const detail = ellipsize([n.detail, n.value].filter(Boolean).join(" · "), boxW - 2 * pad, base.fonts.small, m);
    boxes.push({ node: n, x, y, w: boxW, h: boxH, label, detail });
    const kidsW = n.children.reduce((s, c, i) => s + widthOf.get(c)! + (i ? gapX : 0), 0);
    let cx = left + (w - kidsW) / 2;
    for (const c of n.children) {
      const cw = widthOf.get(c)!;
      links.push({ x1: x + boxW / 2, y1: y + boxH, x2: cx + cw / 2, y2: y + boxH + gapY });
      place(c, cx, depth + 1);
      cx += cw + gapX;
    }
  };
  let left = startX;
  for (const r of roots) { place(r, left, 0); left += widthOf.get(r)! + gapX; }
  const scrolls = contentW > viewW + 0.5;
  // Boxes in reading order: top to bottom, left to right (also the Tab order).
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  return { ...base, boxes, links, contentW, viewW, bar: scrolls ? t.space.md : 0, bodyH: maxY - base.top };
}

// ---------------------------------------------------------------- scrolling and parts

const maxScroll = (d: TreeGeometry) => Math.max(0, d.contentW - d.viewW);
function scrollTo(v: Record<string, number>, d: TreeGeometry, x: number): boolean {
  const before = v.x ?? 0;
  v.x = Math.max(0, Math.min(maxScroll(d), x));
  return Math.abs(v.x - before) > 0.01;
}

interface TreePart { geo: TreeGeometry; x: number; y: number; hidden?: boolean }
function geoOf(b: Box): TreePart | null {
  const d = b.data as unknown as TreePart | undefined;
  return d && "geo" in d ? d : null;
}
function part(box: Box, x: number, y: number, w: number, h: number, hidden = false): Box {
  return { ...partBox(box, x, y, w, h), data: { geo: box.data as unknown as TreeGeometry, x: box.x, y: box.y, hidden } as unknown as Box["data"] };
}
const nodeDetail = (n: TNode) => `node:${n.id}`;
const toggleDetail = (n: TNode) => `toggle:${n.id}`;

// ---------------------------------------------------------------- paint

function paintTree(box: Box, ctx: PaintContext): void {
  const d = box.data as unknown as TreeGeometry | undefined;
  if (!d) return;
  const { g, theme } = ctx;
  const c = theme.colors;
  const ox = box.x, oy = box.y;
  const measure = { width: (s: string, f: string) => { g.font = f; return g.measureText(s).width; } };
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.font = d.fonts.title;
  g.fillStyle = c.ink;
  d.title.forEach((l, i) => g.fillText(l, ox, oy + i * d.titleLH + d.titleLH / 2));
  if (d.message !== undefined) {
    g.font = d.fonts.small;
    g.fillStyle = c.muted;
    g.fillText(ellipsize(d.message, box.w, d.fonts.small, measure), ox, oy + d.top + d.bodyH / 2);
    return;
  }
  const selected = ctx.props(box.node).bound();
  const isSel = (n: TNode) => d.pressable && selected !== undefined && selected !== null && (selected === n.key || String(selected) === n.id);
  if (d.kind === "list") paintList(box, ctx, d, isSel, measure);
  else paintOrg(box, ctx, d, isSel, measure);
}

function paintList(box: Box, ctx: PaintContext, d: TreeGeometry, isSel: (n: TNode) => boolean, measure: { width(s: string, f: string): number }): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  const ox = box.x, oy = box.y;
  const lineH = Math.round(theme.text.body * 1.35);
  const indentOf = (n: TNode) => Math.min(n.depth, d.levels) * d.indent;
  // One Tab stop for the whole tree (the ARIA tree pattern): the focused row, else the selected one, else the first.
  const focusedRow = d.rows.find((r) => ctx.isFocused(box.node, nodeDetail(r.node)));
  const roving = focusedRow ?? d.rows.find((r) => isSel(r.node)) ?? d.rows[0];
  d.rows.forEach((r, i) => {
    const y = oy + r.y;
    const x = ox + indentOf(r.node);
    const sel = isSel(r.node), hover = ctx.isHovered(box.node, nodeDetail(r.node));
    if (sel || hover) {
      ctx.roundRect(ox, y + 1, box.w, r.h - 2, theme.radius.sm);
      fillTint(g, sel ? c.accent : c.ink, sel ? 0.1 : 0.04);
    }
    const rule = (x0: number) => {
      g.beginPath();
      g.moveTo(x0, Math.round(y) + 0.5);
      g.lineTo(ox + box.w, Math.round(y) + 0.5);
      g.save();
      g.globalAlpha *= 0.7;
      g.strokeStyle = c.line;
      g.lineWidth = 1;
      g.stroke();
      g.restore();
    };
    if (i) rule(x + d.indent);
    // Guides: a faint line down through each level above this row, under its parents' chevrons.
    for (let k = 0; k < Math.min(r.node.depth, d.levels); k++) {
      const gx = Math.round(ox + k * d.indent + d.indent / 2) + 0.5;
      g.beginPath();
      g.moveTo(gx, y);
      g.lineTo(gx, y + r.h);
      g.strokeStyle = c.line;
      g.lineWidth = 1;
      g.stroke();
    }
    const markY = y + theme.space.sm + lineH / 2;
    if (r.node.children.length) {
      chevron(g, x + d.indent / 2, markY, 9, r.open ? "down" : "right", c.muted);
      ctx.addHit(part(box, x, y, d.indent, r.h), { detail: toggleDetail(r.node), focusable: false });
    } else {
      g.beginPath();
      g.arc(x + d.indent / 2, markY, 2.5, 0, Math.PI * 2);
      g.fillStyle = c.control;
      g.fill();
    }
    const tx = x + d.indent;
    const valueW = r.value ? measure.width(r.value, d.fonts.value) + theme.space.md : 0;
    const textW = Math.max(10, ox + box.w - tx - theme.space.sm - valueW);
    let ty = markY;
    g.font = d.fonts.label;
    g.fillStyle = c.ink;
    g.textAlign = "left";
    for (const l of r.lines) { g.fillText(ellipsize(l, textW, d.fonts.label, measure), tx, ty); ty += lineH; }
    if (r.node.detail) {
      g.font = d.fonts.small;
      g.fillStyle = c.muted;
      g.fillText(ellipsize(r.node.detail, textW, d.fonts.small, measure), tx, ty - lineH / 2 + Math.round((theme.text.caption + 1) * 0.7));
    }
    if (r.value) {
      g.font = d.fonts.value;
      g.fillStyle = c.ink;
      g.textAlign = "right";
      g.fillText(r.value, ox + box.w - theme.space.sm, markY);
    }
    const rowX = tx - (r.node.children.length ? 0 : d.indent / 2);
    ctx.addHit(part(box, rowX, y, ox + box.w - rowX, r.h), { detail: nodeDetail(r.node), focusable: r === roving });
    if (ctx.isFocused(box.node, nodeDetail(r.node))) {
      ctx.roundRect(ox + 1, y + 1, box.w - 2, r.h - 2, theme.radius.sm);
      g.strokeStyle = c.focus;
      g.lineWidth = 2;
      g.stroke();
    }
  });
}

function paintOrg(box: Box, ctx: PaintContext, d: TreeGeometry, isSel: (n: TNode) => boolean, measure: { width(s: string, f: string): number }): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  const ox = box.x, oy = box.y;
  const v = ctx.view(box.node);
  let sx = v.x ?? Math.max(0, (d.contentW - d.viewW) / 2);
  sx = Math.max(0, Math.min(maxScroll(d), sx));
  // When focus moves to a box out of sight, it scrolls into view (once, so the arrows can scroll away).
  const focused = d.boxes.findIndex((b) => ctx.isFocused(box.node, nodeDetail(b.node)));
  if (focused >= 0 && v.focusedBox !== focused) {
    const b = d.boxes[focused]!;
    if (b.x < sx) sx = b.x - theme.space.sm;
    else if (b.x + b.w > sx + d.viewW) sx = b.x + b.w - d.viewW + theme.space.sm;
    scrollTo(v, d, sx);
    sx = v.x ?? 0;
  }
  if (focused >= 0) v.focusedBox = focused; else delete v.focusedBox;
  v.x = sx;
  d.scrolled = sx;
  const left = ox, right = ox + box.w;
  const cx = (x: number) => ox + x - sx;
  const scrolls = maxScroll(d) > 0;
  if (scrolls) ctx.addHit(part(box, ox, oy + d.top, box.w, d.bodyH + d.bar), { detail: SCROLL_AREA, focusable: !d.pressable });

  g.save();
  g.beginPath();
  g.rect(left, oy + d.top - 4, box.w, d.bodyH + 8);
  g.clip();
  // Elbow lines: down from the parent, across, down to the child.
  g.strokeStyle = c.control;
  g.lineWidth = 1.25;
  for (const l of d.links) {
    const midY = Math.round(oy + (l.y1 + l.y2) / 2) + 0.5;
    g.beginPath();
    g.moveTo(Math.round(cx(l.x1)) + 0.5, oy + l.y1);
    g.lineTo(Math.round(cx(l.x1)) + 0.5, midY);
    g.lineTo(Math.round(cx(l.x2)) + 0.5, midY);
    g.lineTo(Math.round(cx(l.x2)) + 0.5, oy + l.y2);
    g.stroke();
  }
  const pad = theme.space.sm + 2;
  const labelLH = Math.round(theme.text.body * 1.35);
  for (const b of d.boxes) {
    const x = cx(b.x), y = oy + b.y;
    if (x + b.w < left - 1 || x > right + 1) continue;
    const sel = isSel(b.node), hover = d.pressable && ctx.isHovered(box.node, nodeDetail(b.node));
    if (hover) {
      ctx.roundRect(x, y + 2, b.w, b.h, theme.radius.md);
      g.fillStyle = c.shadow;
      g.fill();
    }
    ctx.roundRect(x + 0.5, y + 0.5, b.w - 1, b.h - 1, theme.radius.md);
    g.fillStyle = c.raised;
    g.fill();
    if (sel) fillTint(g, c.accent, 0.1);
    g.strokeStyle = sel ? c.accent : c.line;
    g.lineWidth = sel ? 1.5 : 1;
    g.stroke();
    // A band of the accent along the top of the top-level boxes, so the chart reads from the top.
    if (b.node.depth === 0) {
      g.save();
      ctx.roundRect(x, y, b.w, b.h, theme.radius.md);
      g.clip();
      g.fillStyle = c.accent;
      g.fillRect(x, y, b.w, 3);
      g.restore();
    }
    // Words only when the whole box shows, so none run past the tree's edges.
    if (x >= left - 0.5 && x + b.w <= right + 0.5) {
      g.textAlign = "center";
      g.font = d.fonts.label;
      g.fillStyle = c.ink;
      g.fillText(b.label, x + b.w / 2, y + pad + 1 + labelLH / 2);
      if (b.detail) {
        g.font = d.fonts.small;
        g.fillStyle = c.muted;
        g.fillText(b.detail, x + b.w / 2, y + pad + 1 + labelLH + Math.round((theme.text.caption + 1) * 0.7));
      }
    }
    if (ctx.isFocused(box.node, nodeDetail(b.node))) {
      ctx.roundRect(x - 2, y - 2, b.w + 4, b.h + 4, theme.radius.md + 2);
      g.strokeStyle = c.focus;
      g.lineWidth = 2;
      g.stroke();
    }
  }
  g.restore();
  if (d.pressable) {
    for (const b of d.boxes) {
      const x = cx(b.x);
      const l = Math.max(x, left), r = Math.min(x + b.w, right);
      const hidden = r - l <= 1;
      ctx.addHit(part(box, hidden ? (x + b.w <= left ? left : right - 1) : l, oy + b.y, hidden ? 1 : r - l, b.h, hidden), { detail: nodeDetail(b.node) });
    }
  }
  if (scrolls && !d.pressable && ctx.isFocused(box.node, SCROLL_AREA)) {
    ctx.roundRect(ox - 2, oy + d.top - 2, box.w + 4, d.bodyH + 4, theme.radius.md + 2);
    g.strokeStyle = c.focus;
    g.lineWidth = 2;
    g.stroke();
  }
  if (scrolls) {
    const inset = theme.space.sm;
    const trackW = Math.max(0, box.w - 2 * inset);
    const w = Math.min(trackW, Math.max(28, (trackW * d.viewW) / Math.max(1, d.contentW)));
    const tx = ox + inset + (trackW - w) * (sx / Math.max(1, maxScroll(d)));
    const yb = oy + d.top + d.bodyH + d.bar / 2 + 2;
    ctx.roundRect(ox + inset, yb - 2, trackW, 4, 2);
    fillTint(g, c.ink, 0.06);
    ctx.roundRect(tx, yb - 2, w, 4, 2);
    g.fillStyle = c.control;
    g.fill();
  }
}

// ---------------------------------------------------------------- press and keys

function nodeOf(ctx: PressContext): { geo: TreeGeometry; node: TNode; toggle: boolean } | null {
  const detail = ctx.target.detail;
  const geo = geoOf(ctx.target.box)?.geo;
  if (!geo || typeof detail !== "string") return null;
  const m = /^(node|toggle):([\s\S]*)$/.exec(detail);
  if (!m) return null;
  const node = geo.all.find((n) => n.id === m[2]);
  return node ? { geo, node, toggle: m[1] === "toggle" } : null;
}

function setOpen(ctx: PressContext, node: TNode, open: boolean): void {
  ctx.view(ctx.target.node)[`o:${node.id}`] = open ? 1 : 0;
  ctx.relayout?.();
}

function select(ctx: PressContext, node: TNode): void {
  const bind = ctx.props(ctx.target.node).raw("bind");
  if (bind) ctx.set(bind, node.key);
  runOn(ctx);
}

function pressTree(ctx: PressContext): void {
  const found = nodeOf(ctx);
  if (!found) return;
  const { geo, node, toggle } = found;
  const open = geo.rows.find((r) => r.node === node)?.open ?? false;
  // The chevron opens and closes; so does the row when there's nothing to select.
  if (geo.kind === "list" && node.children.length && (toggle || !geo.pressable)) { setOpen(ctx, node, !open); return; }
  if (geo.pressable) select(ctx, node);
}

/**
 * Keys on a list tree, as the ARIA tree pattern has them: Up and Down move
 * between the rows that show, Home and End to the first and last; Right
 * opens a branch, or moves into its first child when it's open; Left closes
 * a branch, or moves out to the parent. An org chart's arrows scroll it.
 */
function keyTree(ctx: PressContext, key: string): boolean {
  const geo = geoOf(ctx.target.box)?.geo;
  if (!geo) return false;
  const found = nodeOf(ctx);
  if (geo.kind === "org" || !found) {
    if (!maxScroll(geo)) return false;
    const v = ctx.view(ctx.target.node);
    const x = v.x ?? 0;
    const to = key === "ArrowRight" ? x + ARROW_STEP : key === "ArrowLeft" ? x - ARROW_STEP : key === "Home" ? 0 : key === "End" ? maxScroll(geo) : null;
    return to !== null && scrollTo(v, geo, to);
  }
  const { node } = found;
  const rows = geo.rows;
  const at = rows.findIndex((r) => r.node === node);
  const open = rows[at]?.open ?? false;
  const go = (n: TNode | undefined) => { if (n) ctx.focusPart?.(nodeDetail(n)); return !!n; };
  switch (key) {
    case "ArrowDown": return go(rows[at + 1]?.node) || true;
    case "ArrowUp": return go(rows[at - 1]?.node) || true;
    case "Home": return go(rows[0]?.node);
    case "End": return go(rows[rows.length - 1]?.node);
    case "ArrowRight":
      if (!node.children.length) return true;
      if (!open) { setOpen(ctx, node, true); return true; }
      return go(node.children[0]);
    case "ArrowLeft":
      if (node.children.length && open) { setOpen(ctx, node, false); return true; }
      return go(node.parent ?? undefined) || true;
  }
  return false;
}

// ---------------------------------------------------------------- definition

export const tree: ComponentDef = {
  type: "tree",
  category: "data",
  description: "A hierarchy from a flat list where each record names its parent: an org chart, folders, a budget by department. kind=list (default) is indented rows that open and close; kind=org is a top-down chart of boxes.",
  text: { description: "The title above the tree, e.g. Org chart." },
  props: {
    items: { type: "expression", required: true, description: `The list of records, e.g. items=people. At most ${MAX_TREE_NODES}.` },
    id: { type: "name", default: "id", description: "The field that identifies each record, e.g. id=id." },
    parent: { type: "name", default: "parent", description: "The field with the parent's id, e.g. parent=manager. Empty for the top." },
    label: { type: "name", default: "name", description: "The field with what each item says, e.g. label=name." },
    detail: { type: "name", description: "The field with a quieter line, e.g. detail=role." },
    value: { type: "name", description: "The field with a number on the right, e.g. value=headcount." },
    format: { type: "enum", values: FORMATS, default: "text", description: "How value= reads: text as is, number (1,200) or money ($1,200, US dollars)." },
    kind: { type: "enum", values: KINDS, default: "list", description: "list: indented rows that open and close. org: a top-down chart with boxes and lines, which scrolls sideways when wide." },
    open: { type: "number", default: 1, description: "How many levels of a list start open; 0 shows only the top." },
    bind: { type: "state", description: "State that holds the selected item's id. Pressing an item sets it." },
    on: onProp("after an item is selected, with bind= already set"),
  },
  picks: [
    { for: "a nested breakdown, or an org chart (kind=org)", write: "tree items=rows parent=parent" },
  ],
  example: `state picked="" people=[{id: "e1", name: "Ana Ruiz", role: "COO"}, {id: "e2", name: "Ben Okafor", role: "Head of Claims", manager: "e1"}, {id: "e3", name: "Chloe Park", role: "Head of Operations", manager: "e1"}, {id: "e4", name: "Dev Malhotra", role: "Claims lead", manager: "e2"}]
tree "Northwind Mutual" items=people parent=manager label=name detail=role bind=picked`,
  minWidth: () => 200,
  layout(box, ctx) {
    const d = treeLayout(box, ctx);
    box.data = d as unknown as Box["data"];
    box.h = d.top + d.bodyH + d.bar;
  },
  fullWidth(box) {
    const d = box.data as unknown as TreeGeometry | undefined;
    return d && d.kind === "org" && d.message === undefined ? d.contentW + 1 : box.w;
  },
  paint: paintTree,
  hitTest(box, x, _y, detail) {
    const d = box.data as unknown as TreePart | undefined;
    if (!d?.geo || detail === SCROLL_AREA) return { detail };
    if (d.hidden) return null;
    return x >= d.x && x <= d.x + d.geo.viewW ? { detail } : null;
  },
  press: pressTree,
  drag(ctx) {
    // Only an org chart wider than its space drags; a press that doesn't move still selects or toggles.
    const v = ctx.view(ctx.target.node);
    const geo = geoOf(ctx.target.box)?.geo;
    if (ctx.phase === "start") { v.dragX = ctx.x; v.dragFrom = v.x ?? 0; v.dragMoved = 0; return false; }
    const dx = ctx.x - (v.dragX ?? ctx.x);
    if (ctx.phase === "move") {
      if (!geo || !maxScroll(geo) || (!v.dragMoved && Math.abs(dx) < DRAG_SLOP)) return false;
      v.dragMoved = 1;
      scrollTo(v, geo, (v.dragFrom ?? 0) - dx);
      return false;
    }
    const moved = !!v.dragMoved;
    delete v.dragX; delete v.dragFrom; delete v.dragMoved;
    if (!moved) pressTree(ctx);
    return false;
  },
  wheel(ctx) {
    const geo = geoOf(ctx.target.box)?.geo;
    if (!geo || !maxScroll(geo)) return false;
    const dx = ctx.deltaX || (ctx.shiftKey ? ctx.deltaY : 0);
    if (!dx) return false;
    const v = ctx.view(ctx.target.node);
    return scrollTo(v, geo, (v.x ?? 0) + dx);
  },
  key: keyTree,
  cursor: (target) => (target.detail === SCROLL_AREA ? "default" : "pointer"),
  semantics(box, ctx) {
    const d = box.data as unknown as TreeGeometry | undefined;
    const name = ctx.props(box.node).text() || ctx.textBefore() || undefined;
    if (!d) return null;
    if (d.message !== undefined) return d.message ? { role: "text", name: name ? `${name}: ${d.message}` : d.message } : null;
    const selected = ctx.props(box.node).bound();
    const parts: PartSemantics[] = [];
    const named = (n: TNode) => [n.label, n.value, n.detail].filter(Boolean).join(", ");
    if (d.kind === "list") {
      for (const r of d.rows) parts.push({
        detail: nodeDetail(r.node), role: "treeitem", name: named(r.node), level: r.node.depth + 1,
        expanded: r.node.children.length ? r.open : undefined,
        selected: d.pressable ? selected === r.node.key || String(selected) === r.node.id : undefined,
        rect: { x: box.x, y: box.y + r.y, w: box.w, h: r.h },
      });
    } else {
      const sx = d.scrolled ?? 0;
      // Parents before their children, so levels read (and copy) as the hierarchy, not as rows of the chart.
      const byNode = new Map(d.boxes.map((b) => [b.node, b]));
      for (const b of d.all.map((x) => byNode.get(x)!).filter(Boolean)) {
        const x = box.x + b.x - sx;
        const l = Math.max(x, box.x), r = Math.min(x + b.w, box.x + box.w);
        parts.push({
          detail: nodeDetail(b.node), role: "treeitem", name: named(b.node), level: b.node.depth + 1,
          selected: d.pressable ? selected === b.node.key || String(selected) === b.node.id : undefined,
          rect: r > l ? { x: l, y: box.y + b.y, w: r - l, h: b.h } : { x: x + b.w <= box.x ? box.x : box.x + box.w - 1, y: box.y + b.y, w: 1, h: b.h },
        });
      }
    }
    const focusable = d.kind === "org" && maxScroll(d) > 0 && !d.pressable;
    return { role: "tree", name: name ?? "Tree", ...(focusable ? { detail: SCROLL_AREA } : {}), parts };
  },
};

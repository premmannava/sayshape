/**
 * What the page elements share: the heading block (eyebrow, headline and lead
 * line) they draw themselves, the way their children are gathered (buttons
 * into one row, columns into one row), and the sizes that grow with the width.
 *
 * Nothing here has a color, a font or a pixel size of its own: sizes are the
 * theme's type sizes times a ratio that grows with the width, spaces are the
 * theme's, and every color is a theme color.
 */
import type { LayoutContext, PaintContext, PropDef } from "../../component";
import type { PartSemantics } from "../../a11y/semantics";
import { displayFamily } from "../../look";
import type { Theme } from "../../theme";
import { wrapText } from "../../text";
import type { Box, SayShapeNode } from "../../types";

export const ALIGNS = ["left", "center"] as const;
export type Align = (typeof ALIGNS)[number];

export const alignProp: PropDef = { type: "enum", values: ALIGNS, default: "left", description: "left (default) or center: the words and the buttons under them." };
export const eyebrowProp: PropDef = { type: "string", description: "A few small capital words above the headline, like a category or a launch date." };
export const leadProp: PropDef = { type: "string", description: "One or two sentences under the headline that say more." };

/** The widest a page's content gets, in pixels: on a wide screen it stays a readable column, centred. */
export const MAX_CONTENT = 1080;

/** 0 on a phone to 1 on a wide screen: how far type and space have grown. */
export function ramp(width: number): number {
  return Math.max(0, Math.min(1, (width - 320) / 640));
}

/** A size that grows from `from` times the theme's size on a phone to `to` times on a wide screen. */
export function grown(base: number, width: number, from: number, to: number): number {
  return Math.round(base * (from + (to - from) * ramp(width)));
}

export type Ink = "ink" | "muted" | "accent";

/** A run of wrapped text, placed from its element's top left. */
export interface Run {
  key: "eyebrow" | "title" | "lead" | "note" | "price" | "per" | "feature";
  /** The words as the person reads them (the lines may be capitals). */
  text: string;
  lines: string[];
  font: string;
  lh: number;
  color: Ink;
  /** Where the lines start, and how wide they may be, from the element's left. */
  dx: number;
  w: number;
  dy: number;
  align: Align;
}

export interface Head {
  runs: Run[];
  /** Height from the first run's top to the last run's bottom. */
  h: number;
}

export interface HeadSpec {
  eyebrow: string;
  title: string;
  titleSize: number;
  lead: string;
  leadSize: number;
  align: Align;
}

const LEADING = 1.3;

/** Wrap one run of text to `width` and place it at `dy`. */
export function makeRun(ctx: LayoutContext, key: Run["key"], text: string, size: number, weight: number, family: string, color: Ink, left: number, width: number, dy: number, align: Align, lead = LEADING): Run {
  const font = `${weight} ${size}px ${family}`;
  const shown = key === "eyebrow" ? text.toUpperCase() : text;
  const lines = wrapText(shown, Math.max(1, width), font, ctx.measure);
  const lh = Math.round(size * lead * 10) / 10;
  return { key, text, lines, font, lh, color, dx: left, w: width, dy, align };
}

/** Each run's room across: a headline may run wider than the lead under it, which stays a comfortable length. */
function across(left: number, width: number, cap: number, align: Align): { left: number; w: number } {
  const w = Math.min(width, cap);
  return { left: align === "center" ? left + (width - w) / 2 : left, w };
}

/**
 * Lay out the eyebrow, headline and lead line one under the other, from
 * `top`, inside `width` pixels starting `left` from the element's left.
 */
export function layoutHead(ctx: LayoutContext, left: number, width: number, top: number, s: HeadSpec): Head {
  const t = ctx.theme;
  const runs: Run[] = [];
  let y = top;
  const add = (run: Run, gap: number) => {
    if (!run.lines.length) return;
    runs.push(run);
    y = run.dy + run.lines.length * run.lh + gap;
  };
  if (s.eyebrow) {
    const a = across(left, width, width, s.align);
    add(makeRun(ctx, "eyebrow", s.eyebrow, t.text.caption, 600, t.font.family, "accent", a.left, a.w, y, s.align, 1.4), t.space.sm);
  }
  if (s.title) {
    const a = across(left, width, s.titleSize * 16, s.align);
    add(makeRun(ctx, "title", s.title, s.titleSize, 600, displayFamily(t), "ink", a.left, a.w, y, s.align, 1.15), t.space.md);
  }
  if (s.lead) {
    const a = across(left, width, s.leadSize * 34, s.align);
    add(makeRun(ctx, "lead", s.lead, s.leadSize, 400, t.font.family, "muted", a.left, a.w, y, s.align, 1.45), 0);
  }
  const last = runs[runs.length - 1];
  return { runs, h: last ? last.dy + last.lines.length * last.lh - top : 0 };
}

const heightOf = (r: Run) => r.lines.length * r.lh;

/** Draw the runs of a head from the element's top left. */
export function paintRuns(ctx: PaintContext, box: Box, runs: readonly Run[]): void {
  const { g, theme } = ctx;
  g.textBaseline = "middle";
  for (const r of runs) {
    g.font = r.font;
    g.fillStyle = theme.colors[r.color];
    g.textAlign = r.align;
    const x = r.align === "center" ? box.x + r.dx + r.w / 2 : box.x + r.dx;
    r.lines.forEach((l, i) => g.fillText(l, x, box.y + r.dy + r.lh * i + r.lh / 2 + 1));
  }
}

/** Move runs down, when the element grew taller than its words and centres them. */
export function moveRuns(runs: readonly Run[], dy: number): void {
  for (const r of runs) r.dy += dy;
}

/** The runs as parts a screen reader finds: the headline is a heading, the rest is text. */
export function runParts(box: Box, runs: readonly Run[], level: number): PartSemantics[] {
  return runs.map((r) => ({
    detail: `run:${r.key}`,
    role: r.key === "title" ? ("heading" as const) : ("text" as const),
    ...(r.key === "title" ? { level } : {}),
    name: r.text,
    rect: { x: box.x + r.dx, y: box.y + r.dy, w: r.w, h: heightOf(r) },
  }));
}

const ACTIONS = new Set(["button", "link", "badge"]);

/**
 * What a block lays out in place of its children: a run of buttons and links
 * becomes one row (so two buttons written one under the other sit side by
 * side, and wrap on a phone), and with `columns`, a run of columns becomes one
 * row of columns that stack on a phone. Everything else is as written.
 */
export function gatherKids(parent: SayShapeNode, kids: readonly SayShapeNode[], space: Theme["space"], columns: boolean): SayShapeNode[] {
  const out: SayShapeNode[] = [];
  let run: SayShapeNode[] = [];
  let kind: "actions" | "columns" | null = null;
  let n = 0;
  const flush = () => {
    if (run.length && (kind === "actions" || run.length > 1)) {
      const first = run[0]!;
      const props: Record<string, string> = kind === "actions" ? { fit: "true", gap: String(space.md), align: "center" } : { gap: String(space.xl), align: "top" };
      out.push({ id: `${parent.id}~${kind}${n++}`, type: "row", props, children: run, line: first.line, indent: first.indent });
    } else out.push(...run);
    run = [];
    kind = null;
  };
  for (const k of kids) {
    const kk = ACTIONS.has(k.type) ? "actions" : columns && k.type === "column" ? "columns" : null;
    if (kk !== kind) flush();
    if (kk) { kind = kk; run.push(k); } else out.push(k);
  }
  flush();
  return out;
}

/** A centred block's one line of buttons: the row hugs them at its left, so move them to the middle. */
export function centerLine(ctx: LayoutContext, kb: Box, left: number, width: number): void {
  if (kb.node.type !== "row" || kb.node.props.fit !== "true" || !kb.children.length) return;
  const y = kb.children[0]!.y;
  if (kb.children.some((c) => Math.abs(c.y - y) > 1)) return;
  const from = Math.min(...kb.children.map((c) => c.x));
  const to = Math.max(...kb.children.map((c) => c.x + c.w));
  const dx = left + (width - (to - from)) / 2 - from;
  if (Math.abs(dx) > 0.5) for (const c of kb.children) ctx.shift(c, dx, 0);
}

export interface BlockSpec {
  padX: number;
  padY: number;
  gap: number;
  /** Space between the head and what's under it. */
  headGap: number;
  head: HeadSpec;
  columns: boolean;
}

export interface Block { head: Head; left: number; width: number; contentBottom: number }

/**
 * The layout every headed block shares: padding, the head, then the children
 * stacked (buttons together on one line), content kept to MAX_CONTENT and
 * centred on a wide screen. Sets box.h and box.data.head.
 */
export function layoutBlock(box: Box, ctx: LayoutContext, s: BlockSpec): Block {
  const contentW = Math.max(0, Math.min(box.w - s.padX * 2, MAX_CONTENT));
  const left = (box.w - contentW) / 2;
  const head = layoutHead(ctx, left, contentW, s.padY, s.head);
  let y = box.y + s.padY + head.h + (head.h ? s.headGap : 0);
  const kids = gatherKids(box.node, ctx.visibleChildren(box.node), ctx.theme.space, s.columns);
  kids.forEach((k, i) => {
    if (i) y += s.gap;
    const kb = ctx.layout(k, box.x + left, y, contentW);
    if (s.head.align === "center") centerLine(ctx, kb, box.x + left, contentW);
    box.children.push(kb);
    y += kb.h;
  });
  box.h = y - box.y + s.padY;
  box.data = { ...box.data, head };
  return { head, left, width: contentW, contentBottom: y - box.y };
}

/** A box laid out taller than its content: put the content in the middle. */
export function centerContent(box: Box, ctx: LayoutContext, head: Head, spare: number): void {
  if (spare <= 0) return;
  moveRuns(head.runs, spare);
  for (const kb of box.children) ctx.shift(kb, 0, spare);
}

/** The head of a block, read from its props. */
export function headSpec(ctx: LayoutContext, box: Box, titleSize: number, leadSize: number): HeadSpec {
  const p = ctx.props(box.node);
  return { eyebrow: p.str("eyebrow"), title: p.text(), titleSize, lead: p.str("lead"), leadSize, align: p.oneOf("align", ALIGNS, "left") };
}

export const dataOf = (b: Box): { head: Head } => b.data as { head: Head };

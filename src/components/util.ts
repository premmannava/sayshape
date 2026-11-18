import { drawIcon, ICON_NAMES, isIconName, nearestIcon, type IconName } from "../icons";
import type { LayoutContext, PaintContext, PressContext, PropDef } from "../component";
import type { Theme } from "../theme";
import { displayFamily } from "../look";
import type { Box, SayShapeNode } from "../types";
import { ellipsize, fitLines } from "../text";

export const TONES = ["default", "muted", "accent", "good", "warn", "bad"] as const;
export type Tone = (typeof TONES)[number];

export function toneColor(theme: Theme, tone: Tone): string {
  const c = theme.colors;
  return { default: c.ink, muted: c.muted, accent: c.accent, good: c.good, warn: c.warn, bad: c.bad }[tone];
}

export const toneProp: PropDef = { type: "enum", values: TONES, default: "default", description: "Color role: default, muted, accent, good, warn or bad." };

export const gapProp = (def: number): PropDef => ({ type: "number", default: def, description: `Space between children in pixels (default ${def}).` });
export const padProp = (def: number): PropDef => ({ type: "number", default: def, description: `Inner padding in pixels (default ${def}).` });

/** Stack visible children top to bottom. */
export function stack(box: Box, ctx: LayoutContext, pad: number, gap: number): void {
  const kids = ctx.visibleChildren(box.node);
  const innerW = box.w - pad * 2;
  let y = box.y + pad;
  kids.forEach((k, i) => {
    if (i) y += gap;
    const kb = ctx.layout(k, box.x + pad, y, innerW);
    box.children.push(kb);
    y += kb.h;
  });
  box.h = y - box.y + pad;
}

export const ROW_ALIGN = ["top", "center", "bottom"] as const;

/**
 * Widths for children side by side in `space` pixels (gaps already taken out).
 * Equal shares when every child's minimum fits in one, which is how rows have
 * always worked. Otherwise a child whose minimum is more than its share gets
 * its minimum, and the others split what's left in proportion to what they
 * need, so a price beside a product name doesn't take as much room as the name.
 * If the minimums don't all fit, equal shares (children fit their content to
 * them as best they can).
 */
export function shareWidths(space: number, mins: readonly number[]): number[] {
  const n = mins.length;
  if (!n) return [];
  const equal = Math.max(0, space / n);
  if (mins.every((m) => m <= equal)) return mins.map(() => equal);
  if (mins.reduce((t, m) => t + m, 0) > space) return mins.map(() => equal);
  // Children that need little still get a usable share.
  const weight = (m: number) => Math.max(m, 40);
  // Children that need more than an equal share get exactly what they need.
  const widths: Array<number | null> = mins.map((m) => (m > equal ? m : null));
  for (;;) {
    const fixed = widths.reduce<number>((t, w) => t + (w ?? 0), 0);
    const free = mins.map((m, i) => (widths[i] === null ? weight(m) : 0));
    const totalWeight = free.reduce((t, w) => t + w, 0);
    const shareOf = (i: number) => (totalWeight ? ((space - fixed) * free[i]!) / totalWeight : 0);
    let changed = false;
    mins.forEach((m, i) => { if (widths[i] === null && m > shareOf(i)) { widths[i] = m; changed = true; } });
    if (!changed) return widths.map((w, i) => w ?? shareOf(i));
  }
}

/**
 * Lay out visible children side by side. With wrap (the default), children
 * that can't all get their minimum width (ComponentDef.minWidth) move onto
 * more lines, so a row of controls becomes a column on a narrow screen. At
 * widths where everything fits, every child gets an equal share, as before.
 */
export function row(box: Box, ctx: LayoutContext, pad: number, gap: number, align: (typeof ROW_ALIGN)[number], wrap = false, fit?: RowFit): void {
  if (fit && (fit.fit || fit.justify)) return fitRow(box, ctx, pad, gap, align, wrap, fit);
  const kids = ctx.visibleChildren(box.node);
  const innerW = Math.max(0, box.w - pad * 2);
  const mins = kids.map((k) => Math.min(innerW, ctx.minWidth(k)));
  // Greedy lines: start a new one when the next child's minimum wouldn't fit.
  const lines: number[][] = [];
  let line: number[] = [], used = 0;
  kids.forEach((_k, i) => {
    const need = (line.length ? used + gap : 0) + mins[i]!;
    if (wrap && line.length && need > innerW + 0.01) { lines.push(line); line = []; used = 0; }
    used = (line.length ? used + gap : 0) + mins[i]!;
    line.push(i);
  });
  if (line.length || !lines.length) lines.push(line);

  let y = box.y + pad;
  lines.forEach((idx, li) => {
    if (li) y += gap;
    const widths = shareWidths(innerW - gap * Math.max(0, idx.length - 1), idx.map((i) => mins[i]!));
    let x = box.x + pad, tallest = 0;
    const placed: Box[] = [];
    idx.forEach((i, j) => {
      const kb = ctx.layout(kids[i]!, x, y, widths[j]!);
      placed.push(kb);
      box.children.push(kb);
      tallest = Math.max(tallest, kb.h);
      x += widths[j]! + gap;
    });
    packButtons(placed, widths, box.x + pad, innerW, gap, ctx);
    // Cards form visual panels: match their bottom edges instead of centering
    // a shorter card. Explicit top/bottom alignment still takes precedence.
    if (align === "center" && placed.length > 1 && placed.every((k) => k.node.type === "card")) {
      for (const kb of placed) kb.h = tallest;
    } else if (align !== "top" && !(align === "center" && placed.length > 1 && placed.every((k) => k.node.type === "stat"))) {
      // (Skipped for a row of only KPIs: their labels and values stay on shared
      // lines when one has a sparkline or a wrapped change, so it's top-aligned.)
      tallest = alignLine(placed, tallest, align, ctx);
    }
    y += tallest;
  });
  box.h = y - box.y + pad;
}

/**
 * Move a line's children down to centre (or bottom-align) them, and return the line's height.
 * Centred, a box with a band (Box.band: a field without its message) is centred by that band,
 * so a message under a field doesn't push the button beside it down; the line grows to hold it.
 */
function alignLine(placed: Box[], tallest: number, align: (typeof ROW_ALIGN)[number], ctx: LayoutContext): number {
  if (align !== "center") {
    for (const kb of placed) if (tallest > kb.h) ctx.shift(kb, 0, tallest - kb.h);
    return tallest;
  }
  const bandOf = (kb: Box) => Math.min(kb.h, kb.band ?? kb.h);
  const widest = Math.max(0, ...placed.map(bandOf));
  let bottom = tallest;
  for (const kb of placed) {
    const d = (widest - bandOf(kb)) / 2;
    if (d > 0) ctx.shift(kb, 0, d);
    bottom = Math.max(bottom, d + kb.h);
  }
  return bottom;
}

export const ROW_JUSTIFY = ["start", "end", "between"] as const;
export interface RowFit { fit: boolean; justify?: (typeof ROW_JUSTIFY)[number] }

/**
 * A row whose children keep their natural width (fit=true, or any justify).
 * Each child is first laid out with the whole row to itself: one that hugs its
 * content (a button, a badge) comes back narrower and keeps that width; the
 * rest (text, cards) share what is left. Lines wrap on those widths, then each
 * line is placed by justify (start, end, or between: spare room between children).
 */
function fitRow(box: Box, ctx: LayoutContext, pad: number, gap: number, align: (typeof ROW_ALIGN)[number], wrap: boolean, fit: RowFit): void {
  const kids = ctx.visibleChildren(box.node);
  const innerW = Math.max(0, box.w - pad * 2);
  const left = box.x + pad;
  const mins = kids.map((k) => Math.min(innerW, ctx.minWidth(k)));
  const trial = kids.map((k) => ctx.layout(k, left, box.y + pad, innerW));
  const hugs = trial.map((kb) => kb.w < innerW - 1);
  const need = kids.map((_k, i) => (hugs[i] ? Math.max(trial[i]!.w, mins[i]!) : mins[i]!));
  const lines: number[][] = [];
  let line: number[] = [], used = 0;
  kids.forEach((_k, i) => {
    const w = (line.length ? used + gap : 0) + need[i]!;
    if (wrap && line.length && w > innerW + 0.01) { lines.push(line); line = []; used = 0; }
    used = (line.length ? used + gap : 0) + need[i]!;
    line.push(i);
  });
  if (line.length || !lines.length) lines.push(line);

  let y = box.y + pad;
  lines.forEach((idx, li) => {
    if (li) y += gap;
    const space = innerW - gap * Math.max(0, idx.length - 1);
    const fill = idx.filter((i) => !hugs[i]);
    const hugW = idx.reduce((t, i) => t + (hugs[i] ? need[i]! : 0), 0);
    const shares = shareWidths(Math.max(0, space - hugW), fill.map((i) => mins[i]!));
    const width = (i: number) => (hugs[i] ? trial[i]!.w : shares[fill.indexOf(i)]!);
    const total = idx.reduce((t, i) => t + width(i), 0) + gap * Math.max(0, idx.length - 1);
    const spare = Math.max(0, innerW - total);
    const between = fit.justify === "between" && idx.length > 1 ? spare / (idx.length - 1) : 0;
    let x = left + (fit.justify === "end" ? spare : 0);
    if (!fit.justify && !fill.length && idx.every((i) => kids[i]!.type === "tile")) x = left + spare / 2;
    let tallest = 0;
    const placed: Box[] = [];
    idx.forEach((i) => {
      const w = width(i);
      const kb = hugs[i] ? trial[i]! : ctx.layout(kids[i]!, x, y, w);
      if (hugs[i]) ctx.shift(kb, x - kb.x, y - kb.y);
      else if (Math.abs(kb.x - x) > 0.01) ctx.shift(kb, x - kb.x, 0);
      placed.push(kb);
      box.children.push(kb);
      tallest = Math.max(tallest, kb.h);
      x += w + gap + between;
    });
    if (align === "center" && placed.length > 1 && placed.every((k) => k.node.type === "card")) {
      for (const kb of placed) kb.h = tallest;
    } else if (align !== "top") {
      tallest = alignLine(placed, tallest, align, ctx);
    }
    y += tallest;
  });
  box.h = y - box.y + pad;
}

/** Elements that take their content's width in a row rather than their whole share. */
const PACKED = new Set(["button", "badge", "tile"]);

/**
 * Buttons, badges and tiles narrower than their share of a row (see their layouts)
 * would sit apart in the middle of empty slots. Keep them together instead: a
 * row of only these starts at the left, like a form's actions or a set of tags
 * (a row of only tiles sits in the middle, like a hand of cards);
 * a run of them at the end of a row with other content goes to its right edge,
 * like a price and "Add to cart", or a heading and its status.
 */
function packButtons(placed: Box[], widths: number[], left: number, innerW: number, gap: number, ctx: LayoutContext): void {
  // A line of only tiles (a hand of cards, a row of seats, mixed sizes too) sits together in the middle.
  if (placed.length && placed.every((kb) => kb.node.type === "tile")) {
    const runW = placed.reduce((t, kb) => t + kb.w, 0) + gap * (placed.length - 1);
    let x = left + Math.max(0, (innerW - runW) / 2);
    for (const kb of placed) { ctx.shift(kb, x - kb.x, 0); x += kb.w + gap; }
    return;
  }
  const shrunk = placed.map((kb, j) => PACKED.has(kb.node.type) && kb.w < widths[j]! - 1);
  let first = shrunk.length;
  while (first > 0 && shrunk[first - 1]) first--;
  if (first === shrunk.length) return;
  const run = placed.slice(first);
  const runW = run.reduce((t, kb) => t + kb.w, 0) + gap * (run.length - 1);
  let x = first === 0 ? left : left + innerW - runW;
  for (const kb of run) {
    ctx.shift(kb, x - kb.x, 0);
    x += kb.w + gap;
  }
}

/** The narrowest a row can be: its widest child when it may wrap, all of them side by side when it may not. */
export function rowMinWidth(node: SayShapeNode, ctx: LayoutContext, pad: number, gap: number, wrap: boolean): number {
  const mins = ctx.visibleChildren(node).map((k) => ctx.minWidth(k));
  const inner = wrap ? Math.max(0, ...mins) : mins.reduce((t, m) => t + m, 0) + gap * Math.max(0, mins.length - 1);
  return inner + pad * 2;
}

export const TEXT_STYLES = ["display", "title", "lead", "body", "caption"] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];
export const WEIGHTS = ["regular", "semibold", "bold"] as const;

export function textMetrics(theme: Theme, style: TextStyle, weight?: (typeof WEIGHTS)[number]) {
  const size = theme.text[style];
  // Headings are semibold by default: firm without shouting. They sit tighter than reading text.
  const w = weight ?? (style === "display" || style === "title" ? "semibold" : "regular");
  const numeric = { regular: 400, semibold: 600, bold: 700 }[w];
  const leading = style === "display" ? 1.2 : style === "title" ? 1.3 : style === "lead" ? 1.4 : 1.45;
  // Headings take the theme's display face when a look gives them one.
  const family = style === "display" || style === "title" ? displayFamily(theme) : theme.font.family;
  return { size, weight: numeric, lineHeight: Math.round(size * leading * 10) / 10, family };
}

/** A CSS font string from the theme's family. */
export function themeFont(theme: Theme, weight: number, size: number, family: "family" | "mono" = "family"): string {
  return `${weight} ${size}px ${theme.font[family]}`;
}

/** A box covering one pressable part of an element, for ctx.addHit with a detail. */
export function partBox(box: Box, x: number, y: number, w: number, h: number): Box {
  return { node: box.node, x, y, w, h, children: [] };
}

/** Fill the current path with a color at reduced opacity (tints, hover washes). */
export function fillTint(g: CanvasRenderingContext2D, color: string, alpha: number): void {
  g.save();
  g.globalAlpha *= alpha;
  g.fillStyle = color;
  g.fill();
  g.restore();
}

/** A small chevron centred on (x, y), pointing right, down, left or up. */
export function chevron(g: CanvasRenderingContext2D, x: number, y: number, size: number, dir: "right" | "down" | "left" | "up", color: string): void {
  const s = size / 2;
  const pts: Record<typeof dir, [number, number][]> = {
    right: [[-s / 2, -s], [s / 2, 0], [-s / 2, s]],
    left: [[s / 2, -s], [-s / 2, 0], [s / 2, s]],
    down: [[-s, -s / 2], [0, s / 2], [s, -s / 2]],
    up: [[-s, s / 2], [0, -s / 2], [s, s / 2]],
  };
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 1.8;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  pts[dir].forEach(([dx, dy], i) => (i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
  g.stroke();
  g.restore();
}

/** Run an element's on= actions, if any (used after a component writes its bind= state). */
export function runOn(ctx: PressContext): void {
  const on = ctx.props(ctx.target.node).raw("on");
  if (on) ctx.run(on);
}

export const onProp = (what: string): PropDef => ({
  type: "action",
  description: `Actions to run ${what}, e.g. emit:changed. Separate several with ;`,
});

/** How wide text is in the theme's font, for minWidth and layout. */
export function textWidth(ctx: LayoutContext, text: string, weight: number, size: number): number {
  return text ? ctx.measure.width(text, themeFont(ctx.theme, weight, size)) : 0;
}

/** A control's label in body text, wrapped to a width and at most maxLines lines (the last ends with … if cut). */
export function labelLines(ctx: LayoutContext, text: string, width: number, maxLines: number): { lines: string[]; lh: number } {
  const lh = Math.round(ctx.theme.text.body * 1.35);
  if (!text) return { lines: [], lh };
  return { lines: fitLines(text, Math.max(20, width), themeFont(ctx.theme, 400, ctx.theme.text.body), ctx.measure, maxLines), lh };
}


/** icon= on text and list-item: a symbol before the words, from the icon element's list. */
export const iconProp: PropDef = { type: "string", description: "An icon before the text, by name from icon's list, e.g. icon=check-circle." };

/** icon= on controls and labels: the same name list as iconProp, in fewer words for the guide. */
export const iconBefore = (what: string): PropDef => ({ type: "string", description: `Icon name before the ${what}.` });

/** detail= on controls: a quiet second line. */
export const detailProp = (under: string): PropDef => ({ type: "string", description: `A muted line under the ${under}.` });

/** A warning for an icon name that doesn't exist, with the nearest one and the full list. */
export function iconProblems(raw: string | undefined, prop: string): string[] {
  if (raw === undefined || raw.includes("{") || isIconName(raw)) return [];
  const near = nearestIcon(raw);
  return [`${prop}="${raw}" isn't an icon.${near ? ` Did you mean ${prop}=${near}?` : ""} Icons: ${ICON_NAMES.join(", ")}`];
}

/** A small label pill (badge, a list row's tagged value, a tab's count): soft tint, solid fill or outline. */
export const PILL_VARIANTS = ["soft", "solid", "outline"] as const;
/** The tone roles a pill or an edge stripe takes (no plain ink). */
export const PILL_TONES = ["accent", "good", "warn", "bad", "muted"] as const;
export type PillVariant = (typeof PILL_VARIANTS)[number];
const PILL_PAD = 8, PILL_DOT = 12, PILL_ICON = 18;

/** What starts a pill: a status dot, an icon, or nothing. */
export type PillLead = "dot" | IconName | null;

/** A pill's width: its label with padding, and room for what leads it. */
export function pillWidth(ctx: LayoutContext, label: string, lead: PillLead): number {
  return Math.ceil(textWidth(ctx, label, 600, 12) + PILL_PAD * 2 + (lead === "dot" ? PILL_DOT : lead ? PILL_ICON : 0));
}

/** Draw a pill (w from pillWidth) in a tone color: the label in that color, or the theme's on-accent color on a solid fill. */
export function paintPill(ctx: PaintContext, at: { x: number; y: number; w: number; h: number }, label: string, color: string, variant: PillVariant, lead: PillLead): void {
  const { g, theme } = ctx;
  const ink = variant === "solid" ? theme.colors.onAccent : color;
  g.font = ctx.font(600, 12);
  if (variant === "outline") {
    ctx.roundRect(at.x + 0.5, at.y + 0.5, at.w - 1, at.h - 1, theme.radius.sm);
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.stroke();
  } else {
    ctx.roundRect(at.x, at.y, at.w, at.h, theme.radius.sm);
    if (variant === "solid") { g.fillStyle = color; g.fill(); }
    else fillTint(g, color, color === theme.colors.muted ? 0.1 : 0.12);
  }
  g.fillStyle = ink;
  let room = PILL_PAD;
  if (lead === "dot") {
    // A status dot leads the label, so the color reads at a glance even where tints are faint.
    g.beginPath();
    g.arc(at.x + PILL_PAD + 3, at.y + at.h / 2, 3, 0, Math.PI * 2);
    g.fill();
    room += PILL_DOT;
  } else if (lead) {
    drawIcon(g, lead, at.x + PILL_PAD, at.y + (at.h - 14) / 2, 14, ink);
    room += PILL_ICON;
  }
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillStyle = ink;
  g.fillText(ellipsize(label, at.w - PILL_PAD - room, g.font, { width: (t) => g.measureText(t).width }), at.x + room, at.y + at.h / 2 + 1);
}

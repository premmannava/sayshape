/**
 * Collecting the text the canvas draws. While an element in SELECTABLE paints,
 * every fillText call is recorded with the font, alignment and baseline in
 * effect, so each line of the layer sits exactly where the canvas drew it,
 * whichever component drew it. Nothing the component draws changes: the call
 * goes straight on to the canvas.
 *
 * Headless: it needs a drawing context with fillText (the real one, or the
 * recording one in sayshape/testing) and a way to measure text.
 */
import type { TableGeometry } from "../components/table";
import type { Box, Rect } from "../types";
import type { TextLine } from "./host";

/** How tall a line is when its element doesn't say: the same ratio the text element uses. */
const LINE_RATIO = 1.3;

/** Where the baseline sits in a line box, as a fraction of the font size, for text drawn on the alphabetic baseline. */
const BASELINE = 0.97;

/** Tolerance when finding a table row from a line's position (rows slide in a few pixels). */
const ROW_SLOP = 6;

export class TextCollector {
  /** The lines of the last finished frame, in reading order. */
  lines: TextLine[] = [];
  /** A number that changes whenever the last finished frame's lines (text, place or size) changed. */
  hash = 0;

  private current: Box | null = null;
  private frame: TextLine[] = [];
  private counts = new Map<string, number>();
  private original: CanvasRenderingContext2D["fillText"];
  private ownProperty: boolean;

  constructor(
    private g: CanvasRenderingContext2D,
    private measure: (text: string, font: string) => number,
    /** The part of the screen that shows, where an element scrolls its children (screen pixels), or null. */
    private clipOf: () => Rect | null,
  ) {
    this.ownProperty = Object.prototype.hasOwnProperty.call(g, "fillText");
    this.original = g.fillText;
    const original = this.original;
    const self = this;
    g.fillText = function patched(this: unknown, text: string, x: number, y: number, maxWidth?: number): void {
      self.record(text, x, y);
      if (maxWidth === undefined) original.call(g, text, x, y);
      else original.call(g, text, x, y, maxWidth);
    };
  }

  /** The element that is painting now (null for any that isn't selectable). Returns the one before, to put back. */
  enter(box: Box | null): Box | null {
    const before = this.current;
    this.current = box;
    return before;
  }

  /** A frame starts painting: what was recorded for the last one is dropped. */
  begin(): void {
    this.frame = [];
    this.counts.clear();
    this.current = null;
  }

  /**
   * The frame finished. Drops what's under the open popup and what a scrolling
   * element has cut off, then fixes the lines and their hash.
   */
  finish(popup: Rect | null): void {
    const out: TextLine[] = [];
    let hash = 2166136261;
    for (const l of this.frame) {
      if (popup && overlaps(l, popup)) continue;
      if (l.clip && !overlaps(l, l.clip)) continue;
      out.push(l);
      hash = mix(hash, l.text);
      hash = mix(hash, `${Math.round(l.x * 2)},${Math.round(l.y * 2)},${Math.round(l.w * 2)},${Math.round(l.h)}`);
      hash = mix(hash, l.font);
      if (l.clip) hash = mix(hash, `${Math.round(l.clip.x)},${Math.round(l.clip.y)},${Math.round(l.clip.w)},${Math.round(l.clip.h)}`);
    }
    this.lines = out;
    this.hash = hash >>> 0;
  }

  /** Put the canvas's own fillText back. */
  dispose(): void {
    if (this.ownProperty) this.g.fillText = this.original;
    else delete (this.g as unknown as { fillText?: unknown }).fillText;
  }

  /** Lines recorded so far in the frame being painted (the modal's backdrop is dropped with this). */
  discardFrame(): void {
    this.frame = [];
    this.counts.clear();
  }

  private record(text: string, x: number, y: number): void {
    const box = this.current;
    if (!box || !text || !text.trim()) return;
    const g = this.g;
    // Not yet faded in: it isn't on screen, and the frame that draws it fully will record it.
    if (g.globalAlpha < 0.02) return;
    const font = g.font;
    const w = this.measure(text, font);
    const align = g.textAlign;
    const left = align === "center" ? x - w / 2 : align === "right" || align === "end" ? x - w : x;
    const size = fontSize(font);
    const lh = (box.data as { lineHeight?: unknown } | undefined)?.lineHeight;
    const h = typeof lh === "number" && lh > 0 ? lh : Math.round(size * LINE_RATIO);
    const base = g.textBaseline;
    const top = base === "middle" ? y - h / 2 : base === "top" || base === "hanging" ? y : base === "bottom" || base === "ideographic" ? y - h : y - (h - size * 1.2) / 2 - size * BASELINE;
    const id = box.node.id;
    const n = this.counts.get(id) ?? 0;
    this.counts.set(id, n + 1);
    const line: TextLine = { key: `${id}:${n}`, text, x: left, y: top, w, h, font, block: `${id}` };
    const clip = this.clipOf();
    let shown: Rect | undefined = clip ?? undefined;
    if (box.node.type === "table") {
      const part = tablePart(box, y, x);
      line.block = part.block;
      if (part.row) line.row = part.row;
      shown = shown ? intersect(shown, part.clip) : part.clip;
    } else if (box.node.type !== "text") {
      // Different fonts or places are different lines of text (a stat's label and its value), not one paragraph.
      line.block = `${id}|${font}|${Math.round(x)}`;
    }
    if (shown) line.clip = shown;
    this.frame.push(line);
  }
}

/** Which part of a table a line belongs to: its title, header, a row's cell, or a message. */
function tablePart(box: Box, y: number, x: number): { block: string; row?: string; clip: Rect } {
  const id = box.node.id;
  const d = box.data as TableGeometry | undefined;
  const clip: Rect = d ? { x: box.x + d.frame.x, y: box.y + d.frame.y, w: d.frame.w, h: d.frame.h } : { x: box.x, y: box.y, w: box.w, h: box.h };
  if (!d) return { block: `${id}|text`, clip };
  const rel = y - box.y;
  if (rel < d.frame.y) return { block: `${id}|title`, clip: { x: box.x, y: box.y, w: box.w, h: d.frame.y } };
  if (rel < d.frame.y + d.headerH) {
    const row = `${id}|h`;
    return { block: `${row}|${Math.round(x)}`, row, clip };
  }
  let idx = -1;
  for (let i = 0; i < d.rows.length; i++) {
    if (d.rows[i]!.y - ROW_SLOP <= rel) idx = i;
    else break;
  }
  const r = idx >= 0 ? d.rows[idx]! : null;
  if (!r || rel >= r.y + r.h + ROW_SLOP) return { block: `${id}|message`, clip };
  const row = `${id}|r${idx}`;
  return { block: `${row}|${Math.round(x)}`, row, clip };
}

function fontSize(font: string): number {
  return Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 15);
}

function overlaps(l: { x: number; y: number; w: number; h: number }, r: Rect): boolean {
  return l.x < r.x + r.w && l.x + l.w > r.x && l.y < r.y + r.h && l.y + l.h > r.y;
}

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

function mix(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h;
}

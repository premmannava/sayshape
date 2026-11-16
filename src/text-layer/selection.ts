/**
 * What copying a selection gives. A browser joins separate elements with line
 * breaks, which would put a table's cells on lines of their own; this joins
 * them the way a person retyping the screen would:
 *
 * - words of one block (a paragraph's wrapped lines, a table cell's lines)
 *   run together with a space, or none when they're on one drawn line (rich
 *   text styled in pieces);
 * - cells of one table row are separated by a tab;
 * - everything else is separated by a line break.
 *
 * Headless: pieces in, a string out.
 */
import type { TextLine } from "./host";

/** The part of one line that's selected (all of it, or a slice at the ends of a selection). */
export interface Piece {
  text: string;
  block: string;
  row?: string;
  /** Where the line is drawn, to tell words on one line from the next line of a block. */
  y: number;
}

export function pieceOf(line: TextLine, text = line.text): Piece {
  return { text, block: line.block, ...(line.row ? { row: line.row } : {}), y: line.y };
}

export function selectionText(pieces: readonly Piece[]): string {
  let out = "";
  let prev: Piece | null = null;
  for (const p of pieces) {
    const text = p.text.replace(/[\t\r\n]+/g, " ");
    if (!text) continue;
    if (prev) {
      if (p.block === prev.block) out += Math.abs(p.y - prev.y) < 1 ? "" : " ";
      else if (p.row !== undefined && p.row === prev.row) out += "\t";
      else out += "\n";
    }
    out += text;
    prev = p;
  }
  return out;
}

/** A place in the lines shown: a line and a character offset in its text. */
export interface TextPosition {
  line: number;
  offset: number;
}

const before = (a: TextPosition, b: TextPosition): boolean => a.line < b.line || (a.line === b.line && a.offset <= b.offset);

/**
 * A selection over the lines, for hosts with no real text to select
 * (sayshape/testing): from one place in the lines to another, in either
 * direction, like a browser's anchor and focus.
 */
export class LineSelection {
  private anchor: TextPosition | null = null;
  private focus: TextPosition | null = null;

  get active(): boolean {
    return !!this.anchor && !!this.focus;
  }

  /** Whole lines, from the first to the last. */
  select(from: number, to: number): void {
    const a = Math.min(from, to), b = Math.max(from, to);
    this.anchor = { line: a, offset: 0 };
    this.focus = { line: b, offset: Number.POSITIVE_INFINITY };
  }

  selectRange(anchor: TextPosition, focus: TextPosition): void {
    this.anchor = anchor;
    this.focus = focus;
  }

  /** Keep the anchor and move the other end. */
  extendTo(focus: TextPosition): boolean {
    if (!this.anchor) return false;
    this.focus = focus;
    return true;
  }

  clear(): void {
    this.anchor = this.focus = null;
  }

  private ends(): [TextPosition, TextPosition] | null {
    const { anchor: a, focus: f } = this;
    if (!a || !f) return null;
    return before(a, f) ? [a, f] : [f, a];
  }

  /** The lines the selection touches, out of the lines shown. */
  of(lines: readonly TextLine[]): TextLine[] {
    const e = this.ends();
    return e ? lines.slice(e[0].line, e[1].line + 1) : [];
  }

  text(lines: readonly TextLine[]): string {
    const e = this.ends();
    if (!e) return "";
    const pieces: Piece[] = [];
    for (let i = e[0].line; i <= e[1].line; i++) {
      const l = lines[i];
      if (!l) continue;
      const s = i === e[0].line ? e[0].offset : 0;
      const t = i === e[1].line ? e[1].offset : Number.POSITIVE_INFINITY;
      pieces.push(pieceOf(l, l.text.slice(s, t)));
    }
    return selectionText(pieces);
  }
}

/** The index of the line nearest a point: the one it's on, else the closest. -1 when there are no lines. */
export function nearestLine(lines: readonly TextLine[], x: number, y: number): number {
  let best = -1, bestD = Infinity;
  lines.forEach((l, i) => {
    const dx = x < l.x ? l.x - x : x > l.x + l.w ? x - (l.x + l.w) : 0;
    const dy = y < l.y ? l.y - y : y > l.y + l.h ? y - (l.y + l.h) : 0;
    // Down the page counts for more than across it, so a point between two rows picks the row it's nearer.
    const d = dy * 4 + dx;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** The index of the line a point is on, or -1. */
export function lineAtPoint(lines: readonly TextLine[], x: number, y: number): number {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) return i;
  }
  return -1;
}

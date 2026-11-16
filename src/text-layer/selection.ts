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

/**
 * A selection over whole lines, for hosts with no real text to select
 * (sayshape/testing): from the line under one point to the line under
 * another, in reading order.
 */
export class LineSelection {
  private from = -1;
  private to = -1;

  get active(): boolean {
    return this.from >= 0;
  }

  select(from: number, to: number): void {
    this.from = Math.min(from, to);
    this.to = Math.max(from, to);
  }

  clear(): void {
    this.from = this.to = -1;
  }

  /** The lines selected, out of the lines shown. */
  of(lines: readonly TextLine[]): TextLine[] {
    return this.active ? lines.slice(this.from, this.to + 1) : [];
  }

  text(lines: readonly TextLine[]): string {
    return selectionText(this.of(lines).map((l) => pieceOf(l)));
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

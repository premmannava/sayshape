/**
 * The click gestures on text: double-click for a word, triple-click for a
 * block, Shift+click to extend. Pure functions, so the browser host and the
 * recording host in sayshape/testing agree and the rules are tested in Node.
 *
 * Pointer events carry no click count (their `detail` is 0), so counting is
 * done here: presses close together in time and place, with the same button,
 * are one run of clicks.
 */
import type { TextLine } from "./host";

/** The longest gap between presses of one double-click, as browsers allow. */
export const MULTI_CLICK_MS = 500;
/** How far a second press may land from the first, in CSS pixels. */
export const MULTI_CLICK_PX = 5;

export class ClickCounter {
  private n = 0;
  private at: { x: number; y: number; t: number; button: number } | null = null;

  /** Count a press: 1 for a lone click, 2 for a double-click, 3 for a triple. A fourth starts over at 1. */
  press(x: number, y: number, t: number, button: number): number {
    const a = this.at;
    const again = !!a && a.button === button && t - a.t <= MULTI_CLICK_MS && Math.hypot(x - a.x, y - a.y) <= MULTI_CLICK_PX;
    this.n = again && this.n < 3 ? this.n + 1 : 1;
    this.at = { x, y, t, button };
    return this.n;
  }

  reset(): void {
    this.n = 0;
    this.at = null;
  }
}

const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}_]/u.test(c);
/** Marks that join the word around them when letters or digits are on both sides ("don't", "1,200.00", "well-known"). */
const isJoiner = (c: string | undefined): boolean => !!c && /[.,'’\-]/.test(c);

/** The word at a character offset of a line, as [start, end), or null when the offset isn't on a word. */
export function wordBounds(text: string, offset: number): [number, number] | null {
  const chars = [...text];
  // Offsets count UTF-16 units; walk to the character holding the offset.
  let at = 0, units = 0;
  while (at < chars.length && units + chars[at]!.length <= offset) units += chars[at++]!.length;
  const wordAt = (i: number): boolean => {
    const c = chars[i];
    if (isWordChar(c)) return true;
    return isJoiner(c) && isWordChar(chars[i - 1]) && isWordChar(chars[i + 1]);
  };
  // At the end of a word the offset sits just after it: that word is still the one meant.
  let i = at;
  if (i >= chars.length || !wordAt(i)) i = i - 1;
  if (i < 0 || !wordAt(i)) return null;
  let s = i, e = i + 1;
  while (s > 0 && wordAt(s - 1)) s--;
  while (e < chars.length && wordAt(e)) e++;
  const unitsTo = (n: number): number => chars.slice(0, n).reduce((sum, c) => sum + c.length, 0);
  return [unitsTo(s), unitsTo(e)];
}

/** The first and last index of the lines drawn as the same block as line `i` (a paragraph, one table cell). */
export function blockBounds(lines: readonly TextLine[], i: number): [number, number] {
  const l = lines[i];
  if (!l) return [i, i];
  let s = i, e = i;
  while (s > 0 && lines[s - 1]!.block === l.block) s--;
  while (e < lines.length - 1 && lines[e + 1]!.block === l.block) e++;
  return [s, e];
}

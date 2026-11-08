/**
 * Inline formatting for text with rich=true: **bold**, *italic*, `code` and
 * links written [words](https://…). One paragraph is one line of the spec
 * (no multi-line values), so a marker is only ever closed on the same line.
 *
 * A marker with nothing to close it stays as it is, as plain text, so a line
 * cut short while streaming, or an asterisk in "5 * 3" or "3*4", never
 * swallows the rest. A backslash shows the next marker as itself: \*. Links
 * must be https://; anything else shows its words, not pressable, and is
 * never opened by SayShape: pressing a link emits it for the host to handle.
 *
 * Markers are read from the spec's own words, before {values} are filled in,
 * so data from state or what a person types is always shown as written and
 * can never become a link or formatting (parseRich's `fill`).
 */
import type { TextMeasurer } from "./text";

export interface RichStyle {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** An https:// link's address. */
  href?: string;
  /** Which link it is, counting from 0, so a link wrapped over two lines is still one link. */
  link?: number;
}

export interface Run extends RichStyle {
  text: string;
}

/** The most runs one paragraph is split into; past it, the rest is plain. */
export const MAX_RUNS = 400;
/** The most characters of a paragraph read for markers; past it, the rest is plain. */
export const MAX_RICH_CHARS = 4000;
const SAFE_URL = /^https:\/\/[^\s()<>"'`{}]+$/;
const ESCAPABLE = "*`[]\\";
const WORDY = /[\p{L}\p{N}]/u;

/**
 * Inline markers in a line of text, as styled runs. Never throws.
 *
 * With `fill`, {expressions} in the source are left whole while markers are
 * read (so a `*` inside one is never a marker), then each run's words and
 * each link's address are filled in with it; an address that isn't https://
 * once filled in isn't a link.
 */
export function parseRich(source: string, fill?: (template: string) => string): Run[] {
  const runs: Run[] = [];
  let links = 0;
  const head = source.length > MAX_RICH_CHARS ? source.slice(0, MAX_RICH_CHARS) : source;
  const tail = source.length > MAX_RICH_CHARS ? source.slice(MAX_RICH_CHARS) : "";
  const push = (text: string, style: RichStyle) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, style)) last.text += text;
    else if (runs.length < MAX_RUNS) runs.push({ text, ...style });
    // Past the limit, the rest goes into one plain run, never the last run's style.
    else if (last && isPlain(last)) last.text += text;
    else runs.push({ text });
  };
  const walk = (s: string, style: RichStyle) => {
    let plain = "";
    const flush = () => { push(plain, style); plain = ""; };
    let i = 0;
    while (i < s.length) {
      const ch = s[i]!;
      if (fill && ch === "{") {
        const end = braceEnd(s, i);
        if (end > 0) { plain += s.slice(i, end); i = end; continue; }
      }
      if (ch === "\\" && i + 1 < s.length && ESCAPABLE.includes(s[i + 1]!)) {
        // Kept escaped until the end when values are filled in, so a filled-in value can't undo it.
        plain += fill ? s.slice(i, i + 2) : s[i + 1];
        i += 2;
        continue;
      }
      if (ch === "`" && !style.code) {
        const end = s.indexOf("`", i + 1);
        if (end > i + 1) { flush(); push(s.slice(i + 1, end), { ...style, code: true }); i = end + 1; continue; }
      }
      if (ch === "*" && s[i + 1] === "*" && s[i + 2] === "*") {
        const end = closing(s, i + 3, "***", !!fill);
        if (end > 0) { flush(); walk(s.slice(i + 3, end), { ...style, bold: true, italic: true }); i = end + 3; continue; }
        // No *** closes it: one of the two is outside the other. The one that closes further out is.
        const bold = closing(s, i + 2, "**", !!fill), italic = closing(s, i + 1, "*", !!fill);
        if (italic > bold) { flush(); walk(s.slice(i + 1, italic), { ...style, italic: true }); i = italic + 1; continue; }
        if (bold > 0) { flush(); walk(s.slice(i + 2, bold), { ...style, bold: true }); i = bold + 2; continue; }
      } else if (ch === "*" && s[i + 1] === "*") {
        const end = closing(s, i + 2, "**", !!fill);
        if (end > 0) { flush(); walk(s.slice(i + 2, end), { ...style, bold: true }); i = end + 2; continue; }
      } else if (ch === "*" && !between(s, i)) {
        const end = closing(s, i + 1, "*", !!fill);
        if (end > 0) { flush(); walk(s.slice(i + 1, end), { ...style, italic: true }); i = end + 1; continue; }
      }
      if (ch === "[" && style.href === undefined) {
        const m = /^\[([^\]]*[^\]\s][^\]]*)\]\(([^()\s]*)\)/.exec(s.slice(i));
        if (m) {
          flush();
          const href = fill ? fill(unescape(m[2]!)) : m[2]!;
          if (SAFE_URL.test(href)) walk(m[1]!, { ...style, href, link: links++ });
          else walk(m[1]!, style);
          i += m[0].length;
          continue;
        }
      }
      plain += ch;
      i++;
    }
    flush();
  };
  walk(head, {});
  if (tail) push(tail, {});
  if (!fill) return runs;
  // Values go in as plain words, after the markers are read.
  const filled: Run[] = [];
  for (const r of runs) {
    const text = fill(unescape(r.text));
    if (!text) continue;
    const last = filled[filled.length - 1];
    if (last && sameStyle(last, r)) last.text += text;
    else filled.push({ ...r, text });
  }
  return filled;
}

/** Where a {…} that opens at `i` ends (after its }), or -1: quotes are skipped, as the expression parser does. */
function braceEnd(s: string, i: number): number {
  let depth = 0, quote = "";
  for (let j = i; j < s.length; j++) {
    const c = s[j]!;
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j + 1;
  }
  return -1;
}

/** Backslash escapes kept while values were filled in, shown as their characters. */
function unescape(s: string): string {
  return s.includes("\\") ? s.replace(/\\([*`[\]\\])/g, "$1") : s;
}

/** A single * with a letter or digit on both sides is arithmetic or part of a word ("3*4", "2*x"), not a marker. */
function between(s: string, i: number): boolean {
  return i > 0 && WORDY.test(s[i - 1]!) && i + 1 < s.length && WORDY.test(s[i + 1]!);
}

/**
 * Where a marker that opens at `from` closes: the next `mark` with words
 * right inside it (not "* " or " *"), as Markdown has it, so "5 * 3 * 2"
 * stays plain. A marker after a backslash, or inside a {value}, doesn't
 * count. -1 when nothing closes it.
 */
function closing(s: string, from: number, mark: string, braces: boolean): number {
  if (from >= s.length || /\s/.test(s[from]!)) return -1;
  let i = from;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "\\") { i += 2; continue; }
    if (braces && c === "{") { const end = braceEnd(s, i); if (end > 0) { i = end; continue; } }
    if (c === "`") {
      // Code is read before any marker inside it.
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) { i = end + 1; continue; }
    }
    if (s.startsWith(mark, i)) {
      // A single * must not be half of a **, nor arithmetic between two words.
      if (mark === "*" && (s[i + 1] === "*" || s[i - 1] === "*")) { i += 2; continue; }
      if (mark === "*" && between(s, i)) { i++; continue; }
      if (i > from && !/\s/.test(s[i - 1]!)) return i;
      i += mark.length;
      continue;
    }
    i++;
  }
  return -1;
}

const isPlain = (r: RichStyle) => !r.bold && !r.italic && !r.code && r.href === undefined;
const sameStyle = (a: RichStyle, b: RichStyle) => a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.href === b.href && a.link === b.link;

/** The words of runs with no markers, and each link's address in brackets after its words, for Copy text. */
export function plainOf(runs: readonly Run[]): string {
  let out = "";
  runs.forEach((r, i) => {
    out += r.text;
    const next = runs[i + 1];
    if (r.href && (!next || next.link !== r.link)) out += ` (${r.href})`;
  });
  return out;
}

export interface Piece extends RichStyle {
  text: string;
  /** From the start of its line. */
  x: number;
  w: number;
}

export interface RichLine {
  pieces: Piece[];
  w: number;
}

/**
 * Wrap runs to a width, breaking only at spaces. A word whose letters change
 * style partway ("**pre**release", "policy." after a link) is one word, so it
 * never breaks where the style changes; each part is measured in its own font.
 * A word longer than the line is broken by letters, as wrapText does.
 */
export function wrapRich(runs: readonly Run[], maxWidth: number, fontOf: (s: RichStyle) => string, m: TextMeasurer): RichLine[] {
  type Frag = { text: string; style: RichStyle };
  // Words across runs: their letters, then the spaces after them.
  const words: Array<{ frags: Frag[]; space: Frag | null }> = [];
  let cur: Frag[] = [];
  for (const { text, ...style } of runs) {
    for (const tok of text.split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s/.test(tok)) { words.push({ frags: cur, space: { text: tok, style } }); cur = []; }
      else cur.push({ text: tok, style });
    }
  }
  if (cur.length) words.push({ frags: cur, space: null });

  const lines: RichLine[] = [];
  let line: Piece[] = [];
  let x = 0;
  const width = Math.max(1, maxWidth);
  const endLine = () => {
    // Spaces at the end of a line take no room.
    while (line.length) {
      const last = line[line.length - 1]!;
      const trimmed = last.text.replace(/\s+$/, "");
      if (trimmed === last.text) break;
      if (!trimmed) { line.pop(); continue; }
      last.text = trimmed;
      last.w = m.width(trimmed, fontOf(last));
      break;
    }
    const end = line[line.length - 1];
    lines.push({ pieces: line, w: end ? end.x + end.w : 0 });
    line = [];
    x = 0;
  };
  const place = (text: string, style: RichStyle) => {
    const font = fontOf(style);
    const w = m.width(text, font);
    const prev = line[line.length - 1];
    if (prev && sameStyle(prev, style)) { prev.text += text; prev.w = m.width(prev.text, font); x = prev.x + prev.w; return; }
    line.push({ ...style, text, x, w });
    x += w;
  };
  for (const word of words) {
    const wordW = word.frags.reduce((s, f) => s + m.width(f.text, fontOf(f.style)), 0);
    if (word.frags.length) {
      if (x > 0 && x + wordW > width) endLine();
      if (wordW > width) {
        // Too long for any line: break it by letters.
        for (const f of word.frags) {
          const font = fontOf(f.style);
          let part = "";
          for (const ch of f.text) {
            if (part && x + m.width(part + ch, font) > width) { place(part, f.style); endLine(); part = ""; }
            else if (!part && x > 0 && x + m.width(ch, font) > width) endLine();
            part += ch;
          }
          if (part) place(part, f.style);
        }
      } else for (const f of word.frags) place(f.text, f.style);
    }
    // Spaces at the start of a line are dropped.
    if (word.space && x > 0) place(word.space.text, word.space.style);
  }
  if (line.length || !lines.length) endLine();
  return lines;
}

/** Whether plain text looks like it was meant to be formatted (has **bold**, `code` or [a](link)). */
export function looksRich(text: string): boolean {
  return /\*\*\S[^*]*\S?\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)/.test(text);
}

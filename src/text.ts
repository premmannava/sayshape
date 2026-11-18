/** Measures text so layout can work without (or before) painting. */
export interface TextMeasurer {
  width(text: string, font: string): number;
}

/** Measures with a canvas context, caching results per font+text. */
export class CanvasMeasurer implements TextMeasurer {
  private cache = new Map<string, number>();
  constructor(private g: CanvasRenderingContext2D) {}

  width(text: string, font: string): number {
    const key = font + "\u0000" + text;
    let w = this.cache.get(key);
    if (w === undefined) {
      this.g.font = font;
      w = this.g.measureText(text).width;
      if (this.cache.size > 5000) this.cache.clear();
      this.cache.set(key, w);
    }
    return w;
  }

  /** Call when web fonts finish loading: cached widths are stale. */
  invalidate(): void {
    this.cache.clear();
  }
}

/** A fixed-advance measurer, for tests and headless layout. */
export class MonoMeasurer implements TextMeasurer {
  constructor(private advance = 0.55) {}
  width(text: string, font: string): number {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 15);
    return text.length * size * this.advance;
  }
}

/** Greedy word wrap. Words longer than a line are broken by character. */
export function wrapText(text: string, maxWidth: number, font: string, m: TextMeasurer): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? line + " " + word : word;
      if (m.width(candidate, font) <= maxWidth) { line = candidate; continue; }
      if (line) out.push(line);
      if (m.width(word, font) <= maxWidth) { line = word; continue; }
      let chunk = "";
      for (const ch of word) {
        if (chunk && m.width(chunk + ch, font) > maxWidth) { out.push(chunk); chunk = ""; }
        chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

/** Headings wrapped onto more lines than this are wrapped as usual: balancing them would cost more than it shows. */
export const MAX_BALANCED_LINES = 4;

/**
 * Wrap text like wrapText, but onto lines of even length: the narrowest width
 * that still takes as few lines, so a heading never leaves one word alone on
 * its last line ("…128 g" / "protein"). Each paragraph is balanced on its own.
 * Measures with m only, so it works in layout.
 */
export function balanceText(text: string, maxWidth: number, font: string, m: TextMeasurer): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const greedy = wrapText(paragraph, maxWidth, font, m);
    if (greedy.length < 2 || greedy.length > MAX_BALANCED_LINES) { out.push(...greedy); continue; }
    // No narrower than the longest word, or words would break that didn't.
    const words = paragraph.split(/\s+/).filter(Boolean);
    let lo = Math.min(maxWidth, Math.max(...words.map((w) => m.width(w, font)))), hi = maxWidth;
    if (wrapText(paragraph, lo, font, m).length === greedy.length) hi = lo;
    // Halve the gap between a width that takes more lines and one that doesn't, to half a pixel.
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      if (wrapText(paragraph, mid, font, m).length === greedy.length) hi = mid;
      else lo = mid;
    }
    out.push(...wrapText(paragraph, hi, font, m));
  }
  return out;
}

/** Cut text to fit a width, ending with an ellipsis. Measures with m, so it works in layout. */
export function ellipsize(text: string, maxWidth: number, font: string, m: TextMeasurer): string {
  if (m.width(text, font) <= maxWidth) return text;
  const chars = [...text];
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (m.width(chars.slice(0, mid).join("") + "…", font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join("").trimEnd() + "…";
}

/**
 * Wrap text onto at most maxLines lines. If it needs more, the last line ends
 * with an ellipsis, so a label never grows without limit or runs out of its box.
 */
export function fitLines(text: string, maxWidth: number, font: string, m: TextMeasurer, maxLines: number): string[] {
  const lines = wrapText(text, maxWidth, font, m);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(0, maxLines - 1));
  kept.push(ellipsize(lines.slice(kept.length).join(" "), maxWidth, font, m));
  return kept;
}

export function font(weight: number | string, size: number, family: string): string {
  return `${weight} ${size}px ${family}`;
}

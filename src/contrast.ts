/**
 * WCAG contrast, shared by everything that works out readable colors: the
 * scrim over pictures (src/scrim.ts), the named fills (src/fills.ts) and the
 * glass card's tint.
 */
import { mixColors, parseColor } from "./theme";

const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };

/** WCAG relative luminance of a color given as 0..255 channels. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG relative luminance of a color, or null when it isn't one. */
export function lumOf(color: string): number | null {
  const c = parseColor(color);
  return c ? luminance(c[0], c[1], c[2]) : null;
}

/** WCAG contrast ratio of two opaque colors, or null when either isn't one. */
export function contrastRatio(a: string, b: string): number | null {
  const x = lumOf(a), y = lumOf(b);
  if (x === null || y === null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The lowest contrast a color has against any of these backgrounds (0 when any isn't a color). */
export function worstContrast(color: string, bgs: readonly string[]): number {
  let worst = Infinity;
  for (const bg of bgs) worst = Math.min(worst, contrastRatio(color, bg) ?? 0);
  return bgs.length ? worst : 0;
}

/**
 * The color moved toward `toward`, 5% at a time, until it keeps `min` against
 * every background; `toward` itself when nothing short of it does.
 */
export function liftUntil(color: string, toward: string, bgs: readonly string[], min: number): string {
  for (let k = 0; k <= 1.0001; k += 0.05) {
    const m = k === 0 ? color : mixColors(color, toward, Math.min(1, k));
    if (m && worstContrast(m, bgs) >= min) return m;
  }
  return toward;
}

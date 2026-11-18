/**
 * Words over a picture. A photo can be any color, so what is laid over one is
 * the engine's job, never the spec's: the picture is darkened by a scrim of the
 * theme's own dark color, strong enough that the theme's text colors read on
 * it at WCAG AA (4.5:1) whatever the photo is.
 *
 * The proof is a worst case. A pixel's luminance only grows with its channels,
 * so every photo pixel lies between an all-black and an all-white one; if the
 * text passes over both (and the whitest blend is still darker than the text),
 * it passes over every pixel in between. `scrimAlpha` finds the weakest scrim
 * that does, for the colors the words can have.
 */
import { darkTheme, isDark, mixColors, parseColor, type Theme } from "./theme";

/**
 * The contrast ratio the words keep over the worst pixel: WCAG AA (4.5) plus a
 * sliver for the one-level differences browsers can make when they blend. The
 * blend is already worked out in 8 bits a channel, so this is not for our own
 * rounding.
 */
export const SCRIM_CONTRAST = 4.55;
/** How strong the scrim is, as a share of its full strength, where no words sit above or below them. */
export const SCRIM_EDGE = 0.2;
/** The text colors a scrim has to keep readable: the ones elements draw words in. */
const TEXT_COLORS = ["ink", "muted", "accent", "good", "warn", "bad"] as const;

const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };

/** WCAG relative luminance of a color given as 0..255 channels. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function lumOf(color: string): number | null {
  const c = parseColor(color);
  return c ? luminance(c[0], c[1], c[2]) : null;
}

/** WCAG contrast ratio of two opaque colors, or null when either isn't one. */
export function contrastRatio(a: string, b: string): number | null {
  const x = lumOf(a), y = lumOf(b);
  if (x === null || y === null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The scrim color over a pixel of one gray level (0 or 255 are the extremes), as the canvas blends it: 8 bits a channel. */
export function blendOver(scrim: string, alpha: number, level: number): [number, number, number] {
  const c = parseColor(scrim) ?? [0, 0, 0, 1];
  const a = Math.round(alpha * 255) / 255;
  return [0, 1, 2].map((i) => Math.round(c[i]! * a + level * (1 - a))) as [number, number, number];
}

/** Whether these text colors keep SCRIM_CONTRAST over the blackest and the whitest photo under a scrim of this strength. */
function readsOver(scrim: string, alpha: number, texts: readonly string[]): boolean {
  const lums = texts.map(lumOf);
  if (lums.some((l) => l === null)) return false;
  return [0, 255].every((level) => {
    const [r, g, b] = blendOver(scrim, alpha, level);
    const bg = luminance(r, g, b);
    // The words stay lighter than anything under them, so no pixel can cross their luminance.
    return lums.every((t) => t! >= bg && (t! + 0.05) / (bg + 0.05) >= SCRIM_CONTRAST);
  });
}

/** The weakest alpha, in hundredths, at which these text colors read over any photo; 1 when nothing weaker works. */
function weakest(scrim: string, texts: readonly string[]): number {
  for (let pct = 0; pct <= 100; pct++) if (readsOver(scrim, pct / 100, texts)) return pct / 100;
  return 1;
}

/**
 * The scrim's strength for an overImageTheme: set when it was made, or, for
 * any other theme with a dark surface and lighter text, the weakest alpha at
 * which every text color in it keeps SCRIM_CONTRAST over the blackest and the
 * whitest photo.
 */
const chosen = new WeakMap<Theme, number>();
export function scrimAlpha(theme: Theme): number {
  const known = chosen.get(theme);
  if (known !== undefined) return known;
  const alpha = weakest(theme.colors.surface, TEXT_COLORS.map((k) => theme.colors[k]));
  chosen.set(theme, alpha);
  return alpha;
}

/** One stop of the scrim's strength down the picture: `offset` is 0 at the top and 1 at the bottom, `alpha` the scrim's opacity there. */
export interface ScrimStop { offset: number; alpha: number }

/**
 * How strong the scrim is down a picture. The words sit in a band (`top` to
 * `bottom`, with `pad` around it); the scrim has its full strength, the one
 * `scrimAlpha` proves, across the whole band, and fades toward SCRIM_EDGE of it
 * at the picture's top and bottom where there are no words, so the photo shows
 * there. Strength only ever falls away from the band, so no word is on less
 * than the proven strength. The same band in gives the same stops out.
 */
export function scrimProfile(alpha: number, y: number, h: number, top: number, bottom: number, pad: number): ScrimStop[] {
  const at = (v: number) => (h > 0 ? Math.min(1, Math.max(0, (v - y) / h)) : 0);
  const from = at(top - pad), to = at(bottom + pad);
  const edge = alpha * SCRIM_EDGE;
  return [
    { offset: 0, alpha: from <= 0 ? alpha : edge },
    ...(from > 0 ? [{ offset: from, alpha }] : []),
    ...(to < 1 ? [{ offset: to, alpha }] : []),
    { offset: 1, alpha: to >= 1 ? alpha : edge },
  ];
}

const made = new WeakMap<Theme, Theme>();

/** Whether a theme is a person's forced-colors choice, which nothing may recolor. */
export function isForcedColors(theme: Theme): boolean {
  return theme.name.endsWith("-forced-colors");
}

/**
 * The theme for words over a picture: a dark one, so light text sits on a
 * dark scrim. A dark theme is its own; a light one gets its own ink as the
 * surface and its surface as the ink, with the quiet colors worked out between
 * them, and the dark default theme's hue wherever its own accent or status
 * color would not read on the dark surface. The same theme in gives the same
 * theme out. A forced-colors theme and one with colors that can't be mixed
 * (not opaque hex or rgb) are left alone.
 */
export function overImageTheme(theme: Theme): Theme {
  const cached = made.get(theme);
  if (cached) return cached;
  const out = build(theme);
  made.set(theme, out);
  return out;
}

function build(theme: Theme): Theme {
  const c = theme.colors;
  if (isForcedColors(theme)) return theme;
  if (isDark(c.surface)) return finish(theme, theme.colors);
  const dark = c.ink, light = c.surface;
  if (!isDark(dark) || isDark(light) || mixColors(dark, light, 0.5) === null) return theme;
  const fallback = darkTheme.colors;
  const raised = mixColors(dark, light, 0.05) ?? dark;
  // A color is kept when it reads on both dark surfaces at the ratio, otherwise the dark theme's is used.
  const reads = (color: string, min: number) => [dark, raised].every((bg) => (contrastRatio(color, bg) ?? 0) >= min);
  const keep = <K extends keyof Theme["colors"]>(key: K, min: number): string => (reads(c[key], min) ? c[key] : fallback[key]);
  // Walk from the surface toward the light until the mix reads: for the quiet text, and the control outline (3:1).
  const mixUntil = (from: number, min: number): string => {
    for (let t = from; t <= 1; t += 0.05) { const m = mixColors(dark, light, t); if (m && reads(m, min)) return m; }
    return light;
  };
  const accentOk = reads(c.accent, 4.5) && (contrastRatio(c.onAccent, c.accent) ?? 0) >= 4.5 && (contrastRatio(c.onAccent, c.accent2) ?? 0) >= 4.5;
  const colors: Theme["colors"] = {
    ...c,
    surface: dark, raised, ink: light,
    muted: mixUntil(0.7, 4.5), line: mixUntil(0.18, 1.3), control: mixUntil(0.45, 3),
    ...(accentOk ? {} : { accent: fallback.accent, accent2: fallback.accent2, onAccent: fallback.onAccent }),
    good: keep("good", 4.5), warn: keep("warn", 4.5), bad: keep("bad", 4.5), warnFill: keep("warnFill", 3),
    focus: keep("focus", 3),
    series1: keep("series1", 3), series2: keep("series2", 3), series3: keep("series3", 3),
    series4: keep("series4", 3), series5: keep("series5", 3), series6: keep("series6", 3),
    shadow: fallback.shadow,
  };
  return finish(theme, colors);
}

/** Extra strength over what the main text needs, so the quieter colors keep a little of their own. */
const SCRIM_HEADROOM = 0.05;

/**
 * The theme over a picture, from dark colors: the scrim is the weakest that
 * keeps the main text at AA over any photo plus a little headroom, and every other text color (muted,
 * accent, good, warn, bad) is lifted toward the main text just far enough to
 * keep AA at that strength, so each keeps as much of its own color as it can.
 */
function finish(theme: Theme, base: Theme["colors"]): Theme {
  const colors = { ...base };
  const scrim = colors.surface;
  const alpha = Math.min(1, weakest(scrim, [colors.ink]) + SCRIM_HEADROOM);
  for (const key of ["muted", "accent", "good", "warn", "bad"] as const) {
    for (let t = 0; t <= 1 && !readsOver(scrim, alpha, [colors[key]]); t += 0.05) colors[key] = mixColors(base[key], colors.ink, Math.min(1, t + 0.05)) ?? colors.ink;
  }
  const out: Theme = { ...theme, name: `${theme.name}-over-image`, colors };
  chosen.set(out, alpha);
  return out;
}

/**
 * Colors for the playground's Appearance panel: reading hex input, WCAG
 * contrast, and making a requested accent readable on a theme's surface.
 * No DOM, so it's tested in Node.
 */

import { darkTheme, lightTheme } from "../../src/theme";

export interface RGB { r: number; g: number; b: number }

/**
 * A hex color as #rrggbb, from #RGB or #RRGGBB (the # optional, any case,
 * surrounding spaces ignored), or null for anything else, including the
 * half-typed values a text field passes through ("#3c", "#3cc2b").
 */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return "#" + (h.length === 3 ? [...h].map((c) => c + c).join("") : h);
}

export function hexToRgb(hex: string): RGB {
  const h = normalizeHex(hex);
  if (!h) throw new Error(`Not a hex color: ${hex}`);
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** a mixed toward b by t (0 = a, 1 = b), in sRGB. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/** What a color painted at some opacity over a background looks like. */
export const over = (color: string, alpha: number, background: string) => mix(background, color, alpha);

/** WCAG targets: ordinary text, and boundaries and focus indicators. */
export const TEXT_CONTRAST = 4.5;
export const UI_CONTRAST = 3;

export const WHITE = "#ffffff";
export const NEAR_BLACK = "#0b0f14";

/** Text for on top of a color: white or near-black, whichever reads better. */
export function onColor(fill: string): string {
  return contrast(fill, WHITE) >= contrast(fill, NEAR_BLACK) ? WHITE : NEAR_BLACK;
}

export interface EffectiveAccent {
  /** The accent to use. */
  accent: string;
  /** Text on the accent (a filled button's label). */
  onAccent: string;
  /** Whether accent had to change from what was asked for. */
  adjusted: boolean;
  /** The contrast of the accent on the surface, after any change. */
  ratio: number;
}

/**
 * An accent that works on a surface both as text and strokes (at least
 * 4.5:1 against it) and as a filled control under onAccent text (at least
 * 4.5:1, which white or near-black always reaches). A color that's too
 * close to the surface is darkened (on a light surface) or lightened (on a
 * dark one) by the least amount that's enough, keeping its hue.
 */
export function effectiveAccent(requested: string, surface: string): EffectiveAccent {
  const want = normalizeHex(requested) ?? requested;
  const accent = readableOn(want, surface, TEXT_CONTRAST);
  return { accent, onAccent: onColor(accent), adjusted: accent !== want, ratio: contrast(accent, surface) };
}

/**
 * color, or if it's under min against surface, color darkened (on a light
 * surface) or lightened (on a dark one) by the least amount that reaches min.
 */
function readableOn(color: string, surface: string, min: number): string {
  if (contrast(color, surface) >= min) return color;
  const toward = luminance(surface) > 0.5 ? NEAR_BLACK : WHITE;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const t = (lo + hi) / 2;
    if (contrast(mix(color, toward, t), surface) >= min) hi = t;
    else lo = t;
  }
  let out = mix(color, toward, hi);
  // Rounding to whole channels can land just under the target: step on until it's met.
  for (let t = hi; contrast(out, surface) < min && t < 1; t = Math.min(1, t + 0.01)) out = mix(color, toward, t);
  return out;
}

// OKLab and OKLCH (Björn Ottosson's perceptual space), for stepping hues and
// measuring how different two colors look.

export interface OKLab { L: number; a: number; b: number }
export interface OKLCH { L: number; C: number; h: number }

const toLinear = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function hexToOklab(hex: string): OKLab {
  const { r, g, b } = hexToRgb(hex);
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Linear sRGB channels, each 0 to 1 when sRGB can show the color. */
function oklabToLinear({ L, a, b }: OKLab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklabToHex(lab: OKLab): string {
  const [r, g, b] = oklabToLinear(lab);
  const c = (v: number) => fromLinear(Math.max(0, Math.min(1, v)));
  return rgbToHex({ r: c(r), g: c(g), b: c(b) });
}

export function hexToOklch(hex: string): OKLCH {
  const { L, a, b } = hexToOklab(hex);
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

const lchToLab = ({ L, C, h }: OKLCH): OKLab => ({ L, a: C * Math.cos((h * Math.PI) / 180), b: C * Math.sin((h * Math.PI) / 180) });

/** An OKLCH color as hex, its chroma lowered (lightness and hue kept) until sRGB can show it. */
export function oklchToHex(lch: OKLCH): string {
  const fits = (C: number) => oklabToLinear(lchToLab({ ...lch, C })).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (fits(lch.C)) return oklabToHex(lchToLab(lch));
  let lo = 0, hi = lch.C;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return oklabToHex(lchToLab({ ...lch, C: lo }));
}

/** How different two colors look: their distance in OKLab (0 is the same, about 0.02 just noticeable). */
export function colorDistance(x: string, y: string): number {
  const p = hexToOklab(x), q = hexToOklab(y);
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/** The angle between two hues, 0 to 180 degrees. */
export const hueGap = (x: number, y: number): number => { const d = Math.abs(x - y) % 360; return d > 180 ? 360 - d : d; };

// Chart series from a list of brand colors.

/** The least OKLab distance between any two series, so no two lines or bars are mistaken for each other. */
export const MIN_SERIES_DISTANCE = 0.08;
/** A first color with less OKLCH chroma than this is grey: it has no hue to step from. */
export const GREY_CHROMA = 0.05;
/** Derived series keep at least this many degrees of hue from the theme's good and bad colors, so a series never reads as a status. */
export const STATUS_HUE_GAP = 30;
/** Derived series take at most this share of the first color's chroma, and never more than MAX_DERIVED_CHROMA, so the first stays the strongest. */
export const DERIVED_CHROMA_SHARE = 0.7;
export const MAX_DERIVED_CHROMA = 0.12;
/** For a faint first color, where muted series sit too close together, derived series may reach this share of its chroma. */
const FAINT_CHROMA_SHARE = 0.9;
/** How far neighbouring derived series step in OKLCH lightness. */
const LIGHTNESS_STEP = 0.08;
/** The OKLCH lightness derived series centre on, on a light surface and on a dark one. */
const LIGHT_SURFACE_BAND: [number, number] = [0.42, 0.6];
const DARK_SURFACE_BAND: [number, number] = [0.62, 0.78];
/** The hues derived series may take: every HUE_STEP degrees around the first color's. */
const HUE_STEP = 15;
const SERIES_COUNT = 6;

export type SeriesScheme = "light" | "dark";

/**
 * Six chart series colors for a list of brand colors (1 to 6, already valid
 * hex, most important first), on a surface, in a scheme.
 *
 * The colors given come first, in their order, each made readable the way
 * effectiveAccent makes an accent readable: the first at 4.5:1, so it can be
 * the accent as well, the rest at the 3:1 chart series need. One that looks
 * too like an earlier one (closer than MIN_SERIES_DISTANCE) is dropped and
 * derived instead. The rest are derived from the first: hues stepped around
 * it in OKLCH and kept away from good and bad, muted so the first stays the
 * strongest, and alternately darker and lighter. A grey first color (OKLCH
 * chroma under GREY_CHROMA) has no hue to step from, so SayShape's own
 * companion series for the scheme fill in, as they are: they're hand-tuned
 * and some sit closer than MIN_SERIES_DISTANCE, the one case that minimum
 * doesn't hold. The same input always gives the same output.
 */
export function deriveSeries(colors: readonly string[], surface: string, scheme: SeriesScheme): string[] {
  const given = colors.map((c) => normalizeHex(c)).filter((c): c is string => c !== null).slice(0, SERIES_COUNT);
  const theme = scheme === "dark" ? darkTheme : lightTheme;
  const c = theme.colors;
  // Nothing usable behaves as if nothing was sent: SayShape's own series.
  if (given.length === 0) return [c.series1, c.series2, c.series3, c.series4, c.series5, c.series6].map((x) => normalizeHex(x)!);
  const out: string[] = [];
  given.forEach((c, i) => {
    const readable = readableOn(c, surface, i === 0 ? TEXT_CONTRAST : UI_CONTRAST);
    if (out.every((o) => colorDistance(o, readable) >= MIN_SERIES_DISTANCE)) out.push(readable);
  });
  const first = hexToOklch(out[0]!);
  if (first.C >= GREY_CHROMA) deriveFrom(first, out, surface, theme.colors);
  // A grey first color (or, as a safety net never seen in testing, one so faint too little derived from it stands apart): SayShape's companions, in order.
  for (const companion of [c.series2, c.series3, c.series4, c.series5, c.series6]) {
    if (out.length >= SERIES_COUNT) break;
    out.push(readableOn(normalizeHex(companion)!, surface, UI_CONTRAST));
  }
  return out;
}

/** Adds derived series to out until it holds six, or nothing more stands apart from what's there. */
function deriveFrom(first: OKLCH, out: string[], surface: string, colors: { good: string; bad: string }): void {
  const status = [colors.good, colors.bad].map((c) => hexToOklch(normalizeHex(c)!).h);
  const hues: number[] = [];
  for (let step = HUE_STEP; step < 360; step += HUE_STEP) {
    const h = (first.h + step) % 360;
    if (status.every((s) => hueGap(s, h) >= STATUS_HUE_GAP)) hues.push(h);
  }
  const chroma = Math.min(MAX_DERIVED_CHROMA, first.C * DERIVED_CHROMA_SHARE);
  const darken = luminance(surface) > 0.5;
  // Derived series centre on the first color's lightness, held to a middle band so they're never near black or pastel.
  const [low, high] = darken ? LIGHT_SURFACE_BAND : DARK_SURFACE_BAND;
  const centre = Math.max(low, Math.min(high, first.L));
  while (out.length < SERIES_COUNT) {
    const prev = hexToOklch(out[out.length - 1]!);
    // Alternate: after a lighter series a darker one, and back.
    const sign = prev.L >= centre ? -1 : 1;
    const steps = (ks: number[]) => ks.map((k) => centre + sign * k * LIGHTNESS_STEP);
    const used = out.map((o) => hexToOklch(o).h);
    const spread = (h: number) => Math.min(...used.map((u) => hueGap(u, h)));
    // Hues farthest from every series so far first; ties to the one nearer the first color's hue, then the smaller angle.
    const order = [...hues].sort((x, y) => spread(y) - spread(x) || hueGap(first.h, x) - hueGap(first.h, y) || x - y);
    // Muted first; quieter still when that's too like a series already there; and for a faint first color, as strong as it allows.
    const chromas = [chroma, chroma * 0.75, chroma * 0.5, Math.min(MAX_DERIVED_CHROMA, first.C * FAINT_CHROMA_SHARE)];
    // Further from the centre only when nothing nearer stands apart.
    const pick = findSeries(order, steps([1, 2, 0, -1, -2]), chromas, out, surface, darken) ?? findSeries(order, steps([3, -3]), chromas, out, surface, darken);
    if (!pick) return;
    out.push(pick);
  }
}

/** The first candidate, by chroma, then lightness, then hue, that's readable and stands apart from every series so far. */
function findSeries(hues: number[], lightness: number[], chromas: number[], out: string[], surface: string, darken: boolean): string | null {
  for (const C of chromas) {
    for (const L of lightness) {
      for (const h of hues) {
        const hex = fitContrast({ L, C, h }, surface, darken);
        if (hex && out.every((o) => colorDistance(o, hex) >= MIN_SERIES_DISTANCE)) return hex;
      }
    }
  }
  return null;
}

/** The color at this OKLCH point with its lightness moved (hue and chroma kept) the least that reaches 3:1 on the surface, or null when nothing does. */
function fitContrast(lch: OKLCH, surface: string, darken: boolean): string | null {
  const at = (L: number) => oklchToHex({ ...lch, L });
  if (contrast(at(lch.L), surface) >= UI_CONTRAST) return at(lch.L);
  let lo = lch.L, hi = darken ? 0 : 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(at(mid), surface) >= UI_CONTRAST) hi = mid; else lo = mid;
  }
  const hex = at(hi);
  return contrast(hex, surface) >= UI_CONTRAST ? hex : null;
}

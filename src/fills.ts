/**
 * Named fills: a card that sets a mood (card fill=sky) paints a gradient the
 * theme owns, never a color the spec gives. Each fill is worked out from the
 * theme's own tokens, so it has a light and a dark value and follows a host's
 * brand; a host can also give the two ends itself (Theme.fills).
 *
 * Words on a fill are the engine's job, the way they are over a picture
 * (src/scrim.ts): `onFillTheme` is the theme inside the card, with its text
 * colors chosen and lifted until they read at AA (4.55, as the scrim checks)
 * on every part of the gradient.
 */
import { contrastRatio, liftUntil, lumOf, worstContrast } from "./contrast";
import { isDarkTheme, mixColors, parseColor, type Theme } from "./theme";
import { isForcedColors, SCRIM_CONTRAST } from "./scrim";

export const FILLS = ["sky", "sunset", "dusk", "night", "accent"] as const;
export type FillName = (typeof FILLS)[number];

/** Whether a prop's text names a fill. */
export const isFillName = (v: unknown): v is FillName => typeof v === "string" && (FILLS as readonly string[]).includes(v);

/** How many points along the gradient the text is checked on (both ends and the steps between). */
const SAMPLES = 17;
/** Contrast for lines, controls and focus rings on a fill (WCAG 1.4.11), and quiet dividers. */
const UI_CONTRAST = 3, LINE_CONTRAST = 1.3;
/** How far the stops move away from the text, a step at a time, when no text color reads on them yet. */
const STEP = 0.05, MAX_STEPS = 20;

/** A fill as painted: its ends, and the color words on it are drawn in. */
export interface ResolvedFill { from: string; to: string; text: string }

/**
 * The same color with its saturation multiplied (capped at full), lightness kept: a dark theme's
 * tokens are soft pastels, and mixed toward a dark page they go muddy (amber turns brown); this
 * gives the color back without changing how light it is, so the text that reads on it still does.
 */
function richer(color: string | null, k: number): string | null {
  const p = color ? parseColor(color) : null;
  if (!p) return color;
  const [r, g, b] = [p[0] / 255, p[1] / 255, p[2] / 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return color;
  const s0 = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  const s = Math.min(1, s0 * k);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, pp = 2 * l - q;
  const ch = (t: number) => {
    t = (t + 1) % 1;
    const v = t < 1 / 6 ? pp + (q - pp) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp;
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${ch(h + 1 / 3)}${ch(h)}${ch(h - 1 / 3)}`;
}

/** How much richer a dark theme's sky, sunset and dusk are than its tokens mixed toward the page. */
const DARK_RICHER = 1.7;

/** The two ends a theme's own tokens give a fill, before the text is chosen. */
function recipe(theme: Theme, name: FillName): { from: string; to: string } | null {
  const own = theme.fills?.[name];
  if (own) return own;
  const c = theme.colors;
  const dark = isDarkTheme(theme);
  // Toward the surface: a light theme's fills are pale washes, a dark theme's deep ones. Dark ones keep
  // more of their color than light ones (mixed less toward the surface), so on a dark page they still
  // read as a mood rather than as grey cards; resolve() then deepens them only as far as AA needs.
  const soft = (color: string, k: number) => mixColors(color, c.surface, k);
  const blend = (a: string, b: string, k: number) => mixColors(a, b, k) ?? a;
  const [kFrom, kTo] = dark ? [0.4, 0.36] : [0.7, 0.55];
  let from: string | null, to: string | null;
  switch (name) {
    case "sky": from = soft(c.series2, kFrom); to = soft(c.accent, kTo); break;
    // Warm: amber into rose in light themes; in dark ones a deep orange into rose, since amber
    // mixed toward a dark surface turns brown.
    case "sunset":
      from = dark ? soft(blend(c.warnFill, c.bad, 0.4), 0.38) : soft(c.warnFill, kFrom);
      to = dark ? soft(blend(c.bad, c.series5, 0.35), 0.36) : soft(c.bad, kTo);
      break;
    // Violet into blue: violet stays strong at the start, so dusk never reads as a paler sky.
    case "dusk":
      from = soft(c.series5, dark ? 0.38 : 0.5);
      to = soft(blend(c.series5, c.series2, 0.55), dark ? 0.42 : 0.52);
      break;
    // Night is dark in every theme: from the ink in a light one; in a dark one a deep navy into
    // violet, well apart from the page so it doesn't read as an empty card.
    case "night":
      from = dark ? mixColors(c.series2, c.surface, 0.7) : mixColors(c.ink, c.series2, 0.15);
      to = dark ? mixColors(c.series5, c.surface, 0.74) : mixColors(c.ink, c.series5, 0.2);
      break;
    // The brand's two colors; with one (accent2 the same as accent), toward the theme's second
    // chart color, which is set apart from the accent, so it's still a gradient.
    case "accent": {
      const second = (contrastRatio(c.accent, c.accent2) ?? 1) >= 1.12 ? c.accent2 : blend(c.accent, c.series2, 0.65);
      from = c.accent; to = second;
      break;
    }
  }
  if (dark && (name === "sky" || name === "sunset" || name === "dusk")) { from = richer(from, DARK_RICHER); to = richer(to, DARK_RICHER); }
  return from && to ? { from, to } : null;
}

/** Points along a gradient, both ends included. */
export function fillSamples(from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < SAMPLES; i++) out.push(mixColors(from, to, i / (SAMPLES - 1)) ?? from);
  return out;
}

const resolved = new WeakMap<Theme, Map<FillName, ResolvedFill | null>>();

/**
 * A fill's ends and its text color in this theme, or null for a forced-colors
 * theme (the person's colors win) or colors that can't be mixed. The text is
 * the theme's ink or surface (or onAccent, for the accent fill), whichever
 * reads best across the whole gradient; if even that is under AA, the ends
 * move away from it a step at a time until it reads. The same theme in gives
 * the same result out.
 */
export function fillOf(theme: Theme, name: FillName): ResolvedFill | null {
  let per = resolved.get(theme);
  if (!per) resolved.set(theme, (per = new Map()));
  if (per.has(name)) return per.get(name) ?? null;
  const out = resolve(theme, name);
  per.set(name, out);
  return out;
}

function resolve(theme: Theme, name: FillName): ResolvedFill | null {
  if (isForcedColors(theme)) return null;
  const ends = recipe(theme, name);
  if (!ends || !mixColors(ends.from, ends.to, 0.5)) return null;
  const c = theme.colors;
  const candidates = name === "accent" ? [c.onAccent, c.ink, c.surface] : [c.ink, c.surface];
  if (candidates.some((t) => lumOf(t) === null)) return null;
  let { from, to } = ends;
  const pick = () => {
    const samples = fillSamples(from, to);
    let best = candidates[0]!, score = -1;
    for (const t of candidates) { const s = worstContrast(t, samples); if (s > score) { best = t; score = s; } }
    return { text: best, score };
  };
  let { text, score } = pick();
  // Away from the text: toward whichever of ink and surface is furthest from it.
  const away = (contrastRatio(text, c.ink) ?? 0) > (contrastRatio(text, c.surface) ?? 0) ? c.ink : c.surface;
  for (let i = 0; score < SCRIM_CONTRAST && i < MAX_STEPS; i++) {
    from = mixColors(from, away, STEP) ?? from;
    to = mixColors(to, away, STEP) ?? to;
    ({ text, score } = pick());
  }
  return { from, to, text };
}

/** For a theme made by onFillTheme: the theme it was made from and the fill, so the card can paint the gradient. */
const sources = new WeakMap<Theme, { base: Theme; name: FillName }>();
const made = new WeakMap<Theme, Map<FillName, Theme>>();

/** The theme and fill an onFillTheme theme was made from, or undefined for any other theme. */
export function fillSource(theme: Theme): { base: Theme; name: FillName } | undefined {
  return sources.get(theme);
}

/**
 * The theme inside a card with a fill: surface and raised are the gradient's
 * middle (so a night fill is a dark theme inside), ink is the fill's text
 * color, and the other text colors (muted, accent, good, warn, bad) are lifted
 * toward it just far enough to read at AA on every part of the gradient;
 * lines, controls, focus and chart series likewise keep 3:1. A forced-colors
 * theme, or one whose colors can't be mixed, comes back unchanged. The same
 * theme and fill in give the same theme out.
 */
export function onFillTheme(theme: Theme, name: FillName): Theme {
  let per = made.get(theme);
  if (!per) made.set(theme, (per = new Map()));
  const known = per.get(name);
  if (known) return known;
  const out = buildOnFill(theme, name);
  per.set(name, out);
  if (out !== theme) sources.set(out, { base: theme, name });
  return out;
}

function buildOnFill(theme: Theme, name: FillName): Theme {
  const fill = fillOf(theme, name);
  if (!fill) return theme;
  const c = theme.colors;
  const bgs = fillSamples(fill.from, fill.to);
  const mid = mixColors(fill.from, fill.to, 0.5) ?? fill.from;
  const ink = fill.text;
  const lift = (color: string, min: number) => liftUntil(color, ink, bgs, min);
  // Quiet text starts part way from the middle to the ink, so it stays quiet on any fill.
  const muted = lift(mixColors(mid, ink, 0.6) ?? ink, SCRIM_CONTRAST);
  const accent = lift(c.accent, SCRIM_CONTRAST);
  // The words on an accent-filled control: whichever of the fill's middle and its ink reads best on it.
  const onAccent = (contrastRatio(mid, accent) ?? 0) >= (contrastRatio(ink, accent) ?? 0) ? mid : ink;
  const colors: Theme["colors"] = {
    ...c,
    surface: mid, raised: mid, ink, muted,
    line: lift(mixColors(mid, ink, 0.15) ?? ink, LINE_CONTRAST),
    control: lift(mixColors(mid, ink, 0.45) ?? ink, UI_CONTRAST),
    accent, accent2: accent, onAccent,
    good: lift(c.good, SCRIM_CONTRAST), warn: lift(c.warn, SCRIM_CONTRAST), bad: lift(c.bad, SCRIM_CONTRAST),
    warnFill: lift(c.warnFill, UI_CONTRAST), focus: lift(c.focus, UI_CONTRAST),
    series1: lift(c.series1, UI_CONTRAST), series2: lift(c.series2, UI_CONTRAST), series3: lift(c.series3, UI_CONTRAST),
    series4: lift(c.series4, UI_CONTRAST), series5: lift(c.series5, UI_CONTRAST), series6: lift(c.series6, UI_CONTRAST),
  };
  return { ...theme, colors };
}

/**
 * A canvas gradient for a fill across a rectangle, at an angle in degrees
 * (135: top left to bottom right, as the card paints it), or null when the
 * theme has no such fill (forced colors). For anything that paints a named
 * fill: cards now, scene shapes later.
 */
export function fillGradient(
  g: CanvasRenderingContext2D,
  theme: Theme,
  name: FillName,
  bounds: { x: number; y: number; w: number; h: number },
  angle = 135,
): CanvasGradient | null {
  const fill = fillOf(theme, name);
  if (!fill) return null;
  // CSS angles: 0 points up, 90 right; the line runs through the centre, long enough to reach the corners.
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const half = (Math.abs(bounds.w * dx) + Math.abs(bounds.h * dy)) / 2;
  const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
  const grad = g.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  grad.addColorStop(0, fill.from);
  grad.addColorStop(1, fill.to);
  return grad;
}

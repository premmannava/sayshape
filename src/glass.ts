/**
 * Glass: a card that shows what's behind it, blurred, under a tint of the
 * theme's raised color (card variant=glass).
 *
 * The words on it are the engine's job, as over a picture (src/scrim.ts):
 * the tint is never weaker than the alpha at which the theme's ink keeps AA
 * (4.55) over both an all-black and an all-white backdrop, so it holds over
 * whatever is behind; `glassTheme` lifts the other text colors toward ink
 * until they do too. Where blur isn't available (no canvas filter, a
 * recording canvas, reduced transparency) the tint is a little stronger and
 * nothing is blurred.
 *
 * The blur copies the part of the canvas already painted behind the card to
 * a small scratch canvas through `filter: blur()`, then draws it back clipped
 * to the card's shape. `GlassCache` keeps one scratch per card and reuses it
 * while nothing behind can have changed, so a still screen blurs each card once.
 */
import { contrastRatio, liftUntil, lumOf } from "./contrast";
import { blendOver, isForcedColors, SCRIM_CONTRAST } from "./scrim";
import type { Theme } from "./theme";

/** How far the backdrop is blurred, in CSS pixels. */
export const GLASS_BLUR = 14;
/** How many cards' blurred backdrops are kept between frames. */
export const GLASS_CACHE_MAX = 8;
/** Extra tint over what ink needs, so the quieter colors keep a little of their own. */
const GLASS_HEADROOM = 0.05;
/** How much stronger the tint is where nothing is blurred: unblurred detail behind is busier. */
export const GLASS_FALLBACK_EXTRA = 0.12;

/** The tint over a black and over a white backdrop at this strength, as colors. */
function extremes(tint: string, alpha: number): [string, string] {
  const at = (level: number) => { const [r, g, b] = blendOver(tint, alpha, level); return `rgb(${r}, ${g}, ${b})`; };
  return [at(0), at(255)];
}

/** Whether a text color reads over every backdrop under a tint of this strength: AA on both extremes, and never between them. */
function readsThrough(tint: string, alpha: number, text: string): boolean {
  const [dark, light] = extremes(tint, alpha);
  const t = lumOf(text), lo = lumOf(dark), hi = lumOf(light);
  if (t === null || lo === null || hi === null) return false;
  // A text luminance between the two blends would match some backdrop exactly.
  if (t > lo && t < hi) return false;
  return Math.min(contrastRatio(text, dark) ?? 0, contrastRatio(text, light) ?? 0) >= SCRIM_CONTRAST;
}

const alphas = new WeakMap<Theme, { blur: number; fallback: number }>();

/**
 * How strong a glass card's tint is in this theme: `blur` over a blurred
 * backdrop (the weakest at which ink reads over any backdrop, plus a little
 * headroom), `fallback` where nothing is blurred.
 */
export function glassAlpha(theme: Theme): { blur: number; fallback: number } {
  const known = alphas.get(theme);
  if (known) return known;
  const { raised, ink } = theme.colors;
  let pct = 0;
  while (pct < 100 && !readsThrough(raised, pct / 100, ink)) pct++;
  const hundredths = (v: number) => Math.min(1, Math.round(v * 100) / 100);
  const blur = hundredths(pct / 100 + GLASS_HEADROOM);
  const out = { blur, fallback: hundredths(blur + GLASS_FALLBACK_EXTRA) };
  alphas.set(theme, out);
  return out;
}

const made = new WeakMap<Theme, Theme>();

/**
 * The theme inside a glass card: muted, accent, good, warn and bad lifted
 * toward ink just far enough to read over any backdrop under the tint. A
 * forced-colors theme comes back unchanged (the card is drawn solid then).
 */
export function glassTheme(theme: Theme): Theme {
  const known = made.get(theme);
  if (known) return known;
  let out = theme;
  if (!isForcedColors(theme)) {
    const c = theme.colors;
    const bgs = extremes(c.raised, glassAlpha(theme).blur);
    const lifted = { ...c };
    for (const key of ["muted", "accent", "good", "warn", "bad"] as const) {
      if (!readsThrough(c.raised, glassAlpha(theme).blur, c[key])) lifted[key] = liftUntil(c[key], c.ink, bgs, SCRIM_CONTRAST);
    }
    if ((["muted", "accent", "good", "warn", "bad"] as const).some((k) => lifted[k] !== c[k])) out = { ...theme, colors: lifted };
  }
  made.set(theme, out);
  if (out !== theme) alphas.set(out, glassAlpha(theme));
  return out;
}

/** A canvas a blurred backdrop is kept on: an OffscreenCanvas, a detached <canvas>, or a test's stand-in. */
export interface ScratchCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
}

/** A scratch canvas from whatever the platform has; null where there is none (Node). */
export function platformScratch(): ScratchCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(1, 1) as unknown as ScratchCanvas;
  // Never attached to the page: it only holds pixels, it draws nothing on screen.
  if (typeof document !== "undefined") return document.createElement("canvas");
  return null;
}

interface Kept { scratch: ScratchCanvas; key: string | null }

/** A rectangle in device pixels. */
interface DeviceRect { x: number; y: number; w: number; h: number }

/**
 * Blurred backdrops, one scratch canvas per card, the most recently used
 * GLASS_CACHE_MAX kept. A card's backdrop is copied again when its place on
 * the canvas, the transform or the generation changes (the engine moves on a
 * generation whenever something outside painting asks for a frame: input,
 * state, layout, a theme, an image arriving), or when the caller says it
 * can't be kept (something painted earlier is animating this frame).
 */
export class GlassCache {
  private kept = new Map<string, Kept>();
  /** How many times a backdrop was copied and blurred (for tests and the inspector). */
  copies = 0;

  constructor(private readonly make: () => ScratchCanvas | null = platformScratch) {}

  /** Whether this context can blur what it has painted: it has a canvas with pixels and takes a filter. */
  static supported(g: CanvasRenderingContext2D): boolean {
    const canvas = (g as { canvas?: { width?: unknown; height?: unknown } }).canvas;
    return typeof (g as { filter?: unknown }).filter === "string" && !!canvas
      && typeof canvas.width === "number" && canvas.width > 0 && typeof canvas.height === "number" && canvas.height > 0;
  }

  /**
   * Draw the blurred backdrop of a rectangle (in the context's current
   * space), clipped to `path` (traced in the same space). Returns false,
   * drawing nothing, where blur isn't available.
   */
  draw(
    g: CanvasRenderingContext2D,
    id: string,
    rect: { x: number; y: number; w: number; h: number },
    blur: number,
    path: () => void,
    generation: number,
    keep: boolean,
  ): boolean {
    if (!GlassCache.supported(g)) return false;
    const m = g.getTransform();
    const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    const device = deviceRect(m, rect, Math.ceil(blur * scale), g.canvas.width, g.canvas.height);
    // Nothing of the card is on the canvas: nothing to draw, and nothing went wrong.
    if (!device) return true;
    const key = `${generation}|${device.x},${device.y},${device.w},${device.h}|${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}|${blur}`;
    let entry = this.kept.get(id);
    if (entry) this.kept.delete(id);
    if (!entry || !keep || entry.key !== key) {
      const scratch = entry?.scratch ?? this.make();
      const sg = scratch?.getContext("2d");
      if (!scratch || !sg) return false;
      if (scratch.width !== device.w) scratch.width = device.w;
      if (scratch.height !== device.h) scratch.height = device.h;
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.clearRect(0, 0, device.w, device.h);
      sg.filter = `blur(${blur * scale}px)`;
      sg.drawImage(g.canvas, device.x, device.y, device.w, device.h, 0, 0, device.w, device.h);
      sg.filter = "none";
      this.copies++;
      entry = { scratch, key: keep ? key : null };
    }
    // Most recently used last; the oldest goes past the cap.
    this.kept.set(id, entry);
    while (this.kept.size > GLASS_CACHE_MAX) this.kept.delete(this.kept.keys().next().value!);
    g.save();
    path();
    g.clip();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(entry.scratch as CanvasImageSource, device.x, device.y);
    g.restore();
    return true;
  }

  /** How many cards' backdrops are kept. */
  get size(): number {
    return this.kept.size;
  }

  /** Let every scratch canvas go (the engine's destroy, a new spec). */
  clear(): void {
    this.kept.clear();
  }
}

/** A rectangle's bounds on the canvas in device pixels, padded and cut to the canvas, whole pixels; null when none of it is on the canvas. */
function deviceRect(m: DOMMatrix, r: { x: number; y: number; w: number; h: number }, pad: number, cw: number, ch: number): DeviceRect | null {
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => [m.a * x! + m.c * y! + m.e, m.b * x! + m.d * y! + m.f] as const);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad)), y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const x1 = Math.min(cw, Math.ceil(Math.max(...xs) + pad)), y1 = Math.min(ch, Math.ceil(Math.max(...ys) + pad));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

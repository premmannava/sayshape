/**
 * See-through colors in a scene: "#E0807A 30%" and "accent 30%" (a color at an
 * opacity), and gradient stops that fade to nothing without a dark fringe.
 */

/** Red, green, blue (0–255) and alpha (0–1). */
export type RGBA = [number, number, number, number];

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(rgba?|hsla?)\(([^()]*)\)$/i;

/** A hex, rgb(a) or hsl(a) color as numbers; null for anything else (CSS names, gradients). */
export function rgbaOf(color: string): RGBA | null {
  const v = color.trim();
  const hex = HEX.exec(v);
  if (hex) {
    let h = hex[1]!;
    if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const fn = FUNC.exec(v);
  if (!fn) return null;
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const num = (s: string, scale: number) => (s.endsWith("%") ? (parseFloat(s) / 100) * scale : parseFloat(s));
  const a = parts[3] === undefined ? 1 : num(parts[3], 1);
  let rgb: [number, number, number];
  if (fn[1]!.toLowerCase().startsWith("rgb")) {
    rgb = [num(parts[0]!, 255), num(parts[1]!, 255), num(parts[2]!, 255)];
  } else {
    const hue = (((parseFloat(parts[0]!) % 360) + 360) % 360) / 360, s = num(parts[1]!, 1), l = num(parts[2]!, 1);
    rgb = hslToRgb(hue, s, l);
  }
  if (![...rgb, a].every(Number.isFinite)) return null;
  return [clamp(rgb[0], 0, 255), clamp(rgb[1], 0, 255), clamp(rgb[2], 0, 255), clamp(a, 0, 1)];
}

/** The color at this opacity (0–1, multiplied with its own), as rgba(); null when it can't be read. */
export function fadeColor(color: string, alpha: number): string | null {
  const c = rgbaOf(color);
  return c ? css([c[0], c[1], c[2], c[3] * clamp(alpha, 0, 1)]) : null;
}

/**
 * Two gradient stops ready for the canvas. A stop that's fully see-through takes
 * the other stop's color, so a fade to "transparent" (black at 0) or "#FFF 0%"
 * never passes through grey on the way.
 */
export function gradientStops(from: string, to: string): [string, string] {
  const a = rgbaOf(from === "transparent" ? "rgba(0,0,0,0)" : from), b = rgbaOf(to === "transparent" ? "rgba(0,0,0,0)" : to);
  if (!a || !b) return [from, to];
  if (a[3] === 0 && b[3] > 0) return [css([b[0], b[1], b[2], 0]), to];
  if (b[3] === 0 && a[3] > 0) return [from, css([a[0], a[1], a[2], 0])];
  return [from, to];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const css = (c: RGBA) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${Math.round(c[3] * 1000) / 1000})`;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const ch = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    const v = u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
    return v * 255;
  };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)];
}

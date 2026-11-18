/**
 * light=x,y on a scene: where shine=true shapes are lit from. Each shape's
 * highlight sits on the side facing that point, whatever groups turn or move
 * it. Without light=, shine stays upper left, as it always was.
 */
import { apply, invert, type Matrix } from "./interact";
import type { Bounds } from "./path";

/** "300,170" (or "300 170") as a point; null when it isn't two numbers. */
export function lightPoint(raw: string | undefined): [number, number] | null {
  if (raw === undefined) return null;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  return parts.length === 2 && parts.every(Number.isFinite) ? [parts[0]!, parts[1]!] : null;
}

/**
 * Where a shape's highlight goes, in its own coordinates: from its middle toward
 * the light (given in canvas pixels), as far as the upper-left highlight sits.
 * With no light, or a light at its very middle, the classic upper-left spot.
 */
export function highlightOf(b: Bounds, m: Matrix, light: readonly [number, number] | undefined): [number, number] {
  const upperLeft: [number, number] = [b.x + b.w * 0.34, b.y + b.h * 0.3];
  if (!light) return upperLeft;
  const inv = invert(m);
  if (!inv) return upperLeft;
  const [lx, ly] = apply(inv, light[0], light[1]);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = lx - cx, dy = ly - cy, len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return upperLeft;
  // 0.26 of the size along the way to the light: the same distance as the upper-left spot.
  return [cx + (dx / len) * 0.26 * b.w, cy + (dy / len) * 0.26 * b.h];
}

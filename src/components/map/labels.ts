/** Deterministic label placement on screen, separate from map projection and layout. */
export interface LabelCircle { id: number; x: number; y: number; radius: number; text: string; priority: number }
export interface LabelPlacement { x: number; y: number; text: string; id: number }
interface Rect { x: number; y: number; w: number; h: number }
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Prefer the right of each marker, then left, below, above. Protect
 * against other labels AND every visible bubble, irrespective of draw order.
 * Coordinates are box-local, measured in CSS pixels.
 */
export function layoutBubbleLabels(
  circles: readonly LabelCircle[], width: number, height: number,
  measure: (text: string) => number, avoid: readonly Rect[] = [],
): Map<number, LabelPlacement> {
  const placed = new Map<number, LabelPlacement>();
  const taken: Rect[] = [...avoid];
  const sorted = [...circles].sort((a, b) => b.priority - a.priority || b.radius - a.radius || a.id - b.id);
  for (const c of sorted) {
    const text = c.text.length > 36 ? c.text.slice(0, 35) + "…" : c.text;
    const w = Math.max(4, measure(text)) + 3, h = 17;
    const pad = 7;
    const positions = [
      { x: c.x + c.radius + pad, y: c.y - h / 2 },
      { x: c.x - c.radius - pad - w, y: c.y - h / 2 },
      { x: c.x - w / 2, y: c.y + c.radius + pad },
      { x: c.x - w / 2, y: c.y - c.radius - pad - h },
    ];
    for (const p of positions) {
      const rect = { ...p, w, h };
      if (p.x < 4 || p.y < 4 || p.x + w > width - 4 || p.y + h > height - 4) continue;
      if (taken.some((t) => intersects(rect, t))) continue;
      if (circles.some((other) => other.id !== c.id &&
        intersects(rect, { x: other.x - other.radius - 3, y: other.y - other.radius - 3,
          w: other.radius * 2 + 6, h: other.radius * 2 + 6 }))) continue;
      placed.set(c.id, { x: p.x, y: p.y + h / 2, text, id: c.id });
      taken.push(rect);
      break;
    }
  }
  return placed;
}

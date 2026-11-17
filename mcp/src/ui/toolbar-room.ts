import type { Box } from "../../../src/types";

/**
 * Whether the view's tools (copy, download, the theme selector) need a row of their own above the interface.
 * They sit over its top-right corner, which is fine while nothing is drawn there; when something is, they
 * go above it instead. Pure: it reads the laid-out boxes and the tools' size, nothing else.
 */

/** The toolbar's right edge sits 16px in from the canvas edge (see index.html: its own 4px padding makes the engine's 20). */
export const TOOLBAR_RIGHT = 16;

/** Elements that only arrange their children: they paint nothing at the corner themselves, so their children decide. */
const ARRANGES = new Set(["column", "row", "grid", "card", "list", "scroll", "each", "if", "overlap", "screen", "spacer"]);

/** How wide a piece of text is drawn in a font; without one, text counts as its whole box. */
export type Measure = (text: string, font: string) => number;

interface Rect { x: number; y: number; w: number; h: number }

const meets = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A plain text box: where each line's letters are, so a short title at the left doesn't count as reaching the corner. */
function textRects(box: Box, measure: Measure): Rect[] | null {
  const d = box.data as { lines?: unknown; font?: unknown; lineHeight?: unknown; rich?: unknown; icon?: unknown } | undefined;
  if (!d || d.rich || !Array.isArray(d.lines) || typeof d.font !== "string" || typeof d.lineHeight !== "number") return null;
  const lineHeight = d.lineHeight;
  const font = d.font;
  const align = (box.node.props as Record<string, unknown>).align;
  return (d.lines as unknown[]).map((l, i) => {
    // A little slack for an icon beside the text.
    const w = Math.min(box.w, measure(String(l), font) + (d.icon ? 24 : 0));
    const x = align === "right" ? box.x + box.w - w : align === "center" ? box.x + (box.w - w) / 2 : box.x;
    return { x, y: box.y + lineHeight * i, w, h: lineHeight };
  });
}

/**
 * True when something with content reaches the toolbar's corner: the tools would sit over it.
 * `width` is the interface's width, `toolbar` the tools' own width and height.
 */
export function needsToolbarRow(root: Box | null, width: number, toolbar: { w: number; h: number }, measure?: Measure): boolean {
  if (!root || toolbar.w <= 0 || toolbar.h <= 0) return false;
  const zone: Rect = { x: width - TOOLBAR_RIGHT - toolbar.w, y: 0, w: toolbar.w, h: toolbar.h };
  const hit = (b: Box, depth: number): boolean => {
    if (b.w <= 0 || b.h <= 0 || !meets(b, zone)) return false;
    if (b.node.type === "spacer") return false;
    const arranges = ARRANGES.has(b.node.type) || depth === 0;
    if (arranges && b.children.length) return b.children.some((k) => hit(k, depth + 1));
    if (measure && b.node.type === "text") {
      const rects = textRects(b, measure);
      if (rects) return rects.some((r) => meets(r, zone));
    }
    return true;
  };
  return hit(root, 0);
}

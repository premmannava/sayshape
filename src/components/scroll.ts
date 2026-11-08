/**
 * scroll: a region that shows its children up to a height from the theme
 * and scrolls the rest, for long lists inside a card: messages, activity,
 * order lines, search results.
 *
 *   scroll "Recent activity" size=md
 *     list
 *       each items=events as=e
 *         list-item "{e.title}" detail="{e.when}"
 *
 * Its children are laid out at full height, moved up by how far it's
 * scrolled (engine-held view state, never app state), and drawn through its
 * box only: the engine clips them (ComponentDef.clipChildren) and the pointer
 * reaches only what's in sight. The wheel, a swipe on a touch screen (anywhere
 * over it), a drag on its background, and the keys (Up, Down, Page Up, Page Down, Home, End, when it has focus) scroll
 * it; moving the keyboard to something out of sight inside it scrolls that
 * into view (revealChild). Everything inside stays in Copy text and in the
 * screen reader's tree, scrolled or not.
 */
import type { ComponentDef, ElementView } from "../component";
import type { Box } from "../types";
import { fillTint, gapProp, padProp, stack } from "./util";

const SIZES = ["sm", "md", "lg"] as const;
type Size = (typeof SIZES)[number];
const SCROLL = "scroll";
const ARROW_STEP = 48;
const DRAG_SLOP = 4;

/** How tall it gets before it scrolls, from the theme's control height: about 6, 9 or 12 controls. */
export function scrollHeight(controlHeight: number, size: Size): number {
  return controlHeight * { sm: 6, md: 9, lg: 12 }[size];
}

interface ScrollData {
  /** The children's full height, the height shown, and how far it's scrolled. */
  content: number;
  view: number;
  y: number;
}

const dataOf = (b: Box): ScrollData | undefined => b.data as unknown as ScrollData | undefined;
const maxOf = (d: ScrollData) => Math.max(0, d.content - d.view);

/** Move to y, kept within the content. True when it moved. */
function scrollTo(v: ElementView, d: ScrollData, y: number): boolean {
  const before = v.y ?? 0;
  v.y = Math.max(0, Math.min(maxOf(d), y));
  return Math.abs(v.y - before) > 0.01;
}

export const scroll: ComponentDef = {
  type: "scroll",
  category: "layout",
  description: "A region that shows its children up to a fixed height and scrolls the rest, for a long list inside a card: messages, activity, results. Everything inside is still read and copied.",
  text: { description: "What it holds, for screen readers, e.g. Recent activity. Not drawn." },
  props: {
    size: { type: "enum", values: SIZES, default: "md", description: "How tall it gets before it scrolls: sm (about 6 rows of controls), md (about 9) or lg (about 12)." },
    gap: gapProp(8),
    pad: padProp(0),
  },
  children: "any",
  picks: [{ for: "a long list inside a card, such as messages or activity", write: "scroll size=md" }],
  example: `state events=[{title: "Order NW-2041 shipped", when: "09:12"}, {title: "Refund approved", when: "08:40"}, {title: "New review: 5 stars", when: "Yesterday"}, {title: "Stock low: Ridge 28 L", when: "Yesterday"}, {title: "Invoice sent", when: "Mon"}, {title: "Order NW-2038 delivered", when: "Mon"}, {title: "Price change: Summit pack", when: "Sun"}, {title: "New customer: Lumen Cinema", when: "Sat"}]
scroll "Recent activity" size=sm
  list
    each items=events as=e
      list-item "{e.title}" detail="{e.when}"`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const size = p.oneOf("size", SIZES, "md");
    const top = box.y;
    stack(box, ctx, p.num("pad", 0), p.num("gap", 8));
    const content = box.h;
    const viewH = Math.min(content, scrollHeight(ctx.theme.control.height, size));
    const v = ctx.view?.(box.node);
    const y = Math.max(0, Math.min(content - viewH, v?.y ?? 0));
    if (v) v.y = y;
    if (y) for (const k of box.children) ctx.shift(k, 0, -y);
    box.y = top;
    box.h = viewH;
    const data: ScrollData = { content, view: viewH, y };
    box.data = data as unknown as Box["data"];
  },
  clipChildren(box) {
    const d = dataOf(box);
    return d && maxOf(d) > 0 ? { x: box.x, y: box.y, w: box.w, h: box.h } : null;
  },
  revealChild(box, view, rect) {
    const d = dataOf(box);
    if (!d) return false;
    const y = view.y ?? 0, pad = 8;
    // Something taller than the region shows its top.
    if (rect.y < box.y || rect.h > box.h) return scrollTo(view, d, y - (box.y - rect.y) - (rect.h > box.h ? 0 : pad));
    if (rect.y + rect.h > box.y + box.h) return scrollTo(view, d, y + (rect.y + rect.h - box.y - box.h) + pad);
    return false;
  },
  paint(box, ctx) {
    const d = dataOf(box);
    if (!d || maxOf(d) <= 0) return;
    // Its own region, under its children's: the wheel and a drag on the background reach it,
    // and it's a Tab stop of its own, so it can be scrolled from the keyboard.
    ctx.addHit(box, { detail: SCROLL });
  },
  paintOver(box, ctx) {
    const d = dataOf(box);
    if (!d || maxOf(d) <= 0) return;
    const { g, theme } = ctx;
    const c = theme.colors;
    // A thin bar showing how much there is and where it is.
    const track = box.h - 4;
    const thumb = Math.max(24, (track * d.view) / d.content);
    const ty = box.y + 2 + (track - thumb) * (d.y / maxOf(d));
    ctx.roundRect(box.x + box.w - 5, box.y + 2, 3, track, 1.5);
    fillTint(g, c.ink, 0.06);
    ctx.roundRect(box.x + box.w - 5, ty, 3, thumb, 1.5);
    g.fillStyle = c.control;
    g.fill();
    if (ctx.isFocused(box.node, SCROLL)) {
      ctx.roundRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4, theme.radius.md);
      g.strokeStyle = c.focus;
      g.lineWidth = 2;
      g.stroke();
    }
  },
  hitTest: (_box, _x, _y, detail) => ({ detail }),
  cursor: () => "default",
  wheel(ctx) {
    const d = dataOf(ctx.target.box);
    if (!d || !maxOf(d) || !ctx.deltaY) return false;
    return scrollTo(ctx.view(ctx.target.node), d, (ctx.view(ctx.target.node).y ?? 0) + ctx.deltaY);
  },
  key(ctx, key) {
    const d = dataOf(ctx.target.box);
    if (!d || !maxOf(d)) return false;
    const v = ctx.view(ctx.target.node);
    const y = v.y ?? 0;
    const to = key === "ArrowDown" ? y + ARROW_STEP : key === "ArrowUp" ? y - ARROW_STEP
      : key === "PageDown" ? y + d.view * 0.9 : key === "PageUp" ? y - d.view * 0.9
      : key === "Home" ? 0 : key === "End" ? maxOf(d) : null;
    if (to === null) return false;
    if (scrollTo(v, d, to)) ctx.relayout?.();
    return true;
  },
  drag(ctx) {
    const v = ctx.view(ctx.target.node);
    const d = dataOf(ctx.target.box);
    if (ctx.phase === "start") { v.dragY = ctx.y; v.dragFrom = v.y ?? 0; v.dragMoved = 0; return false; }
    const dy = ctx.y - (v.dragY ?? ctx.y);
    if (ctx.phase === "move") {
      if (!d || (!v.dragMoved && Math.abs(dy) < DRAG_SLOP)) return false;
      v.dragMoved = 1;
      return scrollTo(v, d, (v.dragFrom ?? 0) - dy);
    }
    delete v.dragY; delete v.dragFrom; delete v.dragMoved;
    return false;
  },
  semantics(box, ctx) {
    const d = dataOf(box);
    const name = ctx.props(box.node).text() || undefined;
    if (!d || maxOf(d) <= 0) return name ? { role: "group", name } : null;
    // A scrolling region; its children are inside it, scrolled or not.
    return { role: "region", name: name ?? "Scrolling area", detail: SCROLL };
  },
};


/**
 * slide: one 16:9 slide in a deck. Its quoted text is its title, which it
 * draws itself; any elements go under it.
 *
 * A slide is the first element whose height doesn't come from what's in it:
 * it's always 16:9 and as wide as its space. Its title and children are laid
 * out at a fixed design size (DESIGN_W by DESIGN_H, with the theme's slide
 * tokens), then the whole slide is drawn scaled to the real width
 * (ComponentDef.childTransform), so it looks the same at every size. Short
 * content is centred under the title; tall content is scaled down to fit, to
 * MIN_FIT at the least, and past that clipped, with a warning to split it.
 */
import type { ChildTransform, ComponentDef, LayoutContext } from "../../component";
import { fitLines } from "../../text";
import type { Box, SayShapeNode } from "../../types";
import { slideTheme, slideTokens } from "./theme";

/** The size a slide is laid out at before it's scaled to its space. */
export const DESIGN_W = 960;
export const DESIGN_H = 540;
/** The smallest tall content is scaled to before it's cut off. */
export const MIN_FIT = 0.6;

const LAYOUTS = ["title", "content"] as const;
type SlideLayout = (typeof LAYOUTS)[number];

/** Where a slide sits in its deck, set by the deck before it lays the slide out. */
export interface SlidePlace {
  index: number;
  count: number;
  numbers: boolean;
}
export const placeOf = new WeakMap<SayShapeNode, SlidePlace>();

export interface SlideData {
  [key: string]: unknown;
  layout: SlideLayout;
  /** Screen pixels per design pixel. */
  scale: number;
  /** How much the children are shrunk to fit (1 when they fit). */
  fit: number;
  /** The title as drawn, in design pixels from the slide's top left. */
  title: { lines: string[]; font: string; size: number; lineHeight: number; top: number };
  /** The children's transform from where they were laid out to the screen. */
  transform: ChildTransform;
  /** The children's height as laid out, and the room they had under the title, in design pixels. */
  content: number;
  room: number;
  clipped: boolean;
  place: SlidePlace | undefined;
}

export const dataOf = (b: Box): SlideData | undefined => b.data as SlideData | undefined;

function layoutChildren(box: Box, ctx: LayoutContext, x: number, y: number, w: number, gap: number): number {
  let at = y;
  const kids = ctx.visibleChildren(box.node);
  kids.forEach((k, i) => {
    const kb = ctx.layout(k, x, at, w);
    box.children.push(kb);
    at += kb.h + (i < kids.length - 1 ? gap : 0);
  });
  return kids.length ? at - y : 0;
}

export const slide: ComponentDef = {
  type: "slide",
  category: "layout",
  description: "One 16:9 slide in a deck, with its title drawn large at the top; put the slide's content under it. Keep each slide to one idea: what doesn't fit is shrunk, then cut off.",
  text: { description: "The slide's title, e.g. Three numbers that sum up the quarter." },
  props: {
    layout: { type: "enum", values: LAYOUTS, default: "content", description: "title for the opening slide (a large title with its children under it, centred on the slide), content for the rest (title at the top, children below)." },
  },
  children: "any",
  parents: ["deck"],
  example: `slide "What we do next"
  list
    list-item "Hire two in support"
    list-item "Open the Denver office"`,
  theme: slideTheme,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const t = ctx.theme;
    const k = slideTokens(t);
    const layout = p.oneOf("layout", LAYOUTS, "content");
    const scale = box.w / DESIGN_W;
    box.h = box.w * (DESIGN_H / DESIGN_W);
    const pad = t.space.xl;
    const width = DESIGN_W - pad * 2;
    const cover = layout === "title";
    const size = cover ? k.heading.cover : k.heading.slide;
    const font = `${cover ? 700 : 600} ${size}px ${t.font.family}`;
    const lineHeight = Math.round(size * 1.15);
    const text = p.text().trim();
    const lines = text ? fitLines(text, width, font, ctx.measure, cover ? 3 : 2) : [];
    const titleH = lines.length * lineHeight;
    const gap = t.space.lg;
    const afterTitle = titleH ? (cover ? t.space.md : gap) : 0;

    // Laid out at design size where the content starts under the title. Centring and
    // shrinking to fit go in the transform, never by moving boxes: elements keep
    // positions of their own in box.data (a list's dividers), which moving wouldn't update.
    const x0 = box.x + pad;
    const top = pad + titleH + afterTitle;
    const content = layoutChildren(box, ctx, x0, box.y + top, width, gap);
    const usable = DESIGN_H - pad * 2;
    const room = Math.max(0, DESIGN_H - pad - top);
    let titleTop = pad, shiftY = 0, fit = 1, offX = 0;
    if (cover && titleH + afterTitle + content <= usable) {
      // The opening slide: title and what's under it together, in the middle.
      titleTop = pad + (usable - titleH - afterTitle - content) / 2;
      shiftY = titleTop - pad;
    } else if (content <= room) shiftY = cover ? 0 : (room - content) / 2;
    else {
      fit = Math.max(MIN_FIT, room / content);
      offX = (width * (1 - fit)) / 2;
    }
    const clipped = content * fit > room + 0.5;
    if (clipped) {
      const name = text ? `"${text}"` : "without a title";
      ctx.warn?.(`slide ${name} on line ${box.node.line} has too much on it to fit, even at ${Math.round(MIN_FIT * 100)}% size, so its bottom is cut off. Split it into two slides`);
    }
    // Design point (as laid out) to screen: shrink to fit about the content's top left
    // (centred across), move down to centre it, then scale the slide about its top left.
    const cy0 = box.y + top;
    const transform: ChildTransform = {
      scale: scale * fit,
      dx: box.x + scale * (x0 + offX - fit * x0 - box.x),
      dy: box.y + scale * (cy0 + shiftY - fit * cy0 - box.y),
    };
    const data: SlideData = {
      layout, scale, fit, transform, content, room, clipped, place: placeOf.get(box.node),
      title: { lines, font, size, lineHeight, top: titleTop },
    };
    box.data = data;
  },
  childTransform: (box) => dataOf(box)?.transform ?? null,
  clipChildren: (box) => ({ x: box.x, y: box.y, w: box.w, h: box.h }),
  semantics(box, ctx) {
    const d = dataOf(box);
    const name = ctx.text(box.node) || undefined;
    const at = d?.place ? `Slide ${d.place.index + 1} of ${d.place.count}` : undefined;
    return { role: "group", roleDescription: "slide", ...(name ? { name } : {}), ...(at ? { description: at } : {}) };
  },
  paint(box, ctx) {
    const d = dataOf(box);
    if (!d) return;
    const { g, theme } = ctx;
    const c = theme.colors;
    const pad = theme.space.xl;
    const s = d.scale;
    g.save();
    // Drawn at design size, scaled about the slide's top left like its children.
    g.transform(s, 0, 0, s, box.x * (1 - s), box.y * (1 - s));
    ctx.roundRect(box.x, box.y, DESIGN_W, DESIGN_H, theme.radius.lg);
    g.fillStyle = c.raised;
    g.fill();
    g.lineWidth = 1 / s;
    g.strokeStyle = c.line;
    g.stroke();
    const t = d.title;
    if (d.layout === "title" && t.lines.length) {
      // The opening slide's accent rule, above its title.
      ctx.roundRect(box.x + pad, box.y + t.top - theme.space.lg, theme.space.xl * 1.5, theme.space.xs, theme.space.xs / 2);
      g.fillStyle = c.accent;
      g.fill();
    }
    g.fillStyle = c.ink;
    g.font = t.font;
    g.textAlign = "left";
    g.textBaseline = "middle";
    t.lines.forEach((line, i) => g.fillText(line, box.x + pad, box.y + t.top + t.lineHeight * (i + 0.5)));
    const place = d.place;
    if (place?.numbers) {
      g.fillStyle = c.muted;
      g.font = ctx.font(500, theme.text.caption);
      g.textAlign = "right";
      g.fillText(`${place.index + 1} / ${place.count}`, box.x + DESIGN_W - pad, box.y + DESIGN_H - pad / 2);
    }
    g.restore();
  },
};
